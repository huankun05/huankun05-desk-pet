//! 后端（Python gateway / Core API）分发与启动辅助。
//!
//! ## 背景：原本的架构缺口
//! 旧代码用 `env!("CARGO_MANIFEST_DIR")` 推导 `server/` 与 `venv` 的位置。该常量是
//! **编译期**写死的构建机源码树路径，打包成 `.exe`/`.app` 后指向一台不存在的目录，
//! 导致干净安装根本找不到 Python 后端 —— 这就是「打包后整个流程跑不起来」的根因。
//!
//! ## 修复策略
//! 1. `server/` 作为 Tauri resource 打包进安装包（见 `tauri.conf.json` 的 `bundle.resources`）。
//!    权重与 `venv` 由 `.tauriignore` 剔除，不会进包。
//! 2. 运行时把「只读 resource 里的 `server/`」复制到可写的应用数据目录
//!    `%APPDATA%/desk-pet/backend/`（仅首次，靠标记文件跳过）。原因：gateway 会在
//!    `server/data/` 下写 sqlite / 日志等运行时数据，而 resource 目录是只读的。
//! 3. `venv` 必须落在可写目录：打包后建在 `%APPDATA%/desk-pet/backend/venv`，
//!    **首次运行自动 `python -m venv` + `pip install -r requirements.txt`**（bootstrap）。
//!    —— 之所以不在打包时直接塞入 venv：venv 内部写死绝对路径，且 torch/CUDA 轮子与
//!    具体机器强绑定，复制到别的机器无法可靠运行，必须在目标机上本地安装。
//! 4. Python 命令解析：打包后优先用 bootstrap 出来的 venv；dev 下优先项目 `venv/`，否则系统 `python`。

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::{Emitter, Manager};

const BACKEND_DIR_NAME: &str = "backend";

/// 是否处于打包环境：resource 目录里能找到打包进来的 `server/`。
pub fn is_packaged(app: &tauri::AppHandle) -> bool {
    let in_resource = app
        .path()
        .resource_dir()
        .map(|p| p.join("server").exists())
        .unwrap_or(false);
    // 开发期 exe 位于 target/debug 或 target/release，即便 resource_dir 误命中也要排除
    in_resource && !running_from_build_dir()
}

/// 应用数据根目录（可写）。优先 `%APPDATA%/desk-pet`，失败回退 exe 同级。
fn app_data_root(app: &tauri::AppHandle) -> PathBuf {
    app.path().app_data_dir().unwrap_or_else(|_| {
        std::env::current_exe()
            .ok()
            .and_then(|e| e.parent().map(|p| p.to_path_buf()))
            .unwrap_or_default()
    })
}

/// 后端根目录（包含 `server/` 的可写目录）。
///
/// - 打包后：从 resource 复制 `server/` 到 `%APPDATA%/desk-pet/backend/`（仅首次，靠标记文件跳过）。
/// - dev：直接返回 `CARGO_MANIFEST_DIR/..`（项目根，server/ 与 venv/ 都在那，无需复制）。
pub fn backend_root(app: &tauri::AppHandle) -> PathBuf {
    if is_packaged(app) {
        let src = match app.path().resource_dir() {
            Ok(r) => r.join("server"),
            Err(_) => return dev_root(),
        };
        let dst = app_data_root(app).join(BACKEND_DIR_NAME);
        let dst_server = dst.join("server");
        let marker = dst.join(".server_installed");
        if !marker.exists() {
            // 清理可能残留的旧副本后复制
            let _ = fs::remove_dir_all(&dst_server);
            if let Err(e) = copy_dir_all(&src, &dst_server) {
                eprintln!("[Backend] 复制 server/ 失败: {}", e);
                return src; // 复制失败则回退直接用只读 resource（功能受限但能启动）
            }
            let _ = fs::write(&marker, "1");
        }
        dst
    } else {
        dev_root()
    }
}

fn dev_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("..")
}

/// 解析用于启动 gateway / core 的 python 命令字符串。
pub fn resolve_python(app: &tauri::AppHandle) -> String {
    if is_packaged(app) {
        let venv_py = app_data_root(app)
            .join(BACKEND_DIR_NAME)
            .join("venv")
            .join("Scripts")
            .join("python.exe");
        if venv_py.exists() && can_import(&venv_py, "fastapi") {
            return venv_py.to_string_lossy().to_string();
        }
        // bootstrap 尚未执行或失败，尽量回退系统 python
        if command_ok("python", &["--version"]) {
            return "python".to_string();
        }
        if command_ok("python3", &["--version"]) {
            return "python3".to_string();
        }
        // 兜底：仍指向 venv 路径，启动失败时会触发错误事件便于排障
        return venv_py.to_string_lossy().to_string();
    }

    // dev：优先项目 venv
    let proj_venv = dev_root().join("venv").join("Scripts").join("python.exe");
    if proj_venv.exists() && can_import(&proj_venv, "fastapi") {
        return proj_venv.to_string_lossy().to_string();
    }
    if command_ok("python", &["--version"]) {
        return "python".to_string();
    }
    "python3".to_string()
}

/// 打包环境下确保后端 venv 已就绪（首次运行自动安装依赖）。
/// dev 环境不做事（由开发者自行维护 venv / 系统 python）。
///
/// 关键优化：打包后若本机已存在「装齐全部依赖」的 Python（如开发者的系统 Python），
/// 直接复用，绝不新建 venv、绝不重复下载数 GB 的 torch/funasr/mediapipe。
/// 仅在找不到任何可用 Python 时，才走「建 venv + pip install」的干净机器路径。
pub fn ensure_backend(app: &tauri::AppHandle) -> Result<(), String> {
    if !is_packaged(app) {
        return Ok(());
    }

    let root = backend_root(app); // 触发 server/ 复制
    let venv_dir = app_data_root(app).join(BACKEND_DIR_NAME).join("venv");
    let venv_py = venv_dir.join("Scripts").join("python.exe");

    if venv_py.exists() && can_import(&venv_py, "fastapi") {
        return Ok(()); // 已就绪，跳过
    }

    // 本机已有齐备依赖的 Python → 直接复用，跳过 venv 与下载
    if let Some(sys_py) = find_existing_suitable_python() {
        let _ = app.emit(
            "backend:install-done",
            format!(
                "检测到本机已具备 Python 后端依赖（{}），直接复用，无需下载",
                sys_py
            ),
        );
        return Ok(());
    }

    // 找基础 python
    let base = if command_ok("python", &["--version"]) {
        "python"
    } else if command_ok("python3", &["--version"]) {
        "python3"
    } else {
        let _ = app.emit(
            "backend:install-failed",
            "未检测到 Python，请先安装 Python 3.12 并加入 PATH 后重试",
        );
        return Err("未找到 Python".into());
    };

    let _ = app.emit(
        "backend:install-start",
        "正在初始化 Python 后端（首次运行需下载依赖，可能需要几分钟）",
    );

    // 1) 建 venv
    fs::create_dir_all(&venv_dir).map_err(|e| format!("创建 venv 目录失败: {}", e))?;
    let status = Command::new(base)
        .args(["-m", "venv", &venv_dir.to_string_lossy()])
        .status()
        .map_err(|e| format!("创建 venv 失败: {}", e))?;
    if !status.success() {
        let _ = app.emit("backend:install-failed", "创建 Python venv 失败");
        return Err("venv 创建失败".into());
    }

    // 2) 升级 pip
    let _ = app.emit("backend:install-step", "升级 pip…");
    let _ = Command::new(&venv_py)
        .args(["-m", "pip", "install", "--upgrade", "pip"])
        .status();

    // 3) 安装依赖（完整 requirements.txt，含 torch / funasr / 等）
    let req = root.join("server").join("requirements.txt");
    let _ = app.emit(
        "backend:install-step",
        "安装后端依赖（torch / funasr / mediapipe 等，可能需要几分钟）",
    );
    let status = Command::new(&venv_py)
        .args(["-m", "pip", "install", "-r", &req.to_string_lossy()])
        .status()
        .map_err(|e| format!("pip install 失败: {}", e))?;
    if !status.success() {
        let _ = app.emit(
            "backend:install-failed",
            "后端依赖安装失败，请检查网络后重启应用重试",
        );
        return Err("pip install 失败".into());
    }

    let _ = app.emit("backend:install-done", "后端依赖已就绪");
    Ok(())
}

fn can_import(python: &Path, module: &str) -> bool {
    Command::new(python)
        .arg("-c")
        .arg(format!("import {}", module))
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

fn command_ok(cmd: &str, args: &[&str]) -> bool {
    Command::new(cmd)
        .args(args)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

/// 判断某 python 是否已装齐后端运行所需的全部关键依赖。
/// 只要缺任意一个（典型如 mediapipe/torch），就不算「可直接复用」。
fn python_has_all_deps(python: &Path) -> bool {
    const MODS: &[&str] = &[
        "fastapi",
        "uvicorn",
        "torch",
        "funasr",
        "mediapipe",
        "numpy",
        "cv2",
        "edge_tts",
        "loguru",
        "websockets",
    ];
    MODS.iter().all(|m| can_import(python, m))
}

/// 在打包环境下，探测本机是否存在「已装齐全部依赖」的 Python（系统 python / python3）。
/// 命中则返回其绝对可执行路径，供 `ensure_backend` 跳过 venv 创建与下载。
fn find_existing_suitable_python() -> Option<String> {
    for cmd in ["python", "python3"] {
        if !command_ok(cmd, &["--version"]) {
            continue;
        }
        // 拿到绝对路径，避免后续工作目录变化导致解析偏差
        if let Ok(out) = Command::new(cmd)
            .args(["-c", "import sys; print(sys.executable)"])
            .output()
        {
            if out.status.success() {
                let exe = String::from_utf8_lossy(&out.stdout).trim().to_string();
                let path = Path::new(&exe);
                if !exe.is_empty() && python_has_all_deps(path) {
                    return Some(exe);
                }
            }
        }
    }
    None
}

fn running_from_build_dir() -> bool {
    std::env::current_exe()
        .map(|e| {
            let s = e.to_string_lossy();
            s.contains("target\\debug")
                || s.contains("target/release")
                || s.contains("target/debug")
                || s.contains("target/release")
        })
        .unwrap_or(false)
}

/// 递归复制目录（用于把只读 resource 里的 server/ 拷到可写目录）
fn copy_dir_all(src: &Path, dst: &Path) -> std::io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let path = entry.path();
        let dest = dst.join(entry.file_name());
        if path.is_dir() {
            copy_dir_all(&path, &dest)?;
        } else {
            let _ = fs::copy(&path, &dest); // 单个文件失败不致命
        }
    }
    Ok(())
}
