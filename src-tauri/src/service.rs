//! Service 进程管理器
//!
//! 管理 TTS/STT 等后端服务的生命周期，支持启动、停止、状态查询。
//! 与桌面进程共存亡：桌面板退出时自动清理所有子进程。
//!
//! 每个服务由 ProviderConfig 中的 command + args + workDir 定义，
//! 通过 std::process::Command 启动为子进程，以端口作为健康检查标识。
//!
//! ## 管道管理
//! stdout → Stdio::null()（丢弃，不阻塞子进程）
//! stderr → Stdio::piped() → 后台线程持续读取（防止管道缓冲区满导致子进程死锁）
//!
//! ## 进程树保护（Windows）
//! 使用 Job Object + JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE：
//! 父进程无论正常退出/panic/崩溃，Windows 内核自动终止所有子进程，
//! 彻底杜绝僵尸进程。

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::io::{BufRead, BufReader};
use std::process::{Child, Stdio};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{Manager, State};

use crate::errors::{AppError, CmdResult, ServiceError};
use encoding_rs::GBK;

/// Decode subprocess stderr bytes into a String.
/// Windows consoles often emit GBK (code page 936) for Chinese text, so we try
/// UTF-8 first, fall back to GBK, then to lossy UTF-8 to avoid crashing on
/// decode errors (the old `reader.lines()` strict-UTF8 path broke the pipe).
fn decode_stderr(bytes: &[u8]) -> String {
    if let Ok(s) = std::str::from_utf8(bytes) {
        return s.to_string();
    }
    let (decoded, _, _) = GBK.decode(bytes);
    decoded.into_owned()
}

// ---------------------------------------------------------------------------
// Structured Logging Types
// ---------------------------------------------------------------------------

/// 日志事件类型
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum LogEvent {
    #[serde(rename = "lifecycle_start")]
    LifecycleStart,
    #[serde(rename = "lifecycle_started")]
    LifecycleStarted,
    #[serde(rename = "lifecycle_stop_requested")]
    LifecycleStopRequested,
    #[serde(rename = "lifecycle_stopped")]
    LifecycleStopped,
    #[serde(rename = "lifecycle_crashed")]
    LifecycleCrashed,
    #[serde(rename = "health_pass")]
    HealthCheckPassed,
    #[serde(rename = "health_fail")]
    HealthCheckFailed,
    #[serde(rename = "stderr")]
    Stderr,
}

/// 单条日志
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogEntry {
    /// 时间戳（毫秒精度 ISO 8601）
    pub timestamp: String,
    /// 服务 ID，如 "service_11434"
    pub service_id: String,
    /// 事件类型
    pub event: LogEvent,
    /// 描述文本
    pub message: String,
    /// 可选：进程 PID
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pid: Option<u32>,
    /// 可选：退出码
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i32>,
}

/// 日志发送器（可 clone，用于各线程推送日志）
pub type LogSender = mpsc::SyncSender<LogEntry>;

const MAX_LOG_ENTRIES: usize = 2000;

// ---------------------------------------------------------------------------
// Windows Job Object (process tree auto-cleanup on parent death)
// ---------------------------------------------------------------------------

#[cfg(target_os = "windows")]
mod job_object {
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, SetInformationJobObject,
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };

    /// Wrapper over Windows Job Object HANDLE.
    /// When dropped, the job object handle is closed; if KILL_ON_JOB_CLOSE
    /// is set, all assigned child processes are terminated by the OS.
    pub struct JobHandle {
        handle: HANDLE,
    }

    impl JobHandle {
        pub fn create() -> Option<Self> {
            unsafe {
                let handle = CreateJobObjectW(None, None).ok()?;
                let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
                info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
                SetInformationJobObject(
                    handle,
                    windows::Win32::System::JobObjects::JobObjectExtendedLimitInformation,
                    &info as *const _ as *const std::ffi::c_void,
                    std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                )
                .ok()?;
                Some(JobHandle { handle })
            }
        }

        /// Assign a child process to this job object (best-effort).
        /// Once assigned, the child is subject to KILL_ON_JOB_CLOSE.
        pub fn assign(&self, pid: u32) {
            unsafe {
                let process = windows::Win32::System::Threading::OpenProcess(
                    windows::Win32::System::Threading::PROCESS_SET_QUOTA
                        | windows::Win32::System::Threading::PROCESS_TERMINATE,
                    false,
                    pid,
                );
                if let Ok(process) = process {
                    let _ = AssignProcessToJobObject(self.handle, process);
                    let _ = windows::Win32::Foundation::CloseHandle(process);
                }
            }
        }
    }

    // HANDLE is a raw pointer behind the scenes; it's safe to move across threads
    unsafe impl Send for JobHandle {}
    unsafe impl Sync for JobHandle {}
}

#[cfg(not(target_os = "windows"))]
mod job_object {
    pub struct JobHandle;
    impl JobHandle {
        pub fn create() -> Option<Self> {
            Some(JobHandle)
        }
        pub fn assign(&self, _pid: u32) {}
    }
    unsafe impl Send for JobHandle {}
    unsafe impl Sync for JobHandle {}
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/// 服务状态
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub enum ServiceStatus {
    #[serde(rename = "running")]
    Running,
    #[serde(rename = "starting")]
    Starting,
    #[serde(rename = "stopped")]
    Stopped,
    #[serde(rename = "error")]
    Error,
}

/// 服务信息（返回给前端）
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ServiceInfo {
    pub id: String,
    pub status: ServiceStatus,
    pub port: u16,
    pub error: String,
}

/// 正在运行的服务进程
struct ServiceProcess {
    child: Child,
    port: u16,
    /// 重启用配置（None 表示不应自动重启）
    restart_config: Option<ServiceRestartConfig>,
}

/// 服务自动重启配置
#[derive(Clone)]
struct ServiceRestartConfig {
    command: String,
    args: Vec<String>,
    work_dir: String,
    /// 重启次数计数器
    restart_count: u32,
    /// 首次崩溃时间（用于重置计数器）
    first_crash: Option<std::time::Instant>,
}

/// 最大连续重启次数（超过后停止自动重启）
const MAX_RESTART_COUNT: u32 = 5;
/// 重启计数器重置窗口（在此时间内未崩溃，重置计数）
const RESTART_RESET_WINDOW_SECS: u64 = 300;
/// 单次重启最大间隔（秒）
const MAX_BACKOFF_SECS: u64 = 60;

impl ServiceRestartConfig {
    fn new(command: &str, args: &[String], work_dir: &str) -> Self {
        Self {
            command: command.to_string(),
            args: args.to_vec(),
            work_dir: work_dir.to_string(),
            restart_count: 0,
            first_crash: None,
        }
    }

    /// 计算当前退避延迟（指数退避：1s, 2s, 4s, 8s, 16s, 32s, 最多 60s）
    fn backoff_secs(&self) -> u64 {
        let base: u64 = 1u64 << self.restart_count.min(6);
        base.min(MAX_BACKOFF_SECS)
    }

    /// 记录一次重启，返回是否应该继续重启
    fn record_restart(&mut self) -> bool {
        let now = std::time::Instant::now();
        // 如果距首次崩溃超过重置窗口，重置计数器
        if let Some(first) = self.first_crash {
            if now.duration_since(first).as_secs() > RESTART_RESET_WINDOW_SECS {
                self.restart_count = 0;
                self.first_crash = Some(now);
            }
        } else {
            self.first_crash = Some(now);
        }
        self.restart_count += 1;
        self.restart_count <= MAX_RESTART_COUNT
    }

    /// 服务成功运行后重置计数
    fn reset(&mut self) {
        self.restart_count = 0;
        self.first_crash = None;
    }
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

pub struct ServiceManager {
    /// service_id -> 运行中的进程
    processes: Mutex<HashMap<String, ServiceProcess>>,
    /// Windows Job Object：父进程退出时 OS 自动杀子进程
    /// None = 创建失败（非 Windows 平台或无权限），此时仅依赖 CloseRequested 清理
    job: Option<job_object::JobHandle>,
    /// 日志发送器（clone 给各线程写入）
    log_tx: LogSender,
    /// 日志环形缓冲区（由后台线程维护）
    logs: Arc<Mutex<VecDeque<LogEntry>>>,
}

impl ServiceManager {
    pub fn new() -> Self {
        let job = job_object::JobHandle::create();
        #[cfg(target_os = "windows")]
        if job.is_none() {
            eprintln!("[ServiceManager] WARNING: Failed to create Job Object — zombie processes possible on crash");
        }

        // 日志通道：2048 条缓冲，防止 stderr 读者阻塞主线程
        let (log_tx, log_rx) = mpsc::sync_channel(2048);
        let logs = Arc::new(Mutex::new(VecDeque::with_capacity(MAX_LOG_ENTRIES)));
        let logs_clone = logs.clone();

        // 后台日志收集线程
        std::thread::spawn(move || {
            for entry in log_rx {
                let mut buf = logs_clone.lock().expect("logs lock poisoned");
                if buf.len() >= MAX_LOG_ENTRIES {
                    buf.pop_front();
                }
                buf.push_back(entry);
            }
        });

        ServiceManager {
            processes: Mutex::new(HashMap::new()),
            job,
            log_tx,
            logs,
        }
    }

    /// 将子进程加入 Job Object（如果存在的话）
    pub fn assign_to_job(&self, pid: u32) {
        if let Some(ref job) = self.job {
            job.assign(pid);
        }
    }

    /// 获取日志发送器（clone）
    pub fn log_sender(&self) -> LogSender {
        self.log_tx.clone()
    }

    /// 查询最近 N 条日志
    pub fn get_logs(&self, limit: usize) -> Vec<LogEntry> {
        let buf = self.logs.lock().expect("logs lock poisoned");
        buf.iter().rev().take(limit).cloned().collect()
    }
}

// ---------------------------------------------------------------------------
// Background Service Watcher (带自动重启)
// ---------------------------------------------------------------------------

/// 启动后台服务保活线程
/// - 活跃期（有服务运行）：每 10 秒扫描一次进程活性和 HTTP 健康
/// - 空闲期（全部停止）：每 60 秒扫描一次
/// - 发现进程意外退出时自动重启（带指数退避 + 最大次数限制）
/// - 该线程由 setup hook 启动，与应用同生命周期
pub fn start_service_watcher(app_handle: tauri::AppHandle) {
    std::thread::spawn(move || {
        let mut interval_secs = 10u64; // 初始用短间隔
                                       // 跟踪正在等待重试的服务和下次重试时间
        let mut pending_restarts: HashMap<String, (u64, ServiceRestartConfig)> = HashMap::new();

        loop {
            std::thread::sleep(std::time::Duration::from_secs(interval_secs));

            let state = match app_handle.try_state::<ServiceManager>() {
                Some(s) => s,
                None => break, // 应用已销毁
            };

            let log_tx = state.log_sender();

            // 处理等待重试的服务
            let now_ts = std::time::SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs();
            let mut ready_to_restart: Vec<(String, ServiceRestartConfig)> = Vec::new();
            pending_restarts.retain(|id, (retry_ts, cfg)| {
                if now_ts >= *retry_ts {
                    ready_to_restart.push((id.clone(), cfg.clone()));
                    false // 移除已到重试时间的
                } else {
                    true
                }
            });

            // 执行重试
            for (id, mut cfg) in ready_to_restart {
                if cfg.record_restart() {
                    let backoff = cfg.backoff_secs();
                    log_event(
                        &log_tx,
                        &id,
                        LogEvent::LifecycleStart,
                        &format!(
                            "Auto-restarting (attempt {}/{}, backoff={}s)",
                            cfg.restart_count, MAX_RESTART_COUNT, backoff
                        ),
                        None,
                        None,
                    );
                    match std::process::Command::new(&cfg.command)
                        .args(&cfg.args)
                        .current_dir(&cfg.work_dir)
                        .stdin(Stdio::null())
                        .stdout(Stdio::null())
                        .stderr(Stdio::piped())
                        .spawn()
                    {
                        Ok(mut child) => {
                            let pid = child.id();
                            state.assign_to_job(pid);
                            // 提取端口号（从 service_{port} ID 格式）
                            let port: u16 = id
                                .strip_prefix("service_")
                                .and_then(|s| s.parse().ok())
                                .unwrap_or(0);

                            // 后台读取 stderr
                            if let Some(stderr_reader) = child.stderr.take() {
                                let svc_id = id.clone();
                                let stderr_tx = log_tx.clone();
                                std::thread::spawn(move || {
                                    // 同 service_start_raw_with_restart：原始字节 + 宽松解码，
                                    // 避免 GBK 输出触发 UTF-8 解码失败而中断读取。
                                    let mut reader = BufReader::new(stderr_reader);
                                    let mut buf = Vec::new();
                                    loop {
                                        buf.clear();
                                        match reader.read_until(b'\n', &mut buf) {
                                            Ok(0) => break,
                                            Ok(_) => {
                                                let text = String::from_utf8_lossy(&buf)
                                                    .trim_end()
                                                    .to_string();
                                                if !text.is_empty() {
                                                    log_event(
                                                        &stderr_tx,
                                                        &svc_id,
                                                        LogEvent::Stderr,
                                                        &text,
                                                        None,
                                                        None,
                                                    );
                                                }
                                            }
                                            Err(_) => break,
                                        }
                                    }
                                });
                            }

                            // 注册进程
                            if let Ok(mut procs) = state.processes.lock() {
                                if let Some(existing) = procs.get_mut(&id) {
                                    // 重置成功运行的计数器
                                    if let Some(ref mut rc) = existing.restart_config {
                                        rc.reset();
                                    }
                                }
                                procs.insert(
                                    id.clone(),
                                    ServiceProcess {
                                        child,
                                        port,
                                        restart_config: Some(cfg.clone()),
                                    },
                                );
                            }
                            log_event(
                                &log_tx,
                                &id,
                                LogEvent::LifecycleStarted,
                                &format!("Auto-restarted PID={}", pid),
                                Some(pid),
                                None,
                            );
                            // 重新加入等待队列（避免立即检查）
                            pending_restarts.insert(id, (now_ts + 10, cfg));
                        }
                        Err(e) => {
                            log_event(
                                &log_tx,
                                &id,
                                LogEvent::LifecycleCrashed,
                                &format!("Auto-restart failed: {}", e),
                                None,
                                None,
                            );
                        }
                    }
                } else {
                    log_event(
                        &log_tx,
                        &id,
                        LogEvent::LifecycleCrashed,
                        &format!("Max restarts ({}) exceeded — giving up", MAX_RESTART_COUNT),
                        None,
                        None,
                    );
                }
            }

            // 常规扫描
            let list = service_list_all(&state);

            if list.is_empty() {
                interval_secs = 60;
                continue;
            }

            interval_secs = 10;

            for svc in &list {
                match svc.status {
                    ServiceStatus::Stopped => {
                        // 检查是否需要自动重启
                        let should_restart = {
                            let procs = state.processes.lock().ok();
                            procs.and_then(|p| {
                                p.get(&svc.id).and_then(|proc| proc.restart_config.clone())
                            })
                        };
                        if let Some(cfg) = should_restart {
                            let backoff = cfg.backoff_secs();
                            log_event(&log_tx, &svc.id, LogEvent::LifecycleCrashed,
                                &format!("Process stopped unexpectedly (port={}), scheduling restart in {}s",
                                    svc.port, backoff),
                                None, None);
                            pending_restarts.insert(svc.id.clone(), (now_ts + backoff, cfg));
                        } else {
                            log_event(
                                &log_tx,
                                &svc.id,
                                LogEvent::LifecycleCrashed,
                                &format!("Process stopped unexpectedly (port={})", svc.port),
                                None,
                                None,
                            );
                        }
                    }
                    ServiceStatus::Running => {
                        // 重置该服务的重启计数器（正常运行中）
                        if let Ok(mut procs) = state.processes.lock() {
                            if let Some(proc) = procs.get_mut(&svc.id) {
                                if let Some(ref mut rc) = proc.restart_config {
                                    rc.reset();
                                }
                            }
                        }
                    }
                    ServiceStatus::Error => {
                        log_event(
                            &log_tx,
                            &svc.id,
                            LogEvent::HealthCheckFailed,
                            &format!("Service in error state (port={})", svc.port),
                            None,
                            None,
                        );
                    }
                    ServiceStatus::Starting => {
                        // 仍在启动中，继续等待
                    }
                }
            }
        }
    });
}

/// 快捷日志写入 helper
fn log_event(
    tx: &LogSender,
    service_id: &str,
    event: LogEvent,
    msg: &str,
    pid: Option<u32>,
    exit_code: Option<i32>,
) {
    let timestamp = match SystemTime::now().duration_since(UNIX_EPOCH) {
        Ok(d) => {
            let secs = d.as_secs();
            let millis = d.subsec_millis();
            let dt = secs_to_datetime(secs);
            format!(
                "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z",
                dt.0, dt.1, dt.2, dt.3, dt.4, dt.5, millis
            )
        }
        Err(_) => String::from("unknown"),
    };
    let entry = LogEntry {
        timestamp,
        service_id: service_id.to_string(),
        event: event.clone(),
        message: msg.to_string(),
        pid,
        exit_code,
    };
    // 同时输出到 stderr 方便终端调试
    let pid_str = pid.map(|p| format!("PID={}", p)).unwrap_or_default();
    eprintln!("[{}] {:?} {} {}", service_id, event, msg, pid_str);
    let _ = tx.send(entry);
}

/// 将 Unix 时间戳转为 (year, month, day, hour, min, sec)
fn secs_to_datetime(secs: u64) -> (i32, u32, u32, u32, u32, u32) {
    let days = secs / 86400;
    let mut y = 1970i32;
    let mut remaining = days as i32;
    loop {
        let days_in_year = if is_leap(y) { 366 } else { 365 };
        if remaining < days_in_year {
            break;
        }
        remaining -= days_in_year;
        y += 1;
    }
    let leap = is_leap(y);
    let month_days: [i32; 12] = [
        31,
        if leap { 29 } else { 28 },
        31,
        30,
        31,
        30,
        31,
        31,
        30,
        31,
        30,
        31,
    ];
    let mut m = 0u32;
    while m < 12 && remaining >= month_days[m as usize] {
        remaining -= month_days[m as usize];
        m += 1;
    }
    let d = (remaining + 1) as u32;
    let day_secs = (secs % 86400) as u32;
    let h = day_secs / 3600;
    let mi = (day_secs % 3600) / 60;
    let s = day_secs % 60;
    (y, m + 1, d, h, mi, s)
}

fn is_leap(y: i32) -> bool {
    (y % 4 == 0 && y % 100 != 0) || (y % 400 == 0)
}

// ---------------------------------------------------------------------------
// Tauri Commands
// ---------------------------------------------------------------------------

/// 停止一个服务
#[tauri::command]
pub fn service_stop(id: String, state: State<ServiceManager>) -> CmdResult<()> {
    let log_tx = state.log_sender();
    let mut procs = state
        .processes
        .lock()
        .map_err(|_| ServiceError::LockPoisoned)?;

    if let Some(mut proc) = procs.remove(&id) {
        kill_process(&mut proc.child, &log_tx, &id);
    }

    Ok(())
}

/// 查询所有正在运行的服务
#[tauri::command]
pub fn service_list(state: State<ServiceManager>) -> CmdResult<Vec<ServiceInfo>> {
    let mut procs = state
        .processes
        .lock()
        .map_err(|_| ServiceError::LockPoisoned)?;

    let mut list: Vec<ServiceInfo> = Vec::new();
    let mut to_remove: Vec<String> = Vec::new();
    for (id, proc) in procs.iter_mut() {
        let status = match proc.child.try_wait() {
            Ok(Some(_)) => {
                to_remove.push(id.clone());
                ServiceStatus::Stopped
            }
            Ok(None) => ServiceStatus::Running,
            Err(_) => ServiceStatus::Error,
        };
        list.push(ServiceInfo {
            id: id.clone(),
            status,
            port: proc.port,
            error: String::new(),
        });
    }
    // 清理已退出进程
    for id in &to_remove {
        procs.remove(id);
    }
    drop(procs); // 释放锁后再做 HTTP 健康检查，避免阻塞其他线程

    // 额外检测已配置 Provider 的端口（捕获外部启动的服务，等价于原 Admin API /api/service/list）
    if let Ok(content) = crate::crypto::read_secure_file("providers") {
        if let Ok(providers) = serde_json::from_str::<serde_json::Value>(&content) {
            if let Some(configs) = providers["configs"].as_array() {
                for cfg in configs {
                    if let Some(port_val) = cfg["port"].as_u64() {
                        let port = port_val as u16;
                        let id = format!("service_{}", port);
                        // 仅检测不在托管列表中的端口
                        if !list.iter().any(|s| s.id == id) {
                            // 用 HTTP 健康检查（含 TCP 检测 + HTTP GET /health）
                            if check_http_health(port) {
                                list.push(ServiceInfo {
                                    id,
                                    status: ServiceStatus::Running,
                                    port,
                                    error: String::new(),
                                });
                            }
                        }
                    }
                }
            }
        }
    }

    Ok(list)
}

/// 查询单个服务状态
#[tauri::command]
pub fn service_status(id: String, state: State<ServiceManager>) -> CmdResult<ServiceInfo> {
    let mut procs = state
        .processes
        .lock()
        .map_err(|_| ServiceError::LockPoisoned)?;

    if let Some(proc) = procs.get_mut(&id) {
        let status = match proc.child.try_wait() {
            Ok(Some(_)) => ServiceStatus::Stopped,
            Ok(None) => ServiceStatus::Running,
            Err(_) => ServiceStatus::Error,
        };
        Ok(ServiceInfo {
            id,
            status,
            port: proc.port,
            error: String::new(),
        })
    } else {
        Ok(ServiceInfo {
            id,
            status: ServiceStatus::Stopped,
            port: 0,
            error: String::new(),
        })
    }
}

/// 停止所有服务（应用退出时调用）
#[tauri::command]
pub fn service_stop_all(state: State<ServiceManager>) -> CmdResult<()> {
    let log_tx = state.log_sender();
    let mut procs = state
        .processes
        .lock()
        .map_err(|_| ServiceError::LockPoisoned)?;
    for (id, mut proc) in procs.drain() {
        kill_process(&mut proc.child, &log_tx, &id);
    }
    Ok(())
}

/// 查询最近 N 条服务运行日志（供前端展示服务控制台输出）。
///
/// 复用 ServiceManager 内部的日志环形缓冲区（get_logs）。
#[tauri::command]
pub fn get_service_logs(limit: usize, state: State<ServiceManager>) -> Vec<LogEntry> {
    state.get_logs(limit)
}

/// 启动一个后端服务（替代原 Admin HTTP API `/api/service/start`）。
///
/// `work_dir` 解析规则：空 / "." → 后端根目录；以 "." 或 ".." 开头 → 相对后端根目录解析；
/// 否则视为绝对/相对路径直接使用。`command` 解析规则：绝对路径直接使用；含分隔符 → 相对
/// `work_dir` 解析；否则按裸命令名交给 PATH 查找。
#[tauri::command]
pub fn service_start(
    id: String,
    command: String,
    args: Vec<String>,
    work_dir: String,
    port: u16,
    app: tauri::AppHandle,
) -> CmdResult<ServiceInfo> {
    // 解析工作目录：相对路径基于后端根目录
    let app_root = crate::backend::backend_root(&app);
    let work_dir = if work_dir.is_empty() || work_dir == "." {
        app_root.to_string_lossy().to_string()
    } else if work_dir.starts_with('.') || work_dir.starts_with("..") {
        app_root.join(&work_dir).to_string_lossy().to_string()
    } else {
        work_dir
    };

    // 解析命令路径：
    //  - 绝对路径（含盘符如 F:/... 或 \\server\...）直接使用，便于自定义模型指定自己的 Python；
    //  - 含分隔符的相对路径基于 work_dir 解析；
    //  - 否则按裸命令名交给 PATH 查找。
    let resolved_command = if std::path::Path::new(&command).is_absolute() {
        command.clone()
    } else if command.contains('/') || command.contains('\\') {
        std::path::Path::new(&work_dir)
            .join(&command)
            .to_string_lossy()
            .to_string()
    } else {
        command.clone()
    };

    if id.is_empty() || command.is_empty() {
        return Err(AppError::from("缺少 id 或 command"));
    }

    service_start_raw(&resolved_command, &args, &work_dir, port, &app)
}

/// 注册服务进程到管理器（由 HTTP handler 调用）
#[allow(dead_code)]
pub fn register_service(
    manager: &ServiceManager,
    id: String,
    child: Child,
    port: u16,
) -> CmdResult<()> {
    let log_tx = manager.log_sender();
    let mut procs = manager
        .processes
        .lock()
        .map_err(|_| ServiceError::LockPoisoned)?;

    // 先停止同 ID 的旧进程
    if let Some(mut old) = procs.remove(&id) {
        kill_process(&mut old.child, &log_tx, &id);
    }

    procs.insert(
        id,
        ServiceProcess {
            child,
            port,
            restart_config: None,
        },
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// HTTP Handler Helpers
// ---------------------------------------------------------------------------

/// 启动服务并注册到管理器（供 HTTP handler 调用）
///
/// `enable_restart`: 是否在服务崩溃后自动重启（带指数退避和最大次数限制）
pub fn service_start_raw(
    command: &str,
    args: &[String],
    work_dir: &str,
    port: u16,
    app: &tauri::AppHandle,
) -> Result<ServiceInfo, AppError> {
    service_start_raw_with_restart(command, args, work_dir, port, app, true)
}

/// 带自动重启控制的启动函数
pub fn service_start_raw_with_restart(
    command: &str,
    args: &[String],
    work_dir: &str,
    port: u16,
    app: &tauri::AppHandle,
    enable_restart: bool,
) -> Result<ServiceInfo, AppError> {
    let manager = app.state::<ServiceManager>();
    let log_tx = manager.log_sender();

    log_event(
        &log_tx,
        &format!("service_{}", port),
        LogEvent::LifecycleStart,
        &format!("Starting {} (port={}, dir={})", command, port, work_dir),
        None,
        None,
    );

    let mut child = std::process::Command::new(command)
        .args(args)
        .current_dir(work_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| ServiceError::StartFailed {
            id: format!("service_{}", port),
            reason: format!("启动服务失败 ({}): {}", command, e),
        })?;

    let pid = child.id();

    // 生成服务 ID（需要在 child.stderr.take() 之前，因为 take 消耗了 child）
    let id = format!("service_{}", port);

    // 立即将子进程加入 Job Object（OS 级保底：父进程死则子进程也死）
    manager.assign_to_job(pid);

    // 取出 stderr handle，启动后台读取线程（防止管道缓冲区满导致子进程死锁）
    let stderr = child.stderr.take();
    if let Some(stderr_reader) = stderr {
        let svc_id = id.clone();
        let stderr_tx = log_tx.clone();
        std::thread::spawn(move || {
            // 以原始字节读取 stderr，避免中文 Windows 下子进程输出 GBK 字节时，
            // UTF-8 严格解码（reader.lines()）失败而 break 并误报 read error / 关闭管道。
            let mut reader = BufReader::new(stderr_reader);
            let mut buf = Vec::new();
            loop {
                buf.clear();
                match reader.read_until(b'\n', &mut buf) {
                    Ok(0) => break, // EOF：管道关闭 / 进程结束
                    Ok(_) => {
                        let text = decode_stderr(&buf).trim_end().to_string();
                        if !text.is_empty() {
                            log_event(&stderr_tx, &svc_id, LogEvent::Stderr, &text, None, None);
                        }
                    }
                    Err(e) => {
                        log_event(
                            &stderr_tx,
                            &svc_id,
                            LogEvent::Stderr,
                            &format!("read error: {}", e),
                            None,
                            None,
                        );
                        break;
                    }
                }
            }
            log_event(
                &stderr_tx,
                &svc_id,
                LogEvent::Stderr,
                "pipe closed (process ended)",
                None,
                None,
            );
        });
    }

    log_event(
        &log_tx,
        &id,
        LogEvent::LifecycleStarted,
        &format!("Process spawned PID={}", pid),
        Some(pid),
        None,
    );

    // 等待一小段时间检测启动是否立即崩溃
    let status = attempt_wait(&mut child, 1000);
    if let Some(exit_code) = status {
        log_event(
            &log_tx,
            &id,
            LogEvent::LifecycleCrashed,
            "Exited immediately after spawn",
            Some(pid),
            exit_code.code(),
        );
        return Err(ServiceError::ImmediateExit {
            id: id.clone(),
            exit_code: exit_code.code(),
        }
        .into());
    }

    // 注册进程到管理器
    let mut procs = manager
        .processes
        .lock()
        .map_err(|_| ServiceError::LockPoisoned)?;

    // 先停止同端口旧进程
    if let Some(mut old) = procs.remove(&id) {
        kill_process(&mut old.child, &log_tx, &id);
    }

    let restart_config = if enable_restart {
        Some(ServiceRestartConfig::new(command, args, work_dir))
    } else {
        None
    };
    procs.insert(
        id.clone(),
        ServiceProcess {
            child,
            port,
            restart_config,
        },
    );

    Ok(ServiceInfo {
        id,
        status: ServiceStatus::Starting,
        port,
        error: String::new(),
    })
}

/// 按 ID 停止服务（供 HTTP handler 调用）
pub fn service_stop_by_id(manager: &ServiceManager, id: &str) -> CmdResult<()> {
    let log_tx = manager.log_sender();
    let mut procs = manager
        .processes
        .lock()
        .map_err(|_| ServiceError::LockPoisoned)?;

    if let Some(mut proc) = procs.remove(id) {
        kill_process(&mut proc.child, &log_tx, id);
    }

    Ok(())
}

/// 获取单个服务状态（原 Admin HTTP API `/api/service/status` 使用；Admin 移除后暂未使用）
#[allow(dead_code)]
pub fn service_get_status(manager: &ServiceManager, id: String) -> ServiceInfo {
    let mut procs = match manager.processes.lock() {
        Ok(p) => p,
        Err(_) => {
            return ServiceInfo {
                id,
                status: ServiceStatus::Error,
                port: 0,
                error: "锁定失败".into(),
            }
        }
    };

    if let Some(proc) = procs.get_mut(&id) {
        let base_status = match proc.child.try_wait() {
            Ok(Some(_)) => ServiceStatus::Stopped,
            Ok(None) => ServiceStatus::Running,
            Err(_) => ServiceStatus::Error,
        };
        // 对 Running/Starting 做 HTTP 健康检查
        let status =
            if base_status == ServiceStatus::Running || base_status == ServiceStatus::Starting {
                if check_http_health(proc.port) {
                    ServiceStatus::Running
                } else {
                    ServiceStatus::Starting
                }
            } else {
                base_status
            };
        ServiceInfo {
            id,
            status,
            port: proc.port,
            error: String::new(),
        }
    } else {
        ServiceInfo {
            id,
            status: ServiceStatus::Stopped,
            port: 0,
            error: String::new(),
        }
    }
}

/// 列出所有服务状态（供 HTTP handler 调用）
pub fn service_list_all(manager: &ServiceManager) -> Vec<ServiceInfo> {
    let log_tx = manager.log_sender();
    let mut procs = match manager.processes.lock() {
        Ok(p) => p,
        Err(_) => return Vec::new(),
    };

    let mut list: Vec<ServiceInfo> = Vec::new();
    let mut to_remove: Vec<String> = Vec::new();
    for (id, proc) in procs.iter_mut() {
        let base_status = match proc.child.try_wait() {
            Ok(Some(exit)) => {
                to_remove.push(id.clone());
                log_event(
                    &log_tx,
                    id,
                    LogEvent::LifecycleCrashed,
                    &format!("Process exited unexpectedly (exit={:?})", exit.code()),
                    None,
                    exit.code(),
                );
                ServiceStatus::Stopped
            }
            Ok(None) => ServiceStatus::Running,
            Err(_) => ServiceStatus::Error,
        };
        let status =
            if base_status == ServiceStatus::Running || base_status == ServiceStatus::Starting {
                if check_http_health(proc.port) {
                    if base_status != ServiceStatus::Running {
                        log_event(
                            &log_tx,
                            id,
                            LogEvent::HealthCheckPassed,
                            "HTTP health check passed (service ready)",
                            None,
                            None,
                        );
                    }
                    ServiceStatus::Running
                } else {
                    if base_status == ServiceStatus::Running {
                        // 进程活着但 HTTP 不可达：可能是临时波动
                    }
                    ServiceStatus::Starting
                }
            } else {
                base_status
            };
        list.push(ServiceInfo {
            id: id.clone(),
            status,
            port: proc.port,
            error: String::new(),
        });
    }
    for id in &to_remove {
        procs.remove(id);
    }
    list
}

// ---------------------------------------------------------------------------
// Health Check
// ---------------------------------------------------------------------------

#[tauri::command]
/// Check if a service is truly available via HTTP GET /health
pub fn check_http_health(port: u16) -> bool {
    let addr: std::net::SocketAddr = match format!("127.0.0.1:{}", port).parse() {
        Ok(a) => a,
        Err(_) => return false,
    };
    let timeout = std::time::Duration::from_millis(500);
    if let Ok(mut stream) = std::net::TcpStream::connect_timeout(&addr, timeout) {
        let _ = stream.set_read_timeout(Some(std::time::Duration::from_millis(500)));
        let _ = stream.set_write_timeout(Some(std::time::Duration::from_millis(500)));
        use std::io::{Read, Write};
        let mut req_bytes: Vec<u8> = Vec::new();
        req_bytes.extend_from_slice(
            b"GET /health HTTP/1.1
",
        );
        req_bytes.extend_from_slice(
            format!(
                "Host: 127.0.0.1:{}
",
                port
            )
            .as_bytes(),
        );
        req_bytes.extend_from_slice(
            b"Connection: close

",
        );
        if stream.write_all(&req_bytes).is_ok() {
            let mut response = String::new();
            if stream.read_to_string(&mut response).is_ok() {
                return response.starts_with("HTTP/1.");
            }
        }
    }
    false
}

#[tauri::command]
pub fn check_tcp_health(port: u16) -> bool {
    let addr: std::net::SocketAddr = match format!("127.0.0.1:{}", port).parse() {
        Ok(a) => a,
        Err(_) => return false,
    };
    let timeout = std::time::Duration::from_millis(500);
    std::net::TcpStream::connect_timeout(&addr, timeout).is_ok()
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// 尝试等待进程退出，返回退出状态（超时返回 None）
fn attempt_wait(child: &mut Child, timeout_ms: u64) -> Option<std::process::ExitStatus> {
    let start = std::time::Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return Some(status),
            Ok(None) => {
                if start.elapsed().as_millis() as u64 >= timeout_ms {
                    return None;
                }
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
            Err(_) => return None,
        }
    }
}

/// 终止进程（先尝试优雅关闭，超时后强杀进程树）
fn kill_process(child: &mut Child, log_tx: &LogSender, service_id: &str) {
    let pid = child.id();
    let pid_str = pid.to_string();

    log_event(
        log_tx,
        service_id,
        LogEvent::LifecycleStopRequested,
        &format!("Stopping PID={}", pid_str),
        Some(pid),
        None,
    );

    #[cfg(target_os = "windows")]
    {
        // Step 1: 尝试优雅关闭（不带 /F）
        let _ = std::process::Command::new("taskkill")
            .args(["/PID", &pid.to_string()])
            .output();

        // Step 2: 等待 3 秒
        let start = std::time::Instant::now();
        loop {
            match child.try_wait() {
                Ok(Some(status)) => {
                    log_event(
                        log_tx,
                        service_id,
                        LogEvent::LifecycleStopped,
                        &format!("Graceful shutdown (exit={:?})", status.code()),
                        Some(pid),
                        status.code(),
                    );
                    return;
                }
                _ => {
                    if start.elapsed().as_millis() >= 3000 {
                        break;
                    }
                    std::thread::sleep(std::time::Duration::from_millis(200));
                }
            }
        }

        // Step 3: 强制终止进程树
        log_event(
            log_tx,
            service_id,
            LogEvent::LifecycleStopRequested,
            "Force killing with /F /T",
            Some(pid),
            None,
        );
        let _ = std::process::Command::new("taskkill")
            .args(["/F", "/T", "/PID", &pid.to_string()])
            .output();
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = child.kill();
    }

    // 等待进程终止
    let final_status = child.wait().ok().and_then(|s| s.code());
    log_event(
        log_tx,
        service_id,
        LogEvent::LifecycleStopped,
        &format!("Process terminated (exit={:?})", final_status),
        Some(pid),
        final_status,
    );
}
