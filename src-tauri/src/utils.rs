/// 工具函数模块：Token 生成、数据目录、HTTP 辅助、日志、日期
use rand::Rng;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::Emitter;

use crate::errors::AppError;

/// 生成随机 hex token（32 字符）
pub(crate) fn generate_token() -> String {
    let mut rng = rand::thread_rng();
    let bytes: Vec<u8> = (0..16).map(|_| rng.gen()).collect();
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

/// 获取应用数据目录 (%APPDATA%/desk-pet) — C 盘加密配置目录
pub fn get_data_dir() -> Result<PathBuf, AppError> {
    let appdata = std::env::var("APPDATA")
        .map_err(|e| AppError::Io(format!("APPDATA env not found: {}", e)))?;
    let dir = PathBuf::from(appdata).join("desk-pet");
    fs::create_dir_all(&dir)
        .map_err(|e| AppError::Io(format!("Failed to create data dir: {}", e)))?;
    Ok(dir)
}

/// 检测是否为开发环境（exe 在 target/debug 或 target/release 下）
fn is_dev_mode() -> bool {
    if let Ok(exe) = std::env::current_exe() {
        exe.to_string_lossy().contains("target\\debug")
            || exe.to_string_lossy().contains("target\\release")
    } else {
        false
    }
}

/// 向上查找项目根目录（包含 package.json 的目录）
fn find_project_root() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let mut current = exe.parent()?;
    for _ in 0..10 {
        if current.join("package.json").exists() || current.join("Cargo.toml").exists() {
            return Some(current.to_path_buf());
        }
        current = current.parent()?;
    }
    None
}

/// 获取应用基准目录
///
/// - 开发环境：向上查找到含 package.json / Cargo.toml 的项目根目录
/// - 打包环境：exe 同级目录
///   用于定位 public/、server/ 等模型与资源目录（这些在开发期位于项目根，
///   打包后通常随 exe 一起分发在同级目录）。
pub fn get_app_base_dir() -> PathBuf {
    if let Some(root) = find_project_root() {
        return root;
    }
    std::env::current_exe()
        .ok()
        .and_then(|e| e.parent().map(|p| p.to_path_buf()))
        .unwrap_or_default()
}

/// 检测目录是否可写
fn is_dir_writable(dir: &Path) -> bool {
    let test_file = dir.join(".write_test");
    match fs::File::create(&test_file) {
        Ok(_) => {
            let _ = fs::remove_file(&test_file);
            true
        }
        Err(_) => false,
    }
}

/// 获取项目数据目录
///
/// - 开发环境：项目根目录/data/
/// - 打包环境：exe 同级目录/data/（若不可写则回退到 %APPDATA%\desk-pet\data\）
pub fn get_project_data_dir() -> Result<PathBuf, AppError> {
    // 开发环境：项目根目录/data/
    if is_dev_mode() {
        if let Some(root) = find_project_root() {
            let data_dir = root.join("data");
            fs::create_dir_all(&data_dir)
                .map_err(|e| AppError::Io(format!("Failed to create project data dir: {}", e)))?;
            return Ok(data_dir);
        }
    }

    // 打包环境：exe 同级目录/data/
    let exe_dir = std::env::current_exe()
        .map_err(|e| AppError::Io(e.to_string()))?
        .parent()
        .ok_or_else(|| AppError::Io("Cannot get exe parent dir".into()))?
        .to_path_buf();

    let data_dir = exe_dir.join("data");
    if is_dir_writable(&exe_dir) {
        fs::create_dir_all(&data_dir)
            .map_err(|e| AppError::Io(format!("Failed to create project data dir: {}", e)))?;
        Ok(data_dir)
    } else {
        // 回退到 %APPDATA%\desk-pet\data\
        let fallback = get_data_dir()?.join("data");
        fs::create_dir_all(&fallback)
            .map_err(|e| AppError::Io(format!("Failed to create fallback data dir: {}", e)))?;
        Ok(fallback)
    }
}

/// 获取临时文件目录（项目数据目录/temp/）
pub fn get_temp_dir() -> Result<PathBuf, AppError> {
    let temp = get_project_data_dir()?.join("temp");
    fs::create_dir_all(&temp)
        .map_err(|e| AppError::Io(format!("Failed to create temp dir: {}", e)))?;
    Ok(temp)
}

/// 确保所有项目子目录存在
pub fn ensure_project_dirs() -> Result<(), AppError> {
    let data_dir = get_project_data_dir()?;
    let subdirs = ["config", "sessions", "memory", "plugins", "mcp", "logs"];
    for sub in &subdirs {
        fs::create_dir_all(data_dir.join(sub))
            .map_err(|e| AppError::Io(format!("Failed to create dir {}: {}", sub, e)))?;
    }
    let temp_dir = get_temp_dir()?;
    let temp_subdirs = ["screenshots", "audio", "cache"];
    for sub in &temp_subdirs {
        fs::create_dir_all(temp_dir.join(sub))
            .map_err(|e| AppError::Io(format!("Failed to create temp dir {}: {}", sub, e)))?;
    }
    Ok(())
}

/// 递归计算目录大小（字节）
pub fn get_dir_size(dir: &PathBuf) -> u64 {
    if !dir.exists() {
        return 0;
    }
    let mut total: u64 = 0;
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                total += get_dir_size(&path);
            } else if let Ok(metadata) = entry.metadata() {
                total += metadata.len();
            }
        }
    }
    total
}

/// 清理超过 max_age_hours 的临时文件
pub fn cleanup_temp_files(max_age_hours: u64) -> Result<u64, AppError> {
    let temp_dir = get_temp_dir()?;
    let cutoff = SystemTime::now() - Duration::from_secs(max_age_hours * 3600);
    let mut deleted_count: u64 = 0;

    fn cleanup_dir(dir: &PathBuf, cutoff: SystemTime, deleted: &mut u64) {
        if let Ok(entries) = fs::read_dir(dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    cleanup_dir(&path, cutoff, deleted);
                    // 如果目录现在为空，删除它
                    if fs::read_dir(&path)
                        .map(|mut d| d.next().is_none())
                        .unwrap_or(false)
                    {
                        let _ = fs::remove_dir(&path);
                    }
                } else if let Ok(metadata) = entry.metadata() {
                    if let Ok(modified) = metadata.modified() {
                        if modified < cutoff && fs::remove_file(&path).is_ok() {
                            *deleted += 1;
                        }
                    }
                }
            }
        }
    }

    cleanup_dir(&temp_dir, cutoff, &mut deleted_count);
    Ok(deleted_count)
}

/// 生成 JSON Content-Type header（编译时保证格式正确，不会失败）
pub fn json_header() -> tiny_http::Header {
    "Content-Type: application/json"
        .parse()
        .expect("BUG: hardcoded Content-Type header failed to parse")
}

/// 安全解析 Content-Type header（用于动态 MIME 类型）
pub fn parse_content_type(mime: &str) -> tiny_http::Header {
    format!("Content-Type: {}", mime)
        .parse()
        .expect("BUG: dynamic Content-Type header failed to parse")
}

/// 安全解析 CORS header
pub fn cors_header() -> tiny_http::Header {
    "Access-Control-Allow-Origin: *"
        .parse()
        .expect("BUG: CORS header failed to parse")
}

/// 读取 HTTP 请求 body
pub fn read_body(request: &mut tiny_http::Request) -> String {
    let mut body = String::new();
    let _ = request.as_reader().read_to_string(&mut body);
    body
}

/// Convert unix millis to YYYY-MM-DD string
pub fn chrono_timestamp_to_date(millis: u64) -> String {
    let secs = millis / 1000;
    let days = secs / 86400;
    // Simple date calculation from epoch (1970-01-01)
    let mut y = 1970u32;
    let mut remaining = days;
    loop {
        let days_in_year =
            if y.is_multiple_of(4) && (!y.is_multiple_of(100) || y.is_multiple_of(400)) {
                366
            } else {
                365
            };
        if remaining < days_in_year as u64 {
            break;
        }
        remaining -= days_in_year as u64;
        y += 1;
    }
    let mut m = 1u32;
    let days_in_months = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    for (i, &dim) in days_in_months.iter().enumerate() {
        let dim =
            if i == 1 && y.is_multiple_of(4) && (!y.is_multiple_of(100) || y.is_multiple_of(400)) {
                dim + 1
            } else {
                dim
            };
        if remaining < dim {
            m = (i + 1) as u32;
            break;
        }
        remaining -= dim;
    }
    format!("{:04}-{:02}-{:02}", y, m, remaining + 1)
}

/// Append a log entry
pub fn append_log(data_dir: &std::path::Path, level: &str, message: &str) -> Result<(), AppError> {
    let log_path = data_dir.join("logs.json");
    let mut logs: Vec<serde_json::Value> = if log_path.exists() {
        serde_json::from_str(&fs::read_to_string(&log_path).unwrap_or_default()).unwrap_or_default()
    } else {
        vec![]
    };
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    logs.push(serde_json::json!({
        "level": level,
        "message": message,
        "timestamp": now_ms.to_string(),
    }));
    // Keep last 500 entries
    if logs.len() > 500 {
        logs = logs.split_off(logs.len() - 500);
    }
    let _ = fs::write(&log_path, serde_json::to_string(&logs).unwrap_or_default());
    Ok(())
}

/// Read log entries
pub fn read_logs(data_dir: &std::path::Path) -> Vec<serde_json::Value> {
    let log_path = data_dir.join("logs.json");
    if log_path.exists() {
        serde_json::from_str(&fs::read_to_string(&log_path).unwrap_or_default()).unwrap_or_default()
    } else {
        vec![]
    }
}

/// Default empty providers configuration
pub fn default_providers_json() -> String {
    serde_json::json!({
        "configs": [],
        "activeChatId": null,
        "activeTTSId": null,
        "activeSTTId": null,
        "activePerceptionId": null,
        "voice": {
            "ttsEnabled": false,
            "ttsAutoPlay": true,
            "ttsLipSync": false,
            "ttsVolume": 0.8,
            "sttEnabled": false,
            "sttEmotionLink": true,
            "sttLanguage": "zh"
        }
    })
    .to_string()
}

/// Emit memory update to pet app frontend
pub fn emit_memory_update(app: &tauri::AppHandle, data_dir: &std::path::Path) {
    let memory_path = data_dir.join("memory.json");
    if let Ok(content) = fs::read_to_string(&memory_path) {
        if let Ok(data) = serde_json::from_str::<serde_json::Value>(&content) {
            let _ = app.emit("admin-memory-update", data);
        }
    }
}
