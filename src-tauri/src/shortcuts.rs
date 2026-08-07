/**
 * 全局快捷键动态管理模块
 *
 * 支持：
 * - 从 preferences.json 读取快捷键配置
 * - 动态注册/注销快捷键
 * - 前端通过 Tauri 命令管理快捷键
 *
 * 快捷键格式：`Ctrl+Shift+D`、`Ctrl+Space` 等
 */
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{
    Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState as PluginShortcutState,
};

use crate::errors::{AppError, CmdResult};
use crate::utils::get_data_dir;

/// 单条快捷键配置
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ShortcutConfig {
    /// 唯一 ID（如 "lock"、"voice"、"screenshot"）
    pub id: String,
    /// 功能显示名称（如"锁定/解锁角色"）
    pub label: String,
    /// 触发时发出的事件名（如 "toggle-lock"）
    pub action: String,
    /// 快捷键组合字符串（如 "Ctrl+Shift+D"）
    pub keys: String,
    /// 是否启用
    pub enabled: bool,
}

/// preferences.json 中快捷键部分的 schema
#[derive(Serialize, Deserialize, Debug, Default)]
struct PreferencesData {
    #[serde(default)]
    shortcuts: Vec<ShortcutConfig>,
}

/// 快捷键运行时状态（通过 Tauri State 共享）
pub struct ShortcutConfigState {
    pub configs: Mutex<Vec<ShortcutConfig>>,
}

/// 默认快捷键配置
pub fn default_shortcuts() -> Vec<ShortcutConfig> {
    vec![
        ShortcutConfig {
            id: "lock".into(),
            label: "锁定/解锁角色".into(),
            action: "toggle-lock".into(),
            keys: "Ctrl+Shift+D".into(),
            enabled: true,
        },
        ShortcutConfig {
            id: "voice".into(),
            label: "唤醒语音助手".into(),
            action: "shortcut-voice".into(),
            keys: "Ctrl+Space".into(),
            enabled: true,
        },
        ShortcutConfig {
            id: "screenshot".into(),
            label: "截屏+AI分析".into(),
            action: "shortcut-screenshot".into(),
            keys: "Ctrl+Shift+S".into(),
            enabled: true,
        },
    ]
}

/// preferences.json 的路径（位于 C 盘数据目录下，因为可能含用户偏好，统一管理）
fn preferences_path() -> Result<PathBuf, AppError> {
    Ok(get_data_dir()?.join("preferences.json"))
}

/// 从 preferences.json 读取快捷键配置；若不存在则返回默认配置并持久化
pub fn load_shortcuts_config() -> Vec<ShortcutConfig> {
    let path = match preferences_path() {
        Ok(p) => p,
        Err(_) => return default_shortcuts(),
    };

    if !path.exists() {
        let defaults = default_shortcuts();
        let _ = save_shortcuts_to_file(&path, &defaults);
        return defaults;
    }

    match fs::read_to_string(&path) {
        Ok(content) => {
            let prefs: PreferencesData = serde_json::from_str(&content).unwrap_or_default();
            if prefs.shortcuts.is_empty() {
                default_shortcuts()
            } else {
                prefs.shortcuts
            }
        }
        Err(_) => default_shortcuts(),
    }
}

/// 将快捷键配置写入 preferences.json
fn save_shortcuts_to_file(path: &PathBuf, configs: &[ShortcutConfig]) -> Result<(), AppError> {
    // 读取现有 preferences（保留其他字段）
    let existing: serde_json::Value = if path.exists() {
        fs::read_to_string(path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or(serde_json::json!({}))
    } else {
        serde_json::json!({})
    };

    let mut obj = existing.as_object().cloned().unwrap_or_default();
    obj.insert(
        "shortcuts".into(),
        serde_json::to_value(configs).unwrap_or(serde_json::json!([])),
    );

    let content = serde_json::to_string_pretty(&serde_json::Value::Object(obj))
        .map_err(|e| AppError::Generic(format!("Failed to serialize preferences: {}", e)))?;
    fs::write(path, content).map_err(|e| AppError::Io(e.to_string()))?;
    Ok(())
}

/// 解析快捷键字符串为 (Modifiers, Code)
///
/// 支持：Ctrl / Control / Shift / Alt / Super / Win / Meta 作为修饰键
/// 支持：A-Z、0-9、Space、Enter、Escape、Tab、F1-F12 作为主键
pub fn parse_shortcut_keys(keys: &str) -> Result<(Modifiers, Code), String> {
    let parts: Vec<&str> = keys.split('+').map(|s| s.trim()).collect();
    if parts.is_empty() {
        return Err("Empty shortcut".into());
    }

    let mut modifiers = Modifiers::empty();
    let mut code: Option<Code> = None;

    for part in parts {
        let lower = part.to_lowercase();
        match lower.as_str() {
            "ctrl" | "control" => modifiers |= Modifiers::CONTROL,
            "shift" => modifiers |= Modifiers::SHIFT,
            "alt" => modifiers |= Modifiers::ALT,
            "super" | "win" | "meta" => modifiers |= Modifiers::SUPER,
            _ => {
                if code.is_some() {
                    return Err(format!("Multiple key codes in shortcut: {}", keys));
                }
                code = Some(parse_key_code(&lower)?);
            }
        }
    }

    code.ok_or_else(|| format!("No key code found in: {}", keys))
        .map(|c| (modifiers, c))
}

/// 将单个键名解析为 Code 枚举
fn parse_key_code(key: &str) -> Result<Code, String> {
    let code = match key {
        "a" => Code::KeyA,
        "b" => Code::KeyB,
        "c" => Code::KeyC,
        "d" => Code::KeyD,
        "e" => Code::KeyE,
        "f" => Code::KeyF,
        "g" => Code::KeyG,
        "h" => Code::KeyH,
        "i" => Code::KeyI,
        "j" => Code::KeyJ,
        "k" => Code::KeyK,
        "l" => Code::KeyL,
        "m" => Code::KeyM,
        "n" => Code::KeyN,
        "o" => Code::KeyO,
        "p" => Code::KeyP,
        "q" => Code::KeyQ,
        "r" => Code::KeyR,
        "s" => Code::KeyS,
        "t" => Code::KeyT,
        "u" => Code::KeyU,
        "v" => Code::KeyV,
        "w" => Code::KeyW,
        "x" => Code::KeyX,
        "y" => Code::KeyY,
        "z" => Code::KeyZ,
        "0" => Code::Digit0,
        "1" => Code::Digit1,
        "2" => Code::Digit2,
        "3" => Code::Digit3,
        "4" => Code::Digit4,
        "5" => Code::Digit5,
        "6" => Code::Digit6,
        "7" => Code::Digit7,
        "8" => Code::Digit8,
        "9" => Code::Digit9,
        "space" => Code::Space,
        "enter" | "return" => Code::Enter,
        "escape" | "esc" => Code::Escape,
        "tab" => Code::Tab,
        "backspace" => Code::Backspace,
        "delete" | "del" => Code::Delete,
        "insert" => Code::Insert,
        "home" => Code::Home,
        "end" => Code::End,
        "pageup" => Code::PageUp,
        "pagedown" => Code::PageDown,
        "arrowup" | "up" => Code::ArrowUp,
        "arrowdown" | "down" => Code::ArrowDown,
        "arrowleft" | "left" => Code::ArrowLeft,
        "arrowright" | "right" => Code::ArrowRight,
        "f1" => Code::F1,
        "f2" => Code::F2,
        "f3" => Code::F3,
        "f4" => Code::F4,
        "f5" => Code::F5,
        "f6" => Code::F6,
        "f7" => Code::F7,
        "f8" => Code::F8,
        "f9" => Code::F9,
        "f10" => Code::F10,
        "f11" => Code::F11,
        "f12" => Code::F12,
        _ => return Err(format!("Unknown key: {}", key)),
    };
    Ok(code)
}

/// 注册单个快捷键（内部函数）
fn register_one(app: &AppHandle, config: &ShortcutConfig) -> Result<(), String> {
    if !config.enabled {
        return Ok(());
    }

    let (modifiers, code) = parse_shortcut_keys(&config.keys)?;
    let shortcut = Shortcut::new(Some(modifiers), code);
    let action = config.action.clone();

    app.global_shortcut()
        .on_shortcut(shortcut, move |app, _shortcut, event| {
            if event.state == PluginShortcutState::Pressed {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.emit(&action, ());
                }
            }
        })
        .map_err(|e| format!("Failed to register shortcut {}: {}", config.keys, e))?;
    Ok(())
}

/// 注销所有快捷键
pub fn unregister_all(app: &AppHandle) {
    let _ = app.global_shortcut().unregister_all();
}

/// 应用快捷键配置：先注销全部，再按配置逐个注册
pub fn apply_shortcuts(app: &AppHandle, configs: &[ShortcutConfig]) -> Result<(), String> {
    unregister_all(app);
    let mut errors = Vec::new();
    for config in configs {
        if let Err(e) = register_one(app, config) {
            eprintln!(
                "[Shortcuts] Failed to register {} ({}): {}",
                config.label, config.keys, e
            );
            errors.push(format!("{}: {}", config.label, e));
        }
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("; "))
    }
}

// ===== Tauri 命令 =====

/// 获取当前快捷键配置
#[tauri::command]
pub fn get_shortcuts_config(
    state: tauri::State<'_, ShortcutConfigState>,
) -> CmdResult<Vec<ShortcutConfig>> {
    let configs = state
        .configs
        .lock()
        .map_err(|_| AppError::Generic("shortcut state lock poisoned".into()))?;
    Ok(configs.clone())
}

/// 保存快捷键配置（持久化 + 重新注册）
#[tauri::command]
pub fn save_shortcuts_config(
    app: AppHandle,
    state: tauri::State<'_, ShortcutConfigState>,
    configs: Vec<ShortcutConfig>,
) -> CmdResult<()> {
    // 检测冲突：同一 keys 不能绑定多个功能（除非 disabled）
    let mut seen = std::collections::HashSet::new();
    for c in &configs {
        if !c.enabled {
            continue;
        }
        let key_lower = c.keys.to_lowercase();
        if !seen.insert(key_lower) {
            return Err(AppError::Generic(format!(
                "快捷键冲突：{} 被多个功能使用",
                c.keys
            )));
        }
    }

    // 重新注册
    apply_shortcuts(&app, &configs).map_err(AppError::Generic)?;

    // 持久化
    let path = preferences_path()?;
    save_shortcuts_to_file(&path, &configs)?;

    // 更新内存状态
    let mut current = state
        .configs
        .lock()
        .map_err(|_| AppError::Generic("shortcut state lock poisoned".into()))?;
    *current = configs;

    Ok(())
}

/// 恢复默认快捷键
#[tauri::command]
pub fn reset_shortcuts_config(
    app: AppHandle,
    state: tauri::State<'_, ShortcutConfigState>,
) -> CmdResult<Vec<ShortcutConfig>> {
    let defaults = default_shortcuts();
    apply_shortcuts(&app, &defaults).map_err(AppError::Generic)?;

    let path = preferences_path()?;
    save_shortcuts_to_file(&path, &defaults)?;

    let mut current = state
        .configs
        .lock()
        .map_err(|_| AppError::Generic("shortcut state lock poisoned".into()))?;
    *current = defaults.clone();

    Ok(defaults)
}
