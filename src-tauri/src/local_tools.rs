//! 本地系统工具命令（深度系统集成）
//!
//! 提供与操作系统深度集成的本地工具：打开应用 / 文件 / 文件夹、执行受控命令、
//! 系统媒体键控制、剪贴板写入、锁屏、电池信息、音量调节、系统通知（Toast）。
//! 这些命令由前端 toolRegistry 注册，并经 permissionManager 授权网关统一管控。

use crate::errors::{AppError, CmdResult};
use serde::Serialize;
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

// ===========================================================================
// 通用辅助
// ===========================================================================

/// 以 PowerShell 执行脚本，返回 stdout；失败返回 Err(原因)
fn run_powershell(script: &str) -> Result<String, String> {
    let out = Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .output()
        .map_err(|e| format!("运行 PowerShell 失败: {}", e))?;
    if !out.status.success() {
        return Err(format!(
            "PowerShell 退出码 {}: {}",
            out.status,
            String::from_utf8_lossy(&out.stderr)
        ));
    }
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

/// 将文本截断到指定字节上限（用于命令输出，避免前端被巨量日志淹没）
fn truncate_utf8(s: &str, max: usize) -> String {
    if s.len() <= max {
        return s.to_string();
    }
    let mut end = max;
    while end > 0 && !s.is_char_boundary(end) {
        end -= 1;
    }
    format!("...[输出已截断，原文 {} 字节]...\n{}", s.len(), &s[..end])
}

// ===========================================================================
// 应用启动（UWP / Store 经 AUMID，桌面程序经 shell start）
// ===========================================================================

static START_APPS_CACHE: std::sync::Mutex<Option<Vec<(String, String)>>> =
    std::sync::Mutex::new(None);

/// 加载 Get-StartApps 列表（名称 -> AUMID），带进程级缓存
fn load_start_apps() -> Vec<(String, String)> {
    if let Some(cached) = START_APPS_CACHE
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .as_ref()
    {
        return cached.clone();
    }
    let script = "Get-StartApps | ForEach-Object { \"$($_.Name)|$($_.AppID)\" }";
    let out = run_powershell(script).unwrap_or_default();
    let list: Vec<(String, String)> = out
        .lines()
        .filter_map(|line| {
            let (name, aumid) = line.split_once('|')?;
            Some((name.trim().to_string(), aumid.trim().to_string()))
        })
        .collect();
    *START_APPS_CACHE
        .lock()
        .unwrap_or_else(|p| p.into_inner()) = Some(list.clone());
    list
}

/// 按名称解析 AUMID（精确匹配优先，其次包含匹配）
fn resolve_aumid(name: &str) -> Option<String> {
    let target = name.to_lowercase();
    let apps = load_start_apps();
    if let Some(found) = apps.iter().find(|(n, _)| n.to_lowercase() == target) {
        return Some(found.1.clone());
    }
    apps.iter()
        .find(|(n, _)| n.to_lowercase().contains(&target))
        .map(|(_, a)| a.clone())
}

#[tauri::command]
pub fn open_app(app_name: String) -> CmdResult<()> {
    if app_name.trim().is_empty() {
        return Err(AppError::Generic("应用名称为空".into()));
    }
    // 1) UWP / Microsoft Store 应用：经 AUMID 用 explorer 启动
    if let Some(aumid) = resolve_aumid(&app_name) {
        let target = format!("shell:AppsFolder\\{}", aumid);
        if Command::new("explorer")
            .arg(&target)
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
        {
            return Ok(());
        }
    }
    // 2) 桌面程序 / 文档：经 shell "start" 启动
    let res = Command::new("cmd")
        .arg("/c")
        .arg("start")
        .arg("")
        .arg(&app_name)
        .output();
    match res {
        Ok(o) if o.status.success() => Ok(()),
        Ok(o) => Err(AppError::Generic(format!(
            "无法打开应用 '{}'：{}",
            app_name,
            String::from_utf8_lossy(&o.stderr)
        ))),
        Err(e) => Err(AppError::Generic(format!("启动应用失败：{}", e))),
    }
}

// ===========================================================================
// 打开文件 / 文件夹
// ===========================================================================

#[tauri::command]
pub fn open_file(path: String) -> CmdResult<()> {
    if path.trim().is_empty() {
        return Err(AppError::Generic("路径为空".into()));
    }
    open::that(&path).map_err(|e| AppError::Generic(format!("无法打开文件：{}", e)))?;
    Ok(())
}

// ===========================================================================
// 受控命令执行（超时 + 输出截断 + 危险命令黑名单）
// ===========================================================================

/// 命令执行结果
#[derive(Serialize)]
pub struct RunCommandResult {
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
    pub timed_out: bool,
}

#[tauri::command]
pub fn run_command(
    command: String,
    cwd: Option<String>,
    timeout_secs: Option<u32>,
) -> CmdResult<RunCommandResult> {
    if command.trim().is_empty() {
        return Err(AppError::Generic("命令为空".into()));
    }
    // 危险命令黑名单（尽量收缩攻击面）
    let lower = command.to_lowercase();
    let blocked = [
        "format ", "del ", "deltree", "rmdir /s", "rd /s", "rm -rf", "shutdown ",
        "reg delete", "net user", "net localgroup", "takeown", "icacls ", "bcdedit ",
        "diskpart", "cipher ", "mkfs", "netsh ", "sc delete", "taskkill /f /im explorer",
    ];
    if blocked.iter().any(|b| lower.contains(b)) {
        return Err(AppError::Generic(format!("命令被安全策略禁止：{}", command)));
    }

    let timeout = timeout_secs.unwrap_or(30).clamp(1, 300) as u64;

    let mut cmd = Command::new(if cfg!(target_os = "windows") { "cmd" } else { "sh" });
    if cfg!(target_os = "windows") {
        cmd.arg("/c").arg(command.as_str());
    } else {
        cmd.arg("-c").arg(command.as_str());
    }
    if let Some(cwd) = cwd.as_ref() {
        if !cwd.trim().is_empty() {
            cmd.current_dir(cwd);
        }
    }

    let mut child = cmd
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| AppError::Generic(format!("无法启动命令：{}", e)))?;

    // 取出管道，交给两个读线程并发读取（防止某一管道写满阻塞子进程）
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    let out_t = thread::spawn(move || {
        use std::io::Read;
        let mut s = String::new();
        let mut buf = [0u8; 4096];
        if let Some(mut so) = stdout {
            loop {
                match so.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => s.push_str(&String::from_utf8_lossy(&buf[..n])),
                    Err(_) => break,
                }
            }
        }
        s
    });
    let err_t = thread::spawn(move || {
        use std::io::Read;
        let mut s = String::new();
        let mut buf = [0u8; 4096];
        if let Some(mut se) = stderr {
            loop {
                match se.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => s.push_str(&String::from_utf8_lossy(&buf[..n])),
                    Err(_) => break,
                }
            }
        }
        s
    });

    // 轮询等待进程退出（带超时），不阻塞命令循环的调用方线程
    let deadline = Instant::now() + Duration::from_secs(timeout);
    let mut timed_out = false;
    let status = loop {
        match child.try_wait() {
            Ok(Some(s)) => break Some(s),
            Ok(None) => {
                if Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    timed_out = true;
                    break None;
                }
                thread::sleep(Duration::from_millis(50));
            }
            Err(e) => return Err(AppError::Generic(format!("等待命令失败：{}", e))),
        }
    };

    let out = out_t.join().unwrap_or_default();
    let err = err_t.join().unwrap_or_default();
    let exit_code = status.map(|s| s.code().unwrap_or(-1)).unwrap_or(-1);

    Ok(RunCommandResult {
        exit_code,
        stdout: truncate_utf8(&out, 20000),
        stderr: truncate_utf8(&err, 20000),
        timed_out,
    })
}

// ===========================================================================
// 系统媒体键控制（SendInput 模拟硬件媒体键，对所有播放器生效）
// ===========================================================================

#[cfg(target_os = "windows")]
#[tauri::command]
pub fn media_control(action: String) -> CmdResult<()> {
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        VK_MEDIA_NEXT_TRACK, VK_MEDIA_PLAY_PAUSE, VK_MEDIA_PREV_TRACK, VK_MEDIA_STOP,
        VK_VOLUME_DOWN, VK_VOLUME_MUTE, VK_VOLUME_UP, VIRTUAL_KEY,
    };
    let vk: VIRTUAL_KEY = match action.as_str() {
        "play_pause" => VK_MEDIA_PLAY_PAUSE,
        "next" => VK_MEDIA_NEXT_TRACK,
        "prev" => VK_MEDIA_PREV_TRACK,
        "stop" => VK_MEDIA_STOP,
        "mute" => VK_VOLUME_MUTE,
        "volume_up" => VK_VOLUME_UP,
        "volume_down" => VK_VOLUME_DOWN,
        _ => return Err(AppError::Generic(format!("未知媒体操作：{}", action))),
    };
    unsafe {
        send_media_key(vk, false);
        send_media_key(vk, true);
    }
    Ok(())
}

#[cfg(target_os = "windows")]
unsafe fn send_media_key(vk: windows::Win32::UI::Input::KeyboardAndMouse::VIRTUAL_KEY, up: bool) {
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP, SendInput,
    };
    let input = INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: vk,
                wScan: 0,
                dwFlags: if up { KEYEVENTF_KEYUP } else { KEYBD_EVENT_FLAGS(0) },
                time: 0,
                dwExtraInfo: 0,
            },
        },
    };
    SendInput(1, &input, std::mem::size_of::<INPUT>() as i32);
}

// ===========================================================================
// 锁屏
// ===========================================================================

#[cfg(target_os = "windows")]
#[tauri::command]
pub fn lock_screen() -> CmdResult<()> {
    use windows::Win32::System::Shutdown::LockWorkStation;
    unsafe {
        if !LockWorkStation().as_bool() {
            return Err(AppError::Generic("锁定屏幕失败".into()));
        }
    }
    Ok(())
}

// ===========================================================================
// 电池信息（WMI）
// ===========================================================================

/// 电池信息（台式机无电池时 percent 为 null）
#[derive(Serialize)]
pub struct BatteryInfo {
    pub percent: Option<u32>,
    pub status: String,
    pub on_ac: bool,
}

#[cfg(target_os = "windows")]
#[tauri::command]
pub fn get_battery() -> CmdResult<BatteryInfo> {
    let script = "(Get-WmiObject Win32_Battery)[0] | Select-Object EstimatedChargeRemaining,BatteryStatus,EstimatedRunTime | ConvertTo-Json -Compress";
    let out = run_powershell(script).map_err(AppError::Generic)?;
    let v: serde_json::Value = serde_json::from_str(&out)
        .map_err(|e| AppError::Generic(format!("解析电池信息失败：{}", e)))?;
    let percent = v["EstimatedChargeRemaining"].as_u64().map(|n| n as u32);
    let status_code = v["BatteryStatus"].as_u64().unwrap_or(0);
    let on_ac = matches!(status_code, 2 | 6 | 7 | 8 | 9 | 11);
    let status = if percent.is_none() {
        "无电池（台式机）".to_string()
    } else {
        match status_code {
            1 => "放电中",
            2 => "接通电源",
            3 => "已充满",
            4 => "电量低",
            5 => "电量极低",
            6 | 7 | 8 | 9 => "充电中",
            _ => "未知",
        }
        .to_string()
    };
    Ok(BatteryInfo {
        percent,
        status,
        on_ac,
    })
}

// ===========================================================================
// 系统主音量（Core Audio）
// ===========================================================================

#[cfg(target_os = "windows")]
fn with_endpoint_volume<F, T>(f: F) -> CmdResult<T>
where
    F: FnOnce(&windows::Win32::Media::Audio::IAudioEndpointVolume) -> CmdResult<T>,
{
    use windows::core::Interface;
    use windows::Win32::Media::Audio::{
        eConsole, eRender, IAudioEndpointVolume, IMMDeviceEnumerator, MMDeviceEnumerator,
    };
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_APARTMENTTHREADED,
    };
    unsafe {
        // best-effort：线程可能已被 Tauri/WebView 初始化过，忽略返回值
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let enumerator: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
                .map_err(|e| AppError::Generic(format!("音频枚举创建失败：{}", e)))?;
        let device = enumerator
            .GetDefaultAudioEndpoint(eRender, eConsole)
            .map_err(|e| AppError::Generic(format!("获取默认音频设备失败：{}", e)))?;
        let volume: IAudioEndpointVolume = device
            .Activate(CLSCTX_ALL, None)
            .map_err(|e| AppError::Generic(format!("激活音量接口失败：{}", e)))?;
        f(&volume)
    }
}

#[cfg(target_os = "windows")]
#[tauri::command]
pub fn get_volume() -> CmdResult<u32> {
    with_endpoint_volume(|v| {
        let level = unsafe { v.GetMasterVolumeLevelScalar() }
            .map_err(|e| AppError::Generic(format!("读取音量失败：{}", e)))?;
        Ok((level * 100.0).round() as u32)
    })
}

#[cfg(target_os = "windows")]
#[tauri::command]
pub fn set_volume(level: u32) -> CmdResult<()> {
    let lvl = (level.clamp(0, 100) as f32) / 100.0;
    with_endpoint_volume(|v| {
        unsafe { v.SetMasterVolumeLevelScalar(lvl, std::ptr::null()) }
            .map_err(|e| AppError::Generic(format!("设置音量失败：{}", e)))?;
        Ok(())
    })
}

// ===========================================================================
// 系统通知（WinRT Toast，unpackaged 应用经 AUMID 注册）
// ===========================================================================

#[cfg(target_os = "windows")]
#[tauri::command]
pub fn notify(title: String, body: String) -> CmdResult<()> {
    use windows::core::HSTRING;
    use windows::Data::Xml::Dom::XmlDocument;
    use windows::UI::Notifications::{ToastNotification, ToastNotificationManager};

    // unpackaged 应用发 toast 需要 AUMID 已在注册表登记（best-effort，无管理员权限也可写）
    register_aumid_if_needed();

    let xml = format!(
        "<toast><visual><binding template=\"ToastText02\"><text>{}</text><text>{}</text></binding></visual></toast>",
        escape_xml(&title),
        escape_xml(&body)
    );
    let doc = XmlDocument::new()
        .map_err(|e| AppError::Generic(format!("创建 XML 文档失败：{}", e)))?;
    doc.LoadXml(HSTRING::from(xml))
        .map_err(|e| AppError::Generic(format!("加载 XML 失败：{}", e)))?;
    let toast = ToastNotification::CreateToastNotification(&doc)
        .map_err(|e| AppError::Generic(format!("创建 Toast 失败：{}", e)))?;
    let notifier = ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from("DeskPet"))
        .map_err(|e| AppError::Generic(format!("创建通知器失败：{}", e)))?;
    notifier
        .Show(&toast)
        .map_err(|e| AppError::Generic(format!("显示通知失败：{}", e)))?;
    Ok(())
}

#[cfg(target_os = "windows")]
fn register_aumid_if_needed() {
    // 在 HKCU 注册 AppUserModelID（best-effort），使未打包应用也能弹出 Toast
    let key = "HKCU\\Software\\Classes\\AppUserModelId\\DeskPet";
    let _ = Command::new("reg")
        .args(["add", key, "/v", "DisplayName", "/t", "REG_SZ", "/d", "DeskPet", "/f"])
        .output();
}

/// 转义 XML 特殊字符，防止标题/正文破坏 Toast XML
fn escape_xml(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}
