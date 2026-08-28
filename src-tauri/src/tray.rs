use std::sync::Mutex;
use tauri::image::Image;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager,
};

/// 全局锁定状态（在 Rust 侧维护，不依赖前端事件）
static mut LOCKED: bool = false;

/// 全局托盘左键行为（"show_menu" | "show_window"）
/// 由前端通过 set_tray_left_click 命令同步，默认显示菜单
static TRAY_LEFT_CLICK: Mutex<String> = Mutex::new(String::new());

/// 读取托盘左键行为（默认 show_menu）
fn tray_left_click() -> String {
    let guard = TRAY_LEFT_CLICK.lock().unwrap_or_else(|p| p.into_inner());
    if guard.is_empty() {
        "show_menu".to_string()
    } else {
        guard.clone()
    }
}

pub fn init_tray(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let toggle_lock = MenuItem::with_id(app, "toggle-lock", "锁定", true, None::<&str>)?;
    let toggle_visible = MenuItem::with_id(app, "toggle-visible", "隐藏", true, None::<&str>)?;
    let open_chat = MenuItem::with_id(app, "open-chat", "打开对话", true, None::<&str>)?;
    let open_settings = MenuItem::with_id(app, "open-settings", "设置", true, None::<&str>)?;
    let restart_gateway =
        MenuItem::with_id(app, "restart-gateway", "重启后端", true, None::<&str>)?;
    let reset_orb = MenuItem::with_id(app, "reset-orb", "重置悬浮球", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;

    let menu = Menu::with_items(
        app,
        &[
            &toggle_lock,
            &toggle_visible,
            &open_chat,
            &open_settings,
            &restart_gateway,
            &reset_orb,
            &quit,
        ],
    )?;

    let icon_data = include_bytes!("../icons/icon.png");
    let img = image::load_from_memory(icon_data)?;
    let rgba = img.to_rgba8();
    let (width, height) = rgba.dimensions();
    let icon = Image::new_owned(rgba.into_raw(), width, height);

    let toggle_lock_clone = toggle_lock.clone();
    let toggle_visible_clone = toggle_visible.clone();
    let toggle_visible_dblclick = toggle_visible_clone.clone();

    let _tray = TrayIconBuilder::with_id("main-tray")
        .tooltip("Desk Pet")
        .icon(icon)
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(move |app, event| match event.id().as_ref() {
            "toggle-lock" => {
                // 在 Rust 侧切换状态，更新菜单文字，并通知前端
                let new_locked = unsafe { !LOCKED };
                unsafe {
                    LOCKED = new_locked;
                }

                // 更新菜单文字
                let _ = toggle_lock_clone.set_text(if new_locked { "解锁" } else { "锁定" });

                // 通知前端
                let _ = app.emit("toggle-lock", new_locked);
            }
            "toggle-visible" => {
                if let Some(window) = app.get_webview_window("main") {
                    match window.is_visible() {
                        Ok(true) => {
                            let _ = window.hide();
                            let _ = toggle_visible_clone.set_text("显示");
                        }
                        Ok(false) => {
                            let _ = window.show();
                            let _ = window.set_focus();
                            let _ = toggle_visible_clone.set_text("隐藏");
                        }
                        Err(_) => {}
                    }
                }
            }
            "open-chat" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                    let _ = window.emit("open-chat", ());
                }
            }
            "open-settings" => {
                if let Some(window) = app.get_webview_window("settings") {
                    let _ = window.show();
                    let _ = window.set_focus();
                } else if let Some(main_window) = app.get_webview_window("main") {
                    let _ = main_window.emit("open-settings", ());
                }
            }
            "quit" => {
                // 立即退出：所有后端子进程在启动时已加入 Windows Job Object
                // （KILL_ON_JOB_CLOSE），父进程退出时由操作系统强制终止整个进程树，
                // 不会残留占端口。因此无需在退出前同步等待 taskkill——那正是
                // 「点击退出后界面卡几秒」的根因。直接 exit(0) 即可做到「一点就退」。
                app.exit(0);
            }
            "reset-orb" => {
                // 通知前端把悬浮球重置到角色（主窗）旁边的默认位置
                let _ = app.emit("tray:reset-orb", ());
            }
            "restart-gateway" => {
                // 重启是阻塞操作（内含等待端口释放的 sleep），放入独立线程避免卡住菜单
                let app_clone = app.clone();
                std::thread::spawn(move || {
                    let _ = crate::restart_hermes_gateway(&app_clone);
                });
            }
            _ => {}
        })
        .on_tray_icon_event(move |tray, event| {
            let app = tray.app_handle();
            match event {
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                } => {
                    // 仅在配置为 show_window 时处理左键单击
                    // show_menu 模式下 show_menu_on_left_click(true) 会自动弹菜单
                    if tray_left_click() == "show_window" {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                            let _ = toggle_visible_dblclick.set_text("隐藏");
                        }
                    }
                }
                TrayIconEvent::DoubleClick {
                    button: MouseButton::Left,
                    ..
                } => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                        let _ = toggle_visible_dblclick.set_text("隐藏");
                    }
                }
                _ => {}
            }
        })
        .build(app)?;

    Ok(())
}

/// 前端同步托盘左键行为到 Rust 侧，并动态切换 show_menu_on_left_click
#[tauri::command]
pub fn set_tray_left_click(app: tauri::AppHandle, behavior: String) -> Result<(), String> {
    {
        let mut guard = TRAY_LEFT_CLICK.lock().unwrap_or_else(|p| p.into_inner());
        *guard = behavior.clone();
    }
    let show_menu = behavior == "show_menu";
    if let Some(tray) = app.tray_by_id("main-tray") {
        tray.set_show_menu_on_left_click(show_menu)
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 前端通知 Rust 侧锁定状态已变更（同步 Rust 侧状态）
#[tauri::command]
pub fn set_lock_state(locked: bool) {
    unsafe {
        LOCKED = locked;
    }
}

/// 获取当前锁定状态
#[tauri::command]
pub fn get_lock_state() -> bool {
    unsafe { LOCKED }
}

#[tauri::command]
pub fn hide_to_tray(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        window.hide().map_err(|e| e.to_string())?;
    } else {
        return Err("Window not found".into());
    }
    // 悬浮球独立窗口随主窗一起隐藏，避免残留漂浮
    if let Some(orb) = app.get_webview_window("controls") {
        let _ = orb.hide();
    }
    Ok(())
}

#[tauri::command]
pub fn show_from_tray(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
    } else {
        return Err("Window not found".into());
    }
    // 悬浮球独立窗口随主窗一起恢复显示
    if let Some(orb) = app.get_webview_window("controls") {
        let _ = orb.show();
    }
    Ok(())
}
