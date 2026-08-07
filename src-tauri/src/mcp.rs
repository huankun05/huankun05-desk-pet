//! MCP (Model Context Protocol) 进程管理器
//!
//! 管理 MCP Server 子进程的生命周期，通过 stdio JSON-RPC 通信。
//! 每个 MCP Server 是一个长期运行的后台进程，通过 stdin/stdout
//! 与 Tauri 后端进行双向 JSON-RPC 2.0 通信。

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Stdio};
use std::sync::Mutex;
use tauri::State;

use crate::errors::{AppError, CmdResult, McpError};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct McpToolInfo {
    pub name: String,
    pub description: String,
    pub server_id: String,
    pub input_schema: Value,
}

/// 正在运行的 MCP 进程
struct McpProcess {
    _child: Child,
    stdin: ChildStdin,
    stdout: BufReader<std::process::ChildStdout>,
}

// ---------------------------------------------------------------------------
// JSON-RPC helpers
// ---------------------------------------------------------------------------

fn jsonrpc_request(method: &str, params: Value) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": method,
        "params": params,
    })
}

fn send_request(proc: &mut McpProcess, method: &str, params: Value) -> Result<Value, McpError> {
    let req = jsonrpc_request(method, params);
    let req_str = req.to_string();

    // 写入 stdin
    writeln!(proc.stdin, "{}", req_str)
        .map_err(|e| McpError::IOError(format!("写入 MCP stdin: {}", e)))?;
    proc.stdin
        .flush()
        .map_err(|e| McpError::IOError(format!("刷新 MCP stdin: {}", e)))?;

    // 读取响应 — 使用 brace counting 支持多行 JSON
    let mut response_str = String::new();
    let mut brace_depth: i32 = 0;
    let mut in_string = false;

    loop {
        let mut line = String::new();
        let bytes_read = proc
            .stdout
            .read_line(&mut line)
            .map_err(|e| McpError::IOError(format!("读取 MCP stdout: {}", e)))?;

        if bytes_read == 0 {
            // EOF — 进程已退出
            return if response_str.is_empty() {
                Err(McpError::RequestFailed("MCP 服务器连接已关闭".into()))
            } else {
                break;
            };
        }

        let line = line.trim_end();
        if line.is_empty() {
            continue;
        }

        let mut escaped = false;
        for ch in line.chars() {
            if escaped {
                escaped = false;
                continue;
            }
            if ch == '\\' {
                escaped = true;
            } else if ch == '"' {
                in_string = !in_string;
            } else if !in_string {
                if ch == '{' {
                    brace_depth += 1;
                } else if ch == '}' {
                    brace_depth -= 1;
                }
            }
        }

        response_str.push_str(line);

        if brace_depth == 0 && !response_str.is_empty() {
            break;
        }
    }

    let trimmed = response_str.trim();
    if trimmed.is_empty() {
        return Err(McpError::ResponseParseFailed("空响应".into()));
    }

    let resp: Value = serde_json::from_str(trimmed).map_err(|e| {
        McpError::ResponseParseFailed(format!(
            "{} — 原文(前200字符): {}",
            e,
            &trimmed[..trimmed.len().min(200)]
        ))
    })?;

    // 检查是否有错误
    if let Some(err) = resp.get("error") {
        return Err(McpError::RequestFailed(format!(
            "JSON-RPC 错误: {}",
            err.get("message")
                .and_then(|m| m.as_str())
                .unwrap_or("unknown")
        )));
    }

    Ok(resp)
}

/// 发送一条通知（notification，无 id、不期望响应），仅写入并刷新 stdin
fn send_notification(proc: &mut McpProcess, method: &str, params: Value) -> Result<(), McpError> {
    let req = json!({
        "jsonrpc": "2.0",
        "method": method,
        "params": params,
    });
    let req_str = req.to_string();
    writeln!(proc.stdin, "{}", req_str)
        .map_err(|e| McpError::IOError(format!("写入 MCP stdin: {}", e)))?;
    proc.stdin
        .flush()
        .map_err(|e| McpError::IOError(format!("刷新 MCP stdin: {}", e)))?;
    Ok(())
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

pub struct McpManager {
    /// server_id -> 运行中的进程
    processes: Mutex<HashMap<String, McpProcess>>,
}

impl McpManager {
    pub fn new() -> Self {
        McpManager {
            processes: Mutex::new(HashMap::new()),
        }
    }
}

// ---------------------------------------------------------------------------
// Tauri Commands
// ---------------------------------------------------------------------------

/// 连接（启动）一个 MCP 服务器
/// 返回服务器 tool 列表
#[tauri::command]
pub fn mcp_connect(
    server_id: String,
    command: String,
    args: Vec<String>,
    state: State<McpManager>,
) -> CmdResult<Vec<McpToolInfo>> {
    let mut procs = state
        .processes
        .lock()
        .map_err(|_| AppError::Generic("MCP 状态锁中毒".into()))?;

    // 如果已有相同 ID 的连接，先断开
    if let Some(mut old) = procs.remove(&server_id) {
        let _ = old._child.kill();
        let _ = old._child.wait();
    }

    // 启动进程
    let mut child = std::process::Command::new(&command)
        .args(&args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| McpError::ProcessStartFailed {
            id: server_id.clone(),
            reason: format!("{}: {}", command, e),
        })?;

    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| McpError::ProcessStartFailed {
            id: server_id.clone(),
            reason: "无法获取 MCP 进程 stdin".into(),
        })?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| McpError::ProcessStartFailed {
            id: server_id.clone(),
            reason: "无法获取 MCP 进程 stdout".into(),
        })?;

    let mut proc = McpProcess {
        _child: child,
        stdin,
        stdout: BufReader::new(stdout),
    };

    // MCP 握手：先发送 initialize，再发送 notifications/initialized，最后才能调用 tools/list
    let _init_resp = send_request(
        &mut proc,
        "initialize",
        json!({
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": { "name": "desk-pet", "version": "0.1.0" }
        }),
    )?;
    send_notification(&mut proc, "notifications/initialized", json!({}))?;

    // 发送 tools/list 请求
    let resp = send_request(&mut proc, "tools/list", json!({}))?;

    // 解析工具列表
    let tools_val = resp
        .get("result")
        .and_then(|r| r.get("tools"))
        .ok_or_else(|| McpError::ResponseParseFailed("缺少 result.tools 字段".into()))?;

    let tools: Vec<McpToolInfo> = tools_val
        .as_array()
        .ok_or_else(|| McpError::ResponseParseFailed("tools 不是数组".into()))?
        .iter()
        .map(|t| McpToolInfo {
            name: t
                .get("name")
                .and_then(|n| n.as_str())
                .unwrap_or("unknown")
                .to_string(),
            description: t
                .get("description")
                .and_then(|d| d.as_str())
                .unwrap_or("")
                .to_string(),
            server_id: server_id.clone(),
            input_schema: t
                .get("inputSchema")
                .or_else(|| t.get("input_schema"))
                .cloned()
                .unwrap_or(json!({"type": "object", "properties": {}})),
        })
        .collect();

    // 保存进程引用
    procs.insert(server_id, proc);

    Ok(tools)
}

/// 调用 MCP 工具
#[tauri::command]
pub fn mcp_call_tool(
    server_id: String,
    tool_name: String,
    arguments: Value,
    state: State<McpManager>,
) -> CmdResult<String> {
    let mut procs = state
        .processes
        .lock()
        .map_err(|_| AppError::Generic("MCP 状态锁中毒".into()))?;

    let proc = procs
        .get_mut(&server_id)
        .ok_or_else(|| McpError::ConnectionNotFound {
            id: server_id.clone(),
        })?;

    let resp = send_request(
        proc,
        "tools/call",
        json!({
            "name": tool_name,
            "arguments": arguments,
        }),
    )?;

    let result = resp
        .get("result")
        .ok_or_else(|| McpError::ResponseParseFailed("缺少 result 字段".into()))?;

    // 提取文本内容
    if let Some(content) = result.get("content").and_then(|c| c.as_array()) {
        let texts: Vec<&str> = content
            .iter()
            .filter_map(|item| item.get("text").and_then(|t| t.as_str()))
            .collect();

        if !texts.is_empty() {
            return Ok(texts.join("\n"));
        }

        return Ok(result.to_string());
    }

    Ok(result.to_string())
}

/// 断开（停止）一个 MCP 服务器
#[tauri::command]
pub fn mcp_disconnect(server_id: String, state: State<McpManager>) -> CmdResult<()> {
    let mut procs = state
        .processes
        .lock()
        .map_err(|_| AppError::Generic("MCP 状态锁中毒".into()))?;

    if let Some(mut proc) = procs.remove(&server_id) {
        let _ = proc._child.kill();
        let _ = proc._child.wait();
    }

    Ok(())
}

/// 断开所有 MCP 服务器（用于应用退出清理）
#[tauri::command]
pub fn mcp_disconnect_all(state: State<McpManager>) -> CmdResult<()> {
    let mut procs = state
        .processes
        .lock()
        .map_err(|_| AppError::Generic("MCP 状态锁中毒".into()))?;

    for (_, mut proc) in procs.drain() {
        let _ = proc._child.kill();
        let _ = proc._child.wait();
    }

    Ok(())
}

/// 获取当前已连接服务器列表
#[tauri::command]
pub fn mcp_list_connections(state: State<McpManager>) -> CmdResult<Vec<String>> {
    let procs = state
        .processes
        .lock()
        .map_err(|_| AppError::Generic("MCP 状态锁中毒".into()))?;
    Ok(procs.keys().cloned().collect())
}
