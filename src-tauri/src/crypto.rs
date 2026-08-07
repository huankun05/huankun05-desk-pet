/// 加密/解密模块：DPAPI 加密、敏感数据文件读写
use std::fs;

use crate::errors::{AppError, CryptoError};
use crate::utils::get_data_dir;

/// 需要透明加密的敏感数据键名（包含 API Key 等敏感字段）
const SENSITIVE_KEYS: &[&str] = &["settings", "providers"];

const DPAPI_PREFIX: &str = "DPAPIv1:";

/// 使用 Windows DPAPI 加密数据，返回 Base64 编码 + 前缀的字符串
#[cfg(target_os = "windows")]
fn dpapi_encrypt(data: &str) -> Result<String, CryptoError> {
    use windows::Win32::Security::Cryptography::{
        CryptProtectData, CRYPTPROTECT_LOCAL_MACHINE, CRYPT_INTEGER_BLOB,
    };

    let data_blob = CRYPT_INTEGER_BLOB {
        cbData: data.len() as u32,
        pbData: data.as_ptr() as *mut u8,
    };

    let mut out_blob = CRYPT_INTEGER_BLOB::default();
    unsafe {
        CryptProtectData(
            &data_blob,
            None,
            None,
            None,
            None,
            CRYPTPROTECT_LOCAL_MACHINE,
            &mut out_blob,
        )
    }
    .map_err(|e| CryptoError::EncryptFailed(format!("CryptProtectData: {:?}", e)))?;

    let encrypted =
        unsafe { std::slice::from_raw_parts(out_blob.pbData, out_blob.cbData as usize).to_vec() };
    unsafe {
        let hlocal = windows::Win32::Foundation::HLOCAL(out_blob.pbData as *mut std::ffi::c_void);
        let _ = windows::Win32::Foundation::LocalFree(hlocal);
    }

    let encoded = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &encrypted);
    Ok(format!("{}{}", DPAPI_PREFIX, encoded))
}

#[cfg(not(target_os = "windows"))]
fn dpapi_encrypt(data: &str) -> Result<String, CryptoError> {
    // 非 Windows 平台：Base64 编码（无加密，安全级别不同）
    let encoded =
        base64::Engine::encode(&base64::engine::general_purpose::STANDARD, data.as_bytes());
    Ok(format!("{}{}", DPAPI_PREFIX, encoded))
}

/// 使用 Windows DPAPI 解密数据
#[cfg(target_os = "windows")]
fn dpapi_decrypt(encoded: &str) -> Result<String, CryptoError> {
    use windows::Win32::Security::Cryptography::{CryptUnprotectData, CRYPT_INTEGER_BLOB};

    let encrypted = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, encoded)
        .map_err(|e| CryptoError::Base64DecodeFailed(e.to_string()))?;

    let data_blob = CRYPT_INTEGER_BLOB {
        cbData: encrypted.len() as u32,
        pbData: encrypted.as_ptr() as *mut u8,
    };

    let mut out_blob = CRYPT_INTEGER_BLOB::default();
    unsafe { CryptUnprotectData(&data_blob, None, None, None, None, 0, &mut out_blob) }
        .map_err(|e| CryptoError::DecryptFailed(format!("CryptUnprotectData: {:?}", e)))?;

    let decrypted =
        unsafe { std::slice::from_raw_parts(out_blob.pbData, out_blob.cbData as usize).to_vec() };
    unsafe {
        let hlocal = windows::Win32::Foundation::HLOCAL(out_blob.pbData as *mut std::ffi::c_void);
        let _ = windows::Win32::Foundation::LocalFree(hlocal);
    }

    String::from_utf8(decrypted)
        .map_err(|e| CryptoError::DecryptFailed(format!("UTF-8 decode: {}", e)))
}

#[cfg(not(target_os = "windows"))]
fn dpapi_decrypt(encoded: &str) -> Result<String, CryptoError> {
    let bytes = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, encoded)
        .map_err(|e| CryptoError::Base64DecodeFailed(e.to_string()))?;
    String::from_utf8(bytes).map_err(|e| CryptoError::DecryptFailed(format!("UTF-8 decode: {}", e)))
}

/// 加密敏感数据（仅对 SENSITIVE_KEYS 中的 key 生效）
pub(crate) fn encrypt_if_sensitive(key: &str, data: &str) -> Result<String, AppError> {
    if SENSITIVE_KEYS.contains(&key) {
        Ok(dpapi_encrypt(data)?)
    } else {
        Ok(data.to_string())
    }
}

/// 解密文件内容（自动检测 DPAPIv1: 前缀）
pub fn decrypt_file_content(content: &str) -> Result<String, AppError> {
    if let Some(encoded) = content.strip_prefix(DPAPI_PREFIX) {
        Ok(dpapi_decrypt(encoded)?)
    } else {
        // 明文存储（旧数据兼容）
        Ok(content.to_string())
    }
}

/// 读取并解密敏感数据文件（供 HTTP handler 等直接读取文件的场景使用）
pub fn read_secure_file(key: &str) -> Result<String, AppError> {
    let dir = get_data_dir()?;
    let path = dir.join(format!("{}.json", key));
    if !path.exists() {
        return Ok(String::new());
    }
    let content = fs::read_to_string(&path)
        .map_err(|e| CryptoError::SecureFileReadFailed(format!("Failed to read {}: {}", key, e)))?;
    decrypt_file_content(&content)
}

/// 加密并写入敏感数据文件（供 HTTP handler 等直接写入文件的场景使用）
pub fn write_secure_file(key: &str, data: &str) -> Result<(), AppError> {
    let dir = get_data_dir()?;
    let path = dir.join(format!("{}.json", key));
    let storage_data = encrypt_if_sensitive(key, data)?;
    fs::write(&path, storage_data).map_err(|e| {
        CryptoError::SecureFileWriteFailed(format!("Failed to write {}: {}", key, e))
    })?;
    Ok(())
}
