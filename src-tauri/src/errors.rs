//! 统一错误类型模块
//!
//! 使用 thiserror 定义各子系统错误枚举，通过 AppError 统一对外暴露。
//! Tauri command 返回类型由 anyhow 的 `#[tauri::command]` 自动处理。

use serde::Serialize;
use thiserror::Error;

// ---------------------------------------------------------------------------
// AppError — 全局错误类型（anyhow 风格，带 thiserror 派生）
// ---------------------------------------------------------------------------

/// 应用程序全局错误类型
///
/// 所有子系统错误最终统一到此枚举，Tauri command 返回值中使用此类型，
/// 前端通过 `format!("{:#}", err)` 获取完整错误链。
#[derive(Debug, Error, Serialize)]
pub enum AppError {
    #[error("加密错误: {0}")]
    Crypto(#[from] CryptoError),

    #[error("服务管理错误: {0}")]
    Service(#[from] ServiceError),

    #[error("MCP 通信错误: {0}")]
    Mcp(#[from] McpError),

    #[error("管理后台错误: {0}")]
    Admin(#[from] AdminError),

    #[error("IO 错误: {0}")]
    Io(String),

    #[error("序列化错误: {0}")]
    Serialize(String),

    #[error("平台不支持: {0}")]
    PlatformUnsupported(String),

    #[error("{0}")]
    Generic(String),
}

// 实现 Tauri command 所需的 From<AppError> for String
// tauri 2.x 可自动通过 Serialize 或 Display 转换
impl From<AppError> for String {
    fn from(e: AppError) -> Self {
        e.to_string()
    }
}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        AppError::Io(e.to_string())
    }
}

impl From<serde_json::Error> for AppError {
    fn from(e: serde_json::Error) -> Self {
        AppError::Serialize(e.to_string())
    }
}

impl From<String> for AppError {
    fn from(s: String) -> Self {
        AppError::Generic(s)
    }
}

impl From<&str> for AppError {
    fn from(s: &str) -> Self {
        AppError::Generic(s.to_string())
    }
}

// ---------------------------------------------------------------------------
// 各子系统错误枚举
// ---------------------------------------------------------------------------

/// 加密/解密相关错误
#[derive(Debug, Error, Serialize)]
pub enum CryptoError {
    #[error("DPAPI 加密失败: {0}")]
    EncryptFailed(String),

    #[error("DPAPI 解密失败: {0}")]
    DecryptFailed(String),

    #[error("Base64 解码失败: {0}")]
    Base64DecodeFailed(String),

    #[error("安全文件不存在: {0}")]
    SecureFileNotFound(String),

    #[error("安全文件读取失败: {0}")]
    SecureFileReadFailed(String),

    #[error("安全文件写入失败: {0}")]
    SecureFileWriteFailed(String),
}

/// 服务管理相关错误
#[derive(Debug, Error, Serialize)]
pub enum ServiceError {
    #[error("服务 '{id}' 启动失败: {reason}")]
    StartFailed { id: String, reason: String },

    #[error("服务 '{id}' 启动后立即退出: exit_code={exit_code:?}")]
    ImmediateExit { id: String, exit_code: Option<i32> },

    #[error("服务 '{id}' 端口 {port} 已被占用")]
    PortInUse { id: String, port: u16 },

    #[error("服务 '{id}' 未找到")]
    NotFound { id: String },

    #[error("服务 '{id}' 健康检查失败: {reason}")]
    HealthCheckFailed { id: String, reason: String },

    #[error("服务 '{id}' 已达到最大重启次数 {max_retries}")]
    MaxRestartsExceeded { id: String, max_retries: u32 },

    #[error("Job Object 操作失败: {0}")]
    JobObjectFailed(String),

    #[error("进程操作失败: {0}")]
    ProcessFailed(String),

    #[error("服务列表锁中毒")]
    LockPoisoned,

    #[error("{0}")]
    Other(String),
}

/// MCP 协议相关错误
#[derive(Debug, Error, Serialize)]
pub enum McpError {
    #[error("MCP 服务器 '{id}' 进程启动失败: {reason}")]
    ProcessStartFailed { id: String, reason: String },

    #[error("MCP 服务器 '{id}' 连接未找到")]
    ConnectionNotFound { id: String },

    #[error("MCP JSON-RPC 请求失败: {0}")]
    RequestFailed(String),

    #[error("MCP 响应解析失败: {0}")]
    ResponseParseFailed(String),

    #[error("MCP 工具调用失败: tool={tool}, error={error}")]
    ToolCallFailed { tool: String, error: String },

    #[error("MCP stdin/stderr 通信错误: {0}")]
    IOError(String),

    #[error("{0}")]
    Other(String),
}

/// 管理后台相关错误
#[derive(Debug, Error, Serialize)]
pub enum AdminError {
    #[error("Token 生成/读取失败: {0}")]
    TokenError(String),

    #[error("鉴权失败: token 无效")]
    Unauthorized,

    #[error("端口 {port} 绑定失败（重试 {retries} 次后仍失败）")]
    PortBindFailed { port: u16, retries: u32 },

    #[error("路由未找到: {0}")]
    RouteNotFound(String),

    #[error("配置文件读取失败: {0}")]
    ConfigReadFailed(String),

    #[error("配置文件写入失败: {0}")]
    ConfigWriteFailed(String),

    #[error("状态锁中毒")]
    LockPoisoned,

    #[error("{0}")]
    Other(String),
}

// ---------------------------------------------------------------------------
// 类型别名（便于迁移）
// ---------------------------------------------------------------------------

/// Tauri command 统一返回类型
///
/// 在 Tauri 2.x 中，`#[tauri::command]` 会尝试 Display/Serialize 错误类型。
/// 使用此别名替代原 `Result<T, String>` 模式。
pub type CmdResult<T> = Result<T, AppError>;
