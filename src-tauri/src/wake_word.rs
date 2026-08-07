//! 唤醒词模块：Vosk 模型文件管理
//!
//! 负责：
//! - 检查/下载 Vosk 中文小模型（vosk-model-small-cn-0.22, ~42MB）
//! - 提供模型文件路径（前端通过 convertFileSrc 加载）
//! - 下载进度通过 Tauri 事件通知前端

use std::fs;
use std::io::{Read, Write};
use std::path::PathBuf;
use tauri::{AppHandle, Emitter};

use crate::errors::{AppError, CmdResult};
use crate::utils::get_project_data_dir;

/// Vosk 中文小模型下载地址
const VOSK_MODEL_URL: &str = "https://alphacephei.com/vosk/models/vosk-model-small-cn-0.22.tar.gz";

/// 模型文件名（tar.gz 格式，vosk-browser 直接加载）
const MODEL_FILENAME: &str = "model.tar.gz";

/// 获取 Vosk 模型目录：data/models/vosk/
pub fn get_vosk_model_dir() -> Result<PathBuf, AppError> {
    let data_dir = get_project_data_dir()?;
    let model_dir = data_dir.join("models").join("vosk");
    if !model_dir.exists() {
        fs::create_dir_all(&model_dir)
            .map_err(|e| AppError::Generic(format!("Failed to create vosk model dir: {}", e)))?;
    }
    Ok(model_dir)
}

/// 获取模型文件完整路径
pub fn get_vosk_model_path() -> Result<PathBuf, AppError> {
    Ok(get_vosk_model_dir()?.join(MODEL_FILENAME))
}

/// 检查模型是否已下载
#[tauri::command]
pub fn check_vosk_model() -> CmdResult<bool> {
    let path = get_vosk_model_path()?;
    Ok(path.exists())
}

/// 获取模型文件大小（字节），不存在返回 0
#[tauri::command]
pub fn get_vosk_model_size() -> CmdResult<u64> {
    let path = get_vosk_model_path()?;
    Ok(fs::metadata(&path).map(|m| m.len()).unwrap_or(0))
}

/// 下载 Vosk 模型（带进度事件）
///
/// 进度事件：`vosk-model-progress`，payload = { downloaded: u64, total: u64 }
/// 完成事件：`vosk-model-downloaded`，payload = { path: String }
#[tauri::command]
pub async fn download_vosk_model(app: AppHandle) -> CmdResult<String> {
    let model_path = get_vosk_model_path()?;

    // 如果已存在，直接返回
    if model_path.exists() {
        return Ok(model_path.to_string_lossy().to_string());
    }

    let app_handle = app.clone();
    let path = model_path.clone();

    // 在阻塞线程中执行下载（避免阻塞 Tauri 主循环）
    let result = tauri::async_runtime::spawn_blocking(move || -> Result<String, AppError> {
        let resp = ureq::get(VOSK_MODEL_URL)
            .call()
            .map_err(|e| AppError::Generic(format!("Download failed: {}", e)))?;

        let total: u64 = resp
            .header("Content-Length")
            .and_then(|s| s.parse().ok())
            .unwrap_or(0);

        // 先写入临时文件，下载完成后重命名（避免半成品文件）
        let temp_path = path.with_extension("tar.gz.tmp");

        let mut reader = resp.into_reader();
        let mut file = fs::File::create(&temp_path)
            .map_err(|e| AppError::Generic(format!("Failed to create temp file: {}", e)))?;

        let mut downloaded: u64 = 0;
        let mut buf = [0u8; 32768];

        loop {
            let n = reader
                .read(&mut buf)
                .map_err(|e| AppError::Generic(format!("Read error: {}", e)))?;
            if n == 0 {
                break;
            }
            file.write_all(&buf[..n])
                .map_err(|e| AppError::Generic(format!("Write error: {}", e)))?;
            downloaded += n as u64;

            // 每 512KB 发送一次进度
            if downloaded % (512 * 1024) < n as u64 {
                let _ = app_handle.emit(
                    "vosk-model-progress",
                    serde_json::json!({ "downloaded": downloaded, "total": total }),
                );
            }
        }

        drop(file);

        // 重命名临时文件
        fs::rename(&temp_path, &path)
            .map_err(|e| AppError::Generic(format!("Failed to rename temp file: {}", e)))?;

        let _ = app_handle.emit("vosk-model-downloaded", &path.to_string_lossy().to_string());

        Ok(path.to_string_lossy().to_string())
    })
    .await
    .map_err(|e| AppError::Generic(format!("Download task failed: {}", e)))?;

    result
}

/// 删除已下载的 Vosk 模型（释放磁盘空间）
#[tauri::command]
pub fn delete_vosk_model() -> CmdResult<()> {
    let path = get_vosk_model_path()?;
    if path.exists() {
        fs::remove_file(&path)
            .map_err(|e| AppError::Generic(format!("Failed to delete model: {}", e)))?;
    }
    Ok(())
}
