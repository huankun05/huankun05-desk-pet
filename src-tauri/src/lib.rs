use serde::Serialize;
use std::fs;
use std::sync::Mutex;
use tauri::Emitter;
use tauri::Manager;

mod admin_server;
mod backend;
mod crypto;
mod errors;
mod mcp;
mod service;
mod shortcuts;
mod tray;
mod utils;
mod wake_word;

/// 重启 Hermes Gateway（端口 8765）。由托盘菜单「重启后端」调用。
///
/// 流程：先停止旧进程 → 等待端口释放 → 用与启动时相同的 python 命令重新拉起。
/// 前端 WebSocket 已具备指数退避自动重连，重启完成后会自动恢复连接。
pub fn restart_hermes_gateway(app: &tauri::AppHandle) -> Result<(), String> {
    let hermes_port: u16 = 8765;
    let hermes_id = format!("service_{}", hermes_port);

    // 1) 先停止旧进程（service_start_raw 注册时也会 kill 同 id 旧进程，但显式先停更稳）
    {
        let manager = app.state::<crate::service::ServiceManager>();
        let _ = crate::service::service_stop_by_id(manager.inner(), &hermes_id);
    }

    // 2) 等待端口释放（最多 3 秒；旧进程被 kill 后端口通常几百毫秒内释放）
    let mut waited_ms = 0u64;
    while crate::service::check_http_health(hermes_port) && waited_ms < 3000 {
        std::thread::sleep(std::time::Duration::from_millis(100));
        waited_ms += 100;
    }

    // 3) 解析 python 命令（打包后用 bootstrap 出来的 venv，dev 用项目 venv/系统 python）
    //    首次运行确保 venv 已就绪（仅打包环境生效，best-effort，不阻塞重启）
    let _ = crate::backend::ensure_backend(app);
    let python_cmd = crate::backend::resolve_python(app);
    let project_root = crate::backend::backend_root(app)
        .to_string_lossy()
        .to_string();

    let args = vec![
        "-m".to_string(),
        "server.hermes_gateway_server".to_string(),
        "--port".to_string(),
        hermes_port.to_string(),
    ];

    match crate::service::service_start_raw(&python_cmd, &args, &project_root, hermes_port, app) {
        Ok(_) => {
            println!("[Hermes Gateway] Restart requested on port {}", hermes_port);
            Ok(())
        }
        Err(e) => Err(format!("重启 Hermes Gateway 失败: {:?}", e)),
    }
}

use crate::crypto::*;
use crate::errors::{AppError, CmdResult};
use crate::utils::*;

/// 管理后台鉴权状态
pub(crate) struct AdminState {
    token: Mutex<String>,
}

/// 关闭行为配置（"exit" | "minimize_to_tray"），由前端同步
static CLOSE_BEHAVIOR: Mutex<String> = Mutex::new(String::new());

/// 读取关闭行为（默认 minimize_to_tray）
fn close_behavior() -> String {
    let guard = CLOSE_BEHAVIOR.lock().unwrap_or_else(|p| p.into_inner());
    if guard.is_empty() {
        "minimize_to_tray".to_string()
    } else {
        guard.clone()
    }
}

/// 获取管理后台鉴权 token（Admin 前端通过 Tauri IPC 获取）
#[tauri::command]
fn get_admin_token(state: tauri::State<'_, AdminState>) -> CmdResult<String> {
    Ok(state
        .token
        .lock()
        .map_err(|_| AppError::Generic("token lock poisoned".into()))?
        .clone())
}

#[derive(Serialize)]
struct CursorPosition {
    x: f64,
    y: f64,
}

/// 一次性返回鼠标屏幕坐标 + 窗口位置 + 窗口大小
#[derive(Serialize)]
struct CursorWindowInfo {
    cursor_x: f64,
    cursor_y: f64,
    window_x: f64,
    window_y: f64,
    window_w: f64,
    window_h: f64,
}

/// 获取鼠标在屏幕上的绝对坐标（Windows API）
#[tauri::command]
fn get_cursor_position() -> CmdResult<CursorPosition> {
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::Foundation::POINT;
        use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;
        unsafe {
            let mut point = POINT::default();
            GetCursorPos(&mut point).map_err(|e| format!("GetCursorPos failed: {}", e))?;
            Ok(CursorPosition {
                x: point.x as f64,
                y: point.y as f64,
            })
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        Err("Cursor tracking only supported on Windows".into())
    }
}

/// 一次性获取鼠标位置 + 窗口几何信息（用于工具栏穿透检测）
#[tauri::command]
fn get_cursor_window_info(_app: tauri::AppHandle) -> CmdResult<CursorWindowInfo> {
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::Foundation::POINT;
        use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;
        unsafe {
            let mut point = POINT::default();
            GetCursorPos(&mut point).map_err(|e| format!("GetCursorPos failed: {}", e))?;

            if let Some(window) = _app.get_webview_window("main") {
                let pos = window.outer_position().map_err(|e| e.to_string())?;
                let size = window.outer_size().map_err(|e| e.to_string())?;
                Ok(CursorWindowInfo {
                    cursor_x: point.x as f64,
                    cursor_y: point.y as f64,
                    window_x: pos.x as f64,
                    window_y: pos.y as f64,
                    window_w: size.width as f64,
                    window_h: size.height as f64,
                })
            } else {
                Err("Window not found".into())
            }
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        Err("Cursor tracking only supported on Windows".into())
    }
}

/// 检查 Ollama 是否已安装（ollama CLI 是否在 PATH 中）
#[tauri::command]
fn check_ollama_installed() -> bool {
    std::process::Command::new("ollama")
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// 检查网络连接是否可用（通过连接常见服务检测离线状态）
#[tauri::command]
fn check_network_online() -> bool {
    // 尝试连接 DNS 服务器（端口 53/80）检测网络可用性
    use std::net::TcpStream;
    use std::time::Duration;
    let timeout = Duration::from_secs(2);
    // 依次尝试多个地址
    for addr in &["1.1.1.1:80", "8.8.8.8:53", "223.5.5.5:80"] {
        if let Ok(stream) = TcpStream::connect_timeout(&addr.parse().unwrap(), timeout) {
            drop(stream);
            return true;
        }
    }
    false
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

/// 切换锁定状态（供前端或托盘调用）
#[tauri::command]
fn toggle_lock_state(app: tauri::AppHandle) {
    let _ = app.emit("toggle-lock", ());
}

/// 前端同步关闭行为配置到 Rust 侧
#[tauri::command]
fn set_close_behavior(behavior: String) {
    let mut guard = CLOSE_BEHAVIOR.lock().unwrap_or_else(|p| p.into_inner());
    *guard = behavior;
}

/// 设置开机自启（通过 Windows 启动文件夹的 .lnk 快捷方式）
#[tauri::command]
fn set_autolaunch(enabled: bool) -> CmdResult<()> {
    let appdata = std::env::var("APPDATA").map_err(|e| format!("APPDATA not found: {}", e))?;
    let startup_dir =
        std::path::Path::new(&appdata).join("Microsoft\\Windows\\Start Menu\\Programs\\Startup");
    let lnk_path = startup_dir.join("desk-pet.lnk");

    if enabled {
        // 创建启动文件夹快捷方式
        let exe_path = std::env::current_exe().map_err(|e| e.to_string())?;
        let exe_str = exe_path.to_string_lossy().replace('\\', "/");
        let lnk_str = lnk_path.to_string_lossy().replace('\\', "/");

        // 使用 PowerShell WScript.Shell COM 创建 .lnk
        let ps_script = format!(
            "$ws = New-Object -ComObject WScript.Shell; \
             $s = $ws.CreateShortcut('{}'); \
             $s.TargetPath = '{}'; \
             $s.WorkingDirectory = '{}'; \
             $s.Save()",
            lnk_str,
            exe_str,
            exe_path
                .parent()
                .map(|p| p.to_string_lossy().replace('\\', "/"))
                .unwrap_or_default()
        );

        let output = std::process::Command::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", &ps_script])
            .output()
            .map_err(|e| format!("Failed to run powershell: {}", e))?;

        if !output.status.success() {
            return Err(format!(
                "PowerShell failed: {}",
                String::from_utf8_lossy(&output.stderr)
            )
            .into());
        }
    } else {
        // 删除快捷方式（不存在时静默忽略）
        if lnk_path.exists() {
            fs::remove_file(&lnk_path).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// 查询开机自启是否已启用
#[tauri::command]
fn is_autolaunch_enabled() -> bool {
    let Ok(appdata) = std::env::var("APPDATA") else {
        return false;
    };
    let lnk_path = std::path::Path::new(&appdata)
        .join("Microsoft\\Windows\\Start Menu\\Programs\\Startup\\desk-pet.lnk");
    lnk_path.exists()
}

/// 打开主窗口的开发者工具（仅 debug 构建有效；release 构建中 devtools 不可用，静默忽略）
#[tauri::command]
fn open_devtools(app: tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        #[cfg(debug_assertions)]
        {
            window.open_devtools();
        }
    }
}

/// 设置主窗口置顶状态（同步设置面板"窗口置顶"开关）
#[tauri::command]
fn set_always_on_top(app: tauri::AppHandle, enabled: bool) -> CmdResult<()> {
    if let Some(window) = app.get_webview_window("main") {
        window
            .set_always_on_top(enabled)
            .map_err(|e| AppError::Generic(format!("设置窗口置顶失败: {}", e)))?;
    }
    Ok(())
}

/// 检查窗口位置是否在任意显示器可见区域内（用于防止多屏切换后消失）
#[tauri::command]
fn is_window_on_screen(x: f64, y: f64, w: f64, h: f64) -> bool {
    let monitors = match xcap::Monitor::all() {
        Ok(m) => m,
        Err(_) => return true, // 无法获取显示器信息时放行
    };
    let min_visible = 80.0; // 至少 80px 在屏幕内
    monitors.iter().any(|m| {
        let mx = m.x().unwrap_or(0) as f64;
        let my = m.y().unwrap_or(0) as f64;
        let mw = m.width().unwrap_or(1920) as f64;
        let mh = m.height().unwrap_or(1080) as f64;
        x + w - min_visible >= mx
            && x + min_visible <= mx + mw
            && y + h - min_visible >= my
            && y + min_visible <= my + mh
    })
}

/// 重置主窗口位置到默认值并清除保存的位置数据
#[tauri::command]
fn reset_window_position(app: tauri::AppHandle) -> CmdResult<()> {
    // 清除保存的位置文件
    let dir = get_data_dir()?;
    let path = dir.join("main_window_pos.json");
    if path.exists() {
        fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    // 重置窗口到默认位置（屏幕中央偏上）
    if let Some(window) = app.get_webview_window("main") {
        if let Ok(monitors) = xcap::Monitor::all() {
            if let Some(primary) = monitors.first() {
                let cx = primary.x().unwrap_or(0) + primary.width().unwrap_or(1920) as i32 / 2;
                let cy = primary.y().unwrap_or(0) + primary.height().unwrap_or(1080) as i32 / 3;
                window
                    .set_position(tauri::LogicalPosition::new(
                        (cx as f64) - 225.0,
                        (cy as f64) - 330.0,
                    ))
                    .map_err(|e| e.to_string())?;
            }
        }
    }
    Ok(())
}

/// 将设置窗口带到前台。
///
/// 角色模型（主窗口）的置顶状态由“角色模型置顶”开关单独控制，此处不变。
/// 设置窗口的置顶状态读取用户偏好（deskpet_settings.settingsAlwaysOnTop），
/// 默认 true，确保首次打开时能浮在模型之上；用户关闭该开关后则不再强制置顶。
#[tauri::command]
fn show_settings_window(app: tauri::AppHandle) -> CmdResult<()> {
    if let Some(window) = app.get_webview_window("settings") {
        // 解除最小化（show 不会取消最小化）
        let _ = window.unminimize();
        // 显示（关闭被拦截为 hide，需要重新显示）
        window.show().map_err(|e| e.to_string())?;
        // 读取用户保存的设置窗口置顶偏好，默认 true
        let settings_always_on_top = load_data("settings".to_string())
            .ok()
            .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
            .and_then(|v| v.get("settingsAlwaysOnTop").and_then(|v| v.as_bool()))
            .unwrap_or(true);
        window
            .set_always_on_top(settings_always_on_top)
            .map_err(|e| e.to_string())?;
        // 聚焦到前台
        window.set_focus().map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err("Settings window not found".into())
    }
}

/// 聊天面板：强制带到前台（解除最小化 + 显示 + 聚焦）。
/// 与 show_settings_window 同一套 Rust 窗口 API，保证从最小化态可靠唤回
/// （纯 JS 的 WebviewWindow.unminimize 在部分 Tauri 版本里对最小化态还原不可靠）。
#[tauri::command]
fn show_chat_window(app: tauri::AppHandle) -> CmdResult<()> {
    if let Some(window) = app.get_webview_window("chat-panel") {
        // 解除最小化（show 不会取消最小化）
        let _ = window.unminimize();
        // 显示（关闭/收起被拦截为 hide，需要重新显示）
        window.show().map_err(|e| e.to_string())?;
        // 聚焦到前台
        window.set_focus().map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err("Chat window not found".into())
    }
}

/// 保存数据到本地文件（敏感数据自动 DPAPI 加密）
#[tauri::command]
fn save_data(key: String, data: String) -> CmdResult<()> {
    let dir = get_data_dir()?;
    let path = dir.join(format!("{}.json", key));
    let storage_data = encrypt_if_sensitive(&key, &data)?;
    fs::write(&path, storage_data).map_err(|e| {
        eprintln!("[save_data] Failed to write {}: {}", key, e);
        e.to_string()
    })?;
    Ok(())
}

/// 从本地文件加载数据（自动检测并解密 DPAPI 加密数据）
#[tauri::command]
fn load_data(key: String) -> CmdResult<String> {
    let dir = get_data_dir()?;
    let path = dir.join(format!("{}.json", key));
    if !path.exists() {
        return Ok(String::new());
    }
    let content = fs::read_to_string(&path).map_err(|e| {
        eprintln!("[load_data] Failed to read {}: {}", key, e);
        e.to_string()
    })?;
    decrypt_file_content(&content)
}

/// 剪贴板内容类型
#[derive(Serialize)]
struct ClipboardContent {
    kind: String, // "text" | "image"
    data: String, // 文本内容或 base64 图片
}

/// 截取主屏幕并返回 base64 JPEG
#[tauri::command]
fn capture_screenshot() -> CmdResult<String> {
    use xcap::Monitor;
    let monitors = Monitor::all().map_err(|e| format!("Failed to list monitors: {}", e))?;
    let primary = monitors.first().ok_or("No monitor found")?;
    let image = primary
        .capture_image()
        .map_err(|e| format!("Failed to capture: {}", e))?;

    // 压缩为 JPEG + base64
    use std::io::Cursor;
    let mut buffer: Vec<u8> = Vec::new();
    image
        .write_to(&mut Cursor::new(&mut buffer), image::ImageFormat::Jpeg)
        .map_err(|e| format!("Failed to encode JPEG: {}", e))?;
    let encoded = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &buffer);
    Ok(format!("data:image/jpeg;base64,{}", encoded))
}

/// 读取剪贴板内容（优先图片，回退文本）
#[tauri::command]
fn read_clipboard() -> CmdResult<ClipboardContent> {
    let mut clipboard =
        arboard::Clipboard::new().map_err(|e| format!("Failed to open clipboard: {}", e))?;

    // 优先尝试图片
    if let Ok(image) = clipboard.get_image() {
        use std::io::Cursor;
        let img = image::RgbaImage::from_raw(
            image.width as u32,
            image.height as u32,
            image.bytes.into_owned(),
        )
        .ok_or("Failed to create image from clipboard data")?;
        let mut buffer: Vec<u8> = Vec::new();
        img.write_to(&mut Cursor::new(&mut buffer), image::ImageFormat::Jpeg)
            .map_err(|e| format!("Failed to encode clipboard image: {}", e))?;
        let encoded = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &buffer);
        return Ok(ClipboardContent {
            kind: "image".into(),
            data: format!("data:image/jpeg;base64,{}", encoded),
        });
    }

    // 回退到文本
    let text = clipboard
        .get_text()
        .map_err(|e| format!("Clipboard is empty: {}", e))?;
    Ok(ClipboardContent {
        kind: "text".into(),
        data: text,
    })
}

// ===== 文件操作命令 =====

/// 目录条目
#[derive(Serialize)]
struct FileEntry {
    name: String,
    is_dir: bool,
    size: u64,
}

/// 写入文本文件（限制在项目数据目录内）
#[tauri::command]
fn write_file(path: String, content: String, append: Option<bool>) -> CmdResult<()> {
    let requested = std::path::PathBuf::from(&path);

    // 限制仅允许项目数据目录及其子目录
    let data_dir = crate::utils::get_project_data_dir()?;
    let canonical_data = data_dir.canonicalize().unwrap_or(data_dir.clone());
    let canonical_req = requested
        .parent()
        .and_then(|p| p.canonicalize().ok())
        .unwrap_or(canonical_data.clone());
    if !canonical_req.starts_with(&canonical_data) {
        return Err(AppError::Generic(
            "Access denied: path must be within project data directory".to_string(),
        ));
    }

    if let Some(parent) = requested.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create dirs: {}", e))?;
    }
    if append.unwrap_or(false) {
        use std::io::Write;
        let mut file = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&requested)
            .map_err(|e| format!("Failed to open file: {}", e))?;
        file.write_all(content.as_bytes())
            .map_err(|e| format!("Failed to write: {}", e))?;
    } else {
        fs::write(&requested, &content).map_err(|e| format!("Failed to write file: {}", e))?;
    }
    Ok(())
}

/// 删除文件（仅允许项目数据目录内，用于备份滚动清理）
#[tauri::command]
fn delete_file(path: String) -> CmdResult<()> {
    let requested = std::path::PathBuf::from(&path);

    // 限制仅允许项目数据目录及其子目录
    let data_dir = crate::utils::get_project_data_dir()?;
    let canonical_data = data_dir.canonicalize().unwrap_or(data_dir.clone());
    let canonical_req = requested.canonicalize().unwrap_or(requested.clone());
    if !canonical_req.starts_with(&canonical_data) {
        return Err(AppError::Generic(
            "Access denied: path must be within project data directory".to_string(),
        ));
    }
    if !requested.exists() {
        return Ok(());
    }
    if requested.is_dir() {
        return Err(AppError::Generic("Cannot delete a directory".to_string()));
    }
    fs::remove_file(&requested).map_err(|e| format!("Failed to delete file: {}", e))?;
    Ok(())
}

/// 用系统默认浏览器打开 URL
#[tauri::command]
fn open_url(url: String) -> CmdResult<()> {
    // 简单校验，避免注入任意 shell 命令
    let lower = url.to_lowercase();
    if !(lower.starts_with("http://") || lower.starts_with("https://")) {
        return Err(AppError::Generic(
            "Invalid URL: must start with http:// or https://".to_string(),
        ));
    }
    open::that(&url).map_err(|e| AppError::Generic(format!("Failed to open URL: {}", e)))?;
    Ok(())
}

/// 网络搜索结果条目
#[derive(Serialize)]
struct WebSearchResult {
    title: String,
    url: String,
    snippet: String,
}

/// 网络搜索（使用 DuckDuckGo HTML 端点，无需 API key）
#[tauri::command]
fn web_search(query: String, max_results: Option<u8>) -> CmdResult<Vec<WebSearchResult>> {
    let max = max_results.unwrap_or(5).min(10) as usize;

    let resp = ureq::get("https://html.duckduckgo.com/html/")
        .set(
            "User-Agent",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        )
        .query("q", &query)
        .call()
        .map_err(|e| AppError::Generic(format!("搜索请求失败: {}", e)))?;

    let html = resp
        .into_string()
        .map_err(|e| AppError::Generic(format!("读取响应失败: {}", e)))?;

    Ok(parse_ddg_results(&html, max))
}

/// 解析 DuckDuckGo HTML 端点结果页
fn parse_ddg_results(html: &str, max: usize) -> Vec<WebSearchResult> {
    let mut results = Vec::new();
    // 结果链接以 class="result__a" 标记，split 后每段以 ' href="...">TITLE</a>...' 开头
    let parts: Vec<&str> = html.split("class=\"result__a\"").collect();

    for segment in parts.iter().skip(1) {
        if results.len() >= max {
            break;
        }
        // 提取 href
        let Some(href) = find_attr_value(segment, "href") else {
            continue;
        };
        let Some(url) = decode_ddg_redirect(&href) else {
            continue;
        };
        // 提取标题：href="..." 之后到 </a>
        let Some(title) = find_link_text(segment) else {
            continue;
        };
        // 提取 snippet：在 result__snippet 标记之后
        let snippet = find_snippet(segment).unwrap_or_default();

        let title = decode_html_entities(&strip_tags(&title));
        let snippet = decode_html_entities(&strip_tags(&snippet));
        if !title.trim().is_empty() {
            results.push(WebSearchResult {
                title: title.trim().to_string(),
                url,
                snippet: snippet.trim().to_string(),
            });
        }
    }
    results
}

/// 在字符串中查找 attr="value" 并返回 value
fn find_attr_value(s: &str, attr: &str) -> Option<String> {
    let needle = format!("{}=\"", attr);
    let start = s.find(&needle)? + needle.len();
    let rest = &s[start..];
    let end = rest.find('"')?;
    Some(rest[..end].to_string())
}

/// 提取链接文本：找到第一个 "> 到 </a> 之间
fn find_link_text(s: &str) -> Option<String> {
    let close = s.find("\">")?;
    let rest = &s[close + 2..];
    let end = rest.find("</a>")?;
    Some(rest[..end].to_string())
}

/// 在 segment 中查找 result__snippet 之后的文本
fn find_snippet(s: &str) -> Option<String> {
    let idx = s.find("result__snippet")?;
    let rest = &s[idx..];
    // 跳过到第一个 > （标签结束）
    let tag_end = rest.find('>')?;
    let text_start = &rest[tag_end + 1..];
    let text_end = text_start
        .find("</a>")
        .or_else(|| text_start.find("</td>"))?;
    Some(text_start[..text_end].to_string())
}

/// 解码 DuckDuckGo 重定向链接为真实 URL
fn decode_ddg_redirect(href: &str) -> Option<String> {
    // 直接链接
    if href.starts_with("http://") || href.starts_with("https://") {
        return Some(decode_html_entities(href));
    }
    // 重定向: //duckduckgo.com/l/?uddg=<encoded>&rut=...
    let stripped = href
        .strip_prefix("//duckduckgo.com/l/?uddg=")
        .or_else(|| href.strip_prefix("https://duckduckgo.com/l/?uddg="))
        .or_else(|| href.strip_prefix("http://duckduckgo.com/l/?uddg="))?;
    let enc = stripped.split('&').next()?;
    let decoded = percent_decode(enc);
    if decoded.is_empty() {
        None
    } else {
        Some(decoded)
    }
}

/// 简单的 percent-decoding（UTF-8 安全）
fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = &bytes[i + 1..i + 3];
            if let Ok(byte) = u8::from_str_radix(std::str::from_utf8(hex).unwrap_or("00"), 16) {
                out.push(byte);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// 去除 HTML 标签
fn strip_tags(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut in_tag = false;
    for c in s.chars() {
        match c {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(c),
            _ => {}
        }
    }
    out
}

/// 解码常见 HTML 实体
fn decode_html_entities(s: &str) -> String {
    s.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&#x27;", "'")
        .replace("&nbsp;", " ")
}

/// 读取文本文件（限制在项目数据目录内）
#[tauri::command]
fn read_file_content(path: String) -> CmdResult<String> {
    let requested = std::path::PathBuf::from(&path);

    // 允许的根目录：项目数据目录
    let data_dir = crate::utils::get_project_data_dir()?;
    let canonical_data = data_dir.canonicalize().unwrap_or(data_dir.clone());

    // 规范化请求路径
    let canonical_req = requested.canonicalize().unwrap_or(requested.clone());

    // 检查路径是否在允许的目录内
    if !canonical_req.starts_with(&canonical_data) {
        return Err(AppError::Generic(
            "Access denied: path must be within project data directory".to_string(),
        ));
    }

    fs::read_to_string(&requested).map_err(|e| AppError::Io(format!("Failed to read file: {}", e)))
}

/// 列出目录内容
#[tauri::command]
fn list_directory(path: String) -> CmdResult<Vec<FileEntry>> {
    let requested = std::path::PathBuf::from(&path);

    // 限制仅允许项目数据目录及其子目录
    let data_dir = crate::utils::get_project_data_dir()?;
    let canonical_data = data_dir.canonicalize().unwrap_or(data_dir.clone());
    let canonical_req = requested.canonicalize().unwrap_or(requested.clone());
    if !canonical_req.starts_with(&canonical_data) {
        return Err(AppError::Generic(
            "Access denied: path must be within project data directory".to_string(),
        ));
    }

    let mut entries = Vec::new();
    for entry in fs::read_dir(&requested).map_err(|e| format!("Failed to read dir: {}", e))? {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let metadata = entry
            .metadata()
            .map_err(|e| format!("Failed to get metadata: {}", e))?;
        entries.push(FileEntry {
            name: entry.file_name().to_string_lossy().into_owned(),
            is_dir: metadata.is_dir(),
            size: metadata.len(),
        });
    }
    entries.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then(a.name.cmp(&b.name)));
    Ok(entries)
}

/// 下载插件 zip 并解压到 data/plugins/{pluginId}/
#[tauri::command]
fn download_and_extract_plugin(url: String, plugin_id: String) -> CmdResult<()> {
    let data_dir = crate::utils::get_project_data_dir()?;
    let plugins_dir = data_dir.join("plugins");
    let plugin_dir = plugins_dir.join(&plugin_id);

    // 确保插件目录存在
    fs::create_dir_all(&plugin_dir)
        .map_err(|e| AppError::Io(format!("Failed to create plugin dir: {}", e)))?;

    // 下载 zip 到临时文件
    let temp_zip = data_dir.join("temp").join(format!("{}.zip", plugin_id));
    if let Some(parent) = temp_zip.parent() {
        fs::create_dir_all(parent).ok();
    }

    let response = ureq::get(&url)
        .timeout(std::time::Duration::from_secs(60))
        .call()
        .map_err(|e| AppError::Generic(format!("Download failed: {}", e)))?;

    let mut file = fs::File::create(&temp_zip)
        .map_err(|e| AppError::Io(format!("Failed to create temp file: {}", e)))?;
    std::io::copy(&mut response.into_reader(), &mut file)
        .map_err(|e| AppError::Io(format!("Failed to write zip: {}", e)))?;

    // 解压
    let archive = std::fs::File::open(&temp_zip)
        .map_err(|e| AppError::Io(format!("Failed to open zip: {}", e)))?;
    let mut zip = zip::ZipArchive::new(archive)
        .map_err(|e| AppError::Generic(format!("Invalid zip: {}", e)))?;

    for i in 0..zip.len() {
        let mut entry = zip
            .by_index(i)
            .map_err(|e| AppError::Generic(format!("Zip entry error: {}", e)))?;

        let entry_name = entry.name().to_string();

        // 防止 zip-slip 路径穿越
        let dest_path = plugin_dir.join(&entry_name);
        let canonical_plugin = plugin_dir.canonicalize().unwrap_or(plugin_dir.clone());
        let canonical_dest = dest_path
            .parent()
            .and_then(|p| p.canonicalize().ok())
            .unwrap_or_else(|| canonical_plugin.clone());
        if !canonical_dest.starts_with(&canonical_plugin) {
            return Err(AppError::Generic(format!(
                "Zip-slip detected: {} escapes plugin dir",
                entry_name
            )));
        }

        if entry.is_dir() {
            fs::create_dir_all(&dest_path).ok();
        } else {
            if let Some(parent) = dest_path.parent() {
                fs::create_dir_all(parent).ok();
            }
            let mut outfile = fs::File::create(&dest_path).map_err(|e| {
                AppError::Io(format!(
                    "Failed to create file {}: {}",
                    dest_path.display(),
                    e
                ))
            })?;
            std::io::copy(&mut entry, &mut outfile).ok();
        }
    }

    // 清理临时文件
    fs::remove_file(&temp_zip).ok();

    Ok(())
}

/// 删除插件目录
#[tauri::command]
fn remove_plugin_dir(plugin_id: String) -> CmdResult<()> {
    let data_dir = crate::utils::get_project_data_dir()?;
    let plugin_dir = data_dir.join("plugins").join(&plugin_id);
    if plugin_dir.exists() {
        fs::remove_dir_all(&plugin_dir)
            .map_err(|e| AppError::Io(format!("Failed to remove plugin dir: {}", e)))?;
    }
    Ok(())
}

/// 获取桌面路径
#[tauri::command]
fn get_desktop_path() -> CmdResult<String> {
    let home = std::env::var("USERPROFILE").map_err(|e| format!("USERPROFILE not found: {}", e))?;
    Ok(format!("{}\\Desktop", home))
}

/// 获取项目数据目录
#[tauri::command]
fn get_project_data_dir() -> CmdResult<String> {
    let dir = crate::utils::get_project_data_dir()?;
    Ok(dir.to_string_lossy().into_owned())
}

/// 获取临时文件目录
#[tauri::command]
fn get_temp_dir_path() -> CmdResult<String> {
    let dir = crate::utils::get_temp_dir()?;
    Ok(dir.to_string_lossy().into_owned())
}

/// 获取临时文件大小（字节）
#[tauri::command]
fn get_temp_size() -> CmdResult<u64> {
    let temp = crate::utils::get_temp_dir()?;
    Ok(crate::utils::get_dir_size(&temp))
}

/// 清理临时文件
#[tauri::command]
fn cleanup_temp(max_age_hours: u64) -> CmdResult<u64> {
    crate::utils::cleanup_temp_files(max_age_hours)
}

// ===== 存储占用分析命令 =====

/// 存储子项（单个目录或文件）
#[derive(Serialize)]
struct StorageItem {
    name: String,
    path: String,
    size: u64,
    is_dir: bool,
}

/// 存储分类（应用本体 / 用户信息 / 缓存 / 模型文件）
#[derive(Serialize)]
struct StorageCategory {
    /// 稳定 id：app | user | cache | models
    id: String,
    size: u64,
    path: String,
    items: Vec<StorageItem>,
}

/// 完整存储占用分析结果
#[derive(Serialize)]
struct StorageUsage {
    /// 所有分类体积之和（含前端补充的 localStorage 体积）
    total: u64,
    /// 可执行文件路径（应用本体代表路径）
    app_path: String,
    categories: Vec<StorageCategory>,
}

/// 分析应用各类数据的磁盘占用
///
/// 分类：
/// - app：可执行文件 + 同级 resources 目录
/// - user：项目数据目录扣除 temp 与 models（记忆 / 人格 / 会话 / 配置等）
/// - cache：项目数据目录下的 temp/
/// - models：data/models + 项目内 public/models、public/Core、server/models 等权重目录
///
/// 注：浏览器侧 localStorage（记忆 / RAG 等）体积由前端补充到 user 分类。
#[tauri::command]
fn get_storage_usage() -> CmdResult<StorageUsage> {
    let data_dir = crate::utils::get_project_data_dir()?;
    let base = crate::utils::get_app_base_dir();

    // 应用本体：可执行文件 + 同级 resources 目录
    let mut app_size: u64 = 0;
    let mut app_path = String::new();
    if let Ok(exe) = std::env::current_exe() {
        app_path = exe.to_string_lossy().into_owned();
        if let Ok(meta) = fs::metadata(&exe) {
            app_size += meta.len();
        }
        if let Some(parent) = exe.parent() {
            let res = parent.join("resources");
            if res.exists() {
                app_size += crate::utils::get_dir_size(&res);
            }
        }
    }

    // 缓存：data/temp
    let temp_dir = data_dir.join("temp");
    let cache_size = crate::utils::get_dir_size(&temp_dir);

    // 模型文件：data/models + 项目内模型 / 资源目录
    let model_dirs: Vec<std::path::PathBuf> = vec![
        data_dir.join("models"),
        base.join("public").join("models"),
        base.join("public").join("Core"),
        base.join("server").join("models"),
        base.join("server").join("gpt_sovits"),
        base.join("server").join("voiceprint"),
    ];
    let mut models_size: u64 = 0;
    let mut model_items: Vec<StorageItem> = Vec::new();
    for d in &model_dirs {
        if d.exists() {
            let s = crate::utils::get_dir_size(d);
            models_size += s;
            model_items.push(StorageItem {
                name: d
                    .file_name()
                    .map(|n| n.to_string_lossy().into_owned())
                    .unwrap_or_default(),
                path: d.to_string_lossy().into_owned(),
                size: s,
                is_dir: true,
            });
        }
    }
    model_items.sort_by_key(|b| std::cmp::Reverse(b.size));

    // 用户信息：data 目录总资产减去 temp 与 models
    let data_total = crate::utils::get_dir_size(&data_dir);
    let data_models_size = crate::utils::get_dir_size(&data_dir.join("models"));
    let user_size = data_total
        .saturating_sub(cache_size)
        .saturating_sub(data_models_size);

    // 用户信息子项：data 下各子目录 / 根文件（排除 temp 与 models）
    let mut user_items: Vec<StorageItem> = Vec::new();
    if let Ok(entries) = fs::read_dir(&data_dir) {
        for entry in entries.flatten() {
            let p = entry.path();
            let name = p
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default();
            if name == "temp" || name == "models" {
                continue;
            }
            let (s, is_dir) = if p.is_dir() {
                (crate::utils::get_dir_size(&p), true)
            } else {
                (fs::metadata(&p).map(|m| m.len()).unwrap_or(0), false)
            };
            if s > 0 {
                user_items.push(StorageItem {
                    name,
                    path: p.to_string_lossy().into_owned(),
                    size: s,
                    is_dir,
                });
            }
        }
    }
    user_items.sort_by_key(|b| std::cmp::Reverse(b.size));

    let categories = vec![
        StorageCategory {
            id: "app".into(),
            size: app_size,
            path: app_path.clone(),
            items: vec![],
        },
        StorageCategory {
            id: "user".into(),
            size: user_size,
            path: data_dir.to_string_lossy().into_owned(),
            items: user_items,
        },
        StorageCategory {
            id: "cache".into(),
            size: cache_size,
            path: temp_dir.to_string_lossy().into_owned(),
            items: vec![],
        },
        StorageCategory {
            id: "models".into(),
            size: models_size,
            path: base
                .join("public")
                .join("models")
                .to_string_lossy()
                .into_owned(),
            items: model_items,
        },
    ];

    let total: u64 = categories.iter().map(|c| c.size).sum();

    Ok(StorageUsage {
        total,
        app_path,
        categories,
    })
}

/// 用系统文件管理器打开指定路径（文件则打开其所在目录）
#[tauri::command]
fn open_path(path: String) -> CmdResult<()> {
    if path.is_empty() {
        return Err(AppError::Generic("路径为空".into()));
    }
    let p = std::path::Path::new(&path);
    let target = if p.is_dir() {
        p.to_path_buf()
    } else {
        p.parent()
            .map(|x| x.to_path_buf())
            .unwrap_or_else(|| p.to_path_buf())
    };
    open::that(&target).map_err(|e| AppError::Generic(format!("无法打开路径: {}", e)))?;
    Ok(())
}

/// 打开 server 下的某个子目录（如 TTS 引擎的权重目录），不存在则先创建。
/// subdir 为相对于后端根目录（含 server/ 的目录；打包后为 %APPDATA%/desk-pet/backend）的路径，
/// 例如 "server/gpt_sovits/GPT_SoVITS/pretrained_models"。
#[tauri::command]
fn open_server_dir(app: tauri::AppHandle, subdir: String) -> CmdResult<()> {
    if subdir.is_empty() {
        return Err(AppError::Generic("子目录为空".into()));
    }
    let base = crate::backend::backend_root(&app);
    let target = base.join(&subdir);
    if !target.exists() {
        std::fs::create_dir_all(&target)
            .map_err(|e| AppError::Generic(format!("无法创建目录: {}", e)))?;
    }
    open::that(&target).map_err(|e| AppError::Generic(format!("无法打开路径: {}", e)))?;
    Ok(())
}

/// 保存数据到项目目录（非加密，如 sessions、memory 等）
#[tauri::command]
fn save_project_data(key: String, data: String, subdir: Option<String>) -> CmdResult<()> {
    let data_dir = crate::utils::get_project_data_dir()?;
    let target_dir = if let Some(sub) = subdir {
        data_dir.join(sub)
    } else {
        data_dir.join("config")
    };
    fs::create_dir_all(&target_dir)
        .map_err(|e| AppError::Io(format!("Failed to create subdir: {}", e)))?;
    let path = target_dir.join(format!("{}.json", key));
    fs::write(&path, &data)
        .map_err(|e| AppError::Io(format!("Failed to write project data: {}", e)))?;
    Ok(())
}

/// 从项目目录加载数据
#[tauri::command]
fn load_project_data(key: String, subdir: Option<String>) -> CmdResult<String> {
    let data_dir = crate::utils::get_project_data_dir()?;
    let target_dir = if let Some(sub) = subdir {
        data_dir.join(sub)
    } else {
        data_dir.join("config")
    };
    let path = target_dir.join(format!("{}.json", key));
    if !path.exists() {
        return Ok(String::new());
    }
    fs::read_to_string(&path)
        .map_err(|e| AppError::Io(format!("Failed to read project data: {}", e)))
}

/// 将 settings.json 中的 chat 配置同步到 providers.json
/// 确保旧 Settings 页面和新 Providers 系统的配置保持一致
pub(crate) fn sync_settings_to_providers(
    _data_dir: &std::path::Path,
    api_url: &str,
    api_key: &str,
    model: &str,
) -> CmdResult<()> {
    let mut providers: serde_json::Value = serde_json::from_str(
        &read_secure_file("providers").unwrap_or_default(),
    )
    .unwrap_or(serde_json::json!({
        "configs": [], "activeChatId": null,
        "activeTTSId": null, "activeSTTId": null,
        "sessionOverrides": {}
    }));

    let configs = providers["configs"]
        .as_array_mut()
        .ok_or_else(|| AppError::Generic("invalid providers.json: configs not an array".into()))?;

    // 查找或创建默认 OpenAI chat provider
    let default_id = "default-openai";
    if let Some(existing) = configs
        .iter_mut()
        .find(|c| c["id"].as_str() == Some(default_id))
    {
        existing["apiBase"] = serde_json::json!(api_url);
        existing["apiKey"] = serde_json::json!(api_key);
        existing["model"] = serde_json::json!(model);
    } else {
        configs.push(serde_json::json!({
            "id": default_id,
            "type": "chat",
            "typeName": "openai_chat",
            "name": "OpenAI 兼容接口",
            "enable": true,
            "apiBase": api_url,
            "apiKey": api_key,
            "model": model,
        }));
    }

    // 设为活跃 Chat Provider（如果还没设置）
    if providers["activeChatId"].is_null() || providers["activeChatId"].as_str() == Some("") {
        providers["activeChatId"] = serde_json::json!(default_id);
    }

    write_secure_file("providers", &providers.to_string())?;

    Ok(())
}

/// 将活跃 Chat Provider 的配置反向同步到 settings.json
pub(crate) fn sync_providers_to_settings(
    _data_dir: &std::path::Path,
    providers: &serde_json::Value,
) {
    let mut settings: serde_json::Value =
        serde_json::from_str(&read_secure_file("settings").unwrap_or_default())
            .unwrap_or(serde_json::json!({}));

    // 找到活跃的 chat provider
    let active_id = providers["activeChatId"].as_str();
    if let Some(configs) = providers["configs"].as_array() {
        if let Some(active) = configs.iter().find(|c| {
            c["type"].as_str() == Some("chat")
                && c["enable"].as_bool().unwrap_or(true)
                && (active_id.is_none() || c["id"].as_str() == active_id)
        }) {
            settings["apiUrl"] = serde_json::json!(active["apiBase"].as_str().unwrap_or(""));
            settings["apiKey"] = serde_json::json!(active["apiKey"].as_str().unwrap_or(""));
            settings["model"] = serde_json::json!(active["model"].as_str().unwrap_or(""));
        }
    }

    let _ = write_secure_file("settings", &settings.to_string());
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .manage(mcp::McpManager::new())
        .manage(service::ServiceManager::new())
        .manage(AdminState {
            token: Mutex::new(String::new()), // populated in setup
        })
        .manage(shortcuts::ShortcutConfigState {
            configs: Mutex::new(shortcuts::default_shortcuts()),
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            toggle_lock_state,
            get_cursor_position,
            get_cursor_window_info,
            save_data,
            load_data,
            capture_screenshot,
            read_clipboard,
            write_file,
            read_file_content,
            list_directory,
            delete_file,
            download_and_extract_plugin,
            remove_plugin_dir,
            get_desktop_path,
            open_url,
            web_search,
            wake_word::check_vosk_model,
            wake_word::download_vosk_model,
            wake_word::get_vosk_model_size,
            wake_word::delete_vosk_model,
            get_project_data_dir,
            get_temp_dir_path,
            get_temp_size,
            cleanup_temp,
            get_storage_usage,
            open_path,
            open_server_dir,
            save_project_data,
            load_project_data,
            check_ollama_installed,
            check_network_online,
            is_window_on_screen,
            reset_window_position,
            show_settings_window,
            show_chat_window,
            get_admin_token,
            shortcuts::get_shortcuts_config,
            shortcuts::save_shortcuts_config,
            shortcuts::reset_shortcuts_config,
            mcp::mcp_connect,
            mcp::mcp_call_tool,
            mcp::mcp_disconnect,
            mcp::mcp_disconnect_all,
            mcp::mcp_list_connections,
            service::service_stop,
            service::service_list,
            service::service_status,
            service::service_stop_all,
            tray::hide_to_tray,
            tray::show_from_tray,
            tray::set_lock_state,
            tray::get_lock_state,
            tray::set_tray_left_click,
            set_close_behavior,
            set_autolaunch,
            is_autolaunch_enabled,
            open_devtools,
            set_always_on_top
        ])
        .setup(|app| {
            // 生成管理后台鉴权 token
            let token = generate_token();
            {
                let state = app.state::<AdminState>();
                let mut token_ref = state.token.lock().expect("token lock poisoned");
                *token_ref = token.clone();
            }
            println!("[Admin] Auth token: {}", token);
            // 自启动默认 Provider 的后端服务（后台线程，不阻塞窗口创建）
            let app_handle_for_services = app.handle().clone();
            std::thread::spawn(move || {
                if let Ok(data_dir) = get_data_dir() {
                    let providers_path = data_dir.join("providers.json");
                    if let Ok(content) = std::fs::read_to_string(&providers_path) {
                        if let Ok(providers) = serde_json::from_str::<serde_json::Value>(&content) {
                            let default_keys = [
                                "activeChatId",
                                "activeTTSId",
                                "activeSTTId",
                                "activePerceptionId",
                            ];
                            for key in &default_keys {
                                if let Some(id) = providers[key].as_str().filter(|s| !s.is_empty())
                                {
                                    if let Some(cfg) =
                                        providers["configs"].as_array().and_then(|configs| {
                                            configs.iter().find(|c| c["id"].as_str() == Some(id))
                                        })
                                    {
                                        let command = cfg["command"].as_str().unwrap_or("");
                                        let port = cfg["port"].as_u64().unwrap_or(0) as u16;
                                        let ptype = cfg["type"].as_str().unwrap_or("");
                                        if !command.is_empty() && port > 0 {
                                            let is_healthy = if ptype == "perception" {
                                                service::check_tcp_health(port)
                                            } else {
                                                service::check_http_health(port)
                                            };
                                            if !is_healthy {
                                                let raw_work_dir = cfg["workDir"]
                                                    .as_str()
                                                    .unwrap_or(".")
                                                    .to_string();
                                                let app_root = crate::backend::backend_root(
                                                    &app_handle_for_services,
                                                );
                                                let work_dir = if raw_work_dir.is_empty()
                                                    || raw_work_dir == "."
                                                {
                                                    app_root.to_string_lossy().to_string()
                                                } else {
                                                    raw_work_dir
                                                };
                                                let args: Vec<String> = cfg["commandArgs"]
                                                    .as_array()
                                                    .map(|a| {
                                                        a.iter()
                                                            .filter_map(|v| {
                                                                v.as_str().map(|s| s.to_string())
                                                            })
                                                            .collect()
                                                    })
                                                    .unwrap_or_default();
                                                let resolved_command = if command.contains('/')
                                                    || command.contains('\\')
                                                {
                                                    std::path::Path::new(&work_dir)
                                                        .join(command)
                                                        .to_string_lossy()
                                                        .to_string()
                                                } else {
                                                    command.to_string()
                                                };
                                                let _ = service::service_start_raw(
                                                    &resolved_command,
                                                    &args,
                                                    &work_dir,
                                                    port,
                                                    &app_handle_for_services,
                                                );
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            });

            // 启动 Core API + Hermes Gateway（含 Python 探测）：整体放入后台线程，
            // 避免同步 `python -c "import fastapi"` 探测阻塞 setup 主线程、拖延窗口首屏显示
            let app_handle_for_services = app.handle().clone();
            std::thread::spawn(move || {
                // 让出前 2.5s 给角色模型加载：角色出场本身不需要 Python 服务，
                // 但两个 python.exe 冷启动（导入 fastapi/uvicorn）会抢占 CPU/磁盘，
                // 与 Live2D 的 moc3 解析 + 纹理解码争抢首屏窗口。延后启动可缩短
                // 「命令 → 角色可见」耗时；服务最迟 2.5s 后照常拉起，不影响聊天等功能。
                std::thread::sleep(std::time::Duration::from_millis(2500));

                let app_handle_for_core = app_handle_for_services.clone();
                let app_handle_for_hermes = app_handle_for_services.clone();

                // 共享 Python 命令解析（打包后用 bootstrap venv，dev 用项目 venv/系统 python）
                // 首次运行确保 venv 就绪（仅打包环境生效，best-effort）
                let _ = crate::backend::ensure_backend(&app_handle_for_services);
                let python_cmd_shared = crate::backend::resolve_python(&app_handle_for_services);
                let project_root_shared = crate::backend::backend_root(&app_handle_for_services)
                    .to_string_lossy()
                    .to_string();

                // Core API 线程
                let core_root = project_root_shared.clone();
                let core_python = python_cmd_shared.clone();
                std::thread::spawn(move || {
                    let core_port: u16 = 9877;
                    if !service::check_http_health(core_port) {
                        let args = vec![
                            "-m".to_string(),
                            "server.core.api_server".to_string(),
                            "--port".to_string(),
                            core_port.to_string(),
                        ];
                        match service::service_start_raw(
                            &core_python,
                            &args,
                            &core_root,
                            core_port,
                            &app_handle_for_core,
                        ) {
                            Ok(info) => {
                                println!("[Core API] Started: id={}, port={}", info.id, core_port);
                            }
                            Err(e) => {
                                eprintln!("[Core API] Failed to start: {:?}", e);
                            }
                        }
                    } else {
                        println!("[Core API] Already running on port {}", core_port);
                    }
                });

                // Hermes Gateway 线程
                let hermes_root = project_root_shared.clone();
                let hermes_python = python_cmd_shared.clone();
                std::thread::spawn(move || {
                    let hermes_port: u16 = 8765;
                    if !service::check_http_health(hermes_port) {
                        let args = vec![
                            "-m".to_string(),
                            "server.hermes_gateway_server".to_string(),
                            "--port".to_string(),
                            hermes_port.to_string(),
                        ];
                        match service::service_start_raw(
                            &hermes_python,
                            &args,
                            &hermes_root,
                            hermes_port,
                            &app_handle_for_hermes,
                        ) {
                            Ok(info) => {
                                println!(
                                    "[Hermes Gateway] Started: id={}, port={}",
                                    info.id, hermes_port
                                );
                            }
                            Err(e) => {
                                eprintln!("[Hermes Gateway] Failed to start: {:?}", e);
                            }
                        }
                    } else {
                        println!("[Hermes Gateway] Already running on port {}", hermes_port);
                    }
                });
            });

            // 启动管理后台 HTTP 服务器（传入 AppHandle 用于事件通知）
            crate::admin_server::start_admin_server(app.handle().clone());

            // 启动后台服务保活监控（自适应轮询：活跃10秒/空闲60秒）
            service::start_service_watcher(app.handle().clone());

            // 初始化系统托盘
            if let Err(e) = tray::init_tray(app) {
                eprintln!("[Setup] Failed to initialize tray: {}", e);
            }

            // 初始化项目数据目录结构（data/ + temp/ 所有子目录）
            if let Err(e) = crate::utils::ensure_project_dirs() {
                eprintln!("[Setup] Failed to ensure project dirs: {}", e);
            }

            // 启动时清理超过 24h 的临时文件（放入后台线程，避免同步递归扫描阻塞 setup 主线程）
            std::thread::spawn(|| {
                if let Err(e) = crate::utils::cleanup_temp_files(24) {
                    eprintln!("[Setup] Failed to cleanup temp files: {}", e);
                }
            });

            // 全局快捷键：从 preferences.json 动态加载并注册
            let shortcut_configs = shortcuts::load_shortcuts_config();
            {
                let state = app.state::<shortcuts::ShortcutConfigState>();
                let mut configs = state
                    .configs
                    .lock()
                    .expect("shortcut state lock poisoned on init");
                *configs = shortcut_configs.clone();
            }
            if let Err(e) = shortcuts::apply_shortcuts(app.handle(), &shortcut_configs) {
                eprintln!("[Setup] Some shortcuts failed to register: {}", e);
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    let behavior = close_behavior();
                    if behavior == "minimize_to_tray" {
                        // 最小化到托盘：阻止关闭，仅隐藏
                        api.prevent_close();
                        let _ = window.hide();
                    } else {
                        // 退出程序：停止所有服务并退出
                        let app = window.app_handle();
                        let state = app.state::<service::ServiceManager>();
                        let _ = service::service_stop_all(state);
                    }
                } else if window.label() == "settings" {
                    // 拦截 settings 窗口关闭：改为隐藏，避免重新创建导致闪白
                    api.prevent_close();
                    // 主窗口置顶状态在打开设置窗时保持不变（设置窗自身置顶显示在模型之上），
                    // 这里只需隐藏设置窗即可，模型依旧保持常态置顶。
                    let _ = window.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
