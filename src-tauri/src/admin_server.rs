/// 管理后台 HTTP 服务器模块
/// 提供管理面板 Web UI、REST API、配置管理、服务启停等功能
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{Emitter, Manager};

use crate::crypto::*;
use crate::service;
use crate::utils::*;
use crate::{sync_providers_to_settings, sync_settings_to_providers, AdminState};
/// HTTP 管理后台服务器
pub(crate) fn start_admin_server(app: tauri::AppHandle) {
    let data_dir = get_data_dir().unwrap_or_else(|_| PathBuf::from("."));

    std::thread::spawn(move || {
        // 带重试的端口绑定：如果端口被上轮残留进程占用，等待释放
        let server = {
            let mut server: Option<tiny_http::Server> = None;
            for attempt in 0..5 {
                match tiny_http::Server::http("127.0.0.1:9876") {
                    Ok(s) => {
                        if attempt > 0 {
                            println!("[Admin] Server started at http://127.0.0.1:9876 (after {} retries)", attempt);
                        } else {
                            println!("[Admin] Server started at http://127.0.0.1:9876");
                        }
                        server = Some(s);
                        break;
                    }
                    Err(e) => {
                        if attempt < 4 {
                            eprintln!(
                                "[Admin] Port 9876 busy, retrying in 1s (attempt {}/5)...",
                                attempt + 1
                            );
                            std::thread::sleep(std::time::Duration::from_secs(1));
                        } else {
                            eprintln!("[Admin] Failed to start server after 5 attempts: {}", e);
                        }
                    }
                }
            }
            match server {
                Some(s) => s,
                None => return,
            }
        };

        // Log server start
        let _ = append_log(
            &data_dir,
            "info",
            "管理后台服务器已启动 (http://127.0.0.1:9876)",
        );

        for mut request in server.incoming_requests() {
            let full_url = request.url().to_string();
            // strip query string for route matching (e.g. /?token=xxx → /)
            let url = full_url.split('?').next().unwrap_or(&full_url).to_string();
            let method = request.method().as_str().to_string();

            // Skip noisy CORS preflight logging
            if method != "OPTIONS" {
                println!("[Admin] {} {}", method, url);
            }

            // CORS headers — applied via cors_header() helper

            // Handle preflight
            if method == "OPTIONS" {
                let _ = request
                    .respond(tiny_http::Response::from_string("").with_header(cors_header()));
                continue;
            }

            // Auth check for /api/* routes (skip public endpoints)
            if url.starts_with("/api/") {
                let is_public_endpoint = url == "/api/admin-token"
                    || (method == "POST" && (url == "/api/log" || url == "/api/logs/clear"));
                if !is_public_endpoint {
                    let state = app.state::<AdminState>();
                    let expected_token = state.token.lock().expect("token lock poisoned");
                    let expected = format!("Bearer {}", expected_token);

                    let auth_header = request
                        .headers()
                        .iter()
                        .find(|h| {
                            h.field
                                .as_str()
                                .as_str()
                                .eq_ignore_ascii_case("Authorization")
                        })
                        .map(|h| h.value.as_str().to_string());

                    let url_token = full_url
                        .split('?')
                        .nth(1)
                        .and_then(|q| q.split('&').find(|p| p.starts_with("token=")))
                        .map(|p| p.strip_prefix("token=").unwrap_or(""));

                    let is_authorized = auth_header.as_deref() == Some(&expected)
                        || url_token == Some(expected_token.as_str());

                    if !is_authorized {
                        let _ = request.respond(
                            tiny_http::Response::from_string("{\"error\":\"unauthorized\"}")
                                .with_status_code(401)
                                .with_header(cors_header()),
                        );
                        continue;
                    }
                }
            }

            let response = match (method.as_str(), url.as_str()) {
                // favicon — 返回 204 避免 404 噪音
                ("GET", "/favicon.ico") => {
                    tiny_http::Response::from_string("").with_status_code(204)
                }

                // API: 获取 admin token（公开端点，用于浏览器直接访问时获取 token）
                ("GET", "/api/admin-token") => {
                    let state = app.state::<AdminState>();
                    let token = state.token.lock().expect("token lock poisoned").clone();
                    tiny_http::Response::from_string(
                        serde_json::json!({"token": token}).to_string(),
                    )
                    .with_header(json_header())
                }

                // 管理页面 — 优先使用构建产物（dist/admin.html），否则回退到嵌入的旧版本
                ("GET", "/") | ("GET", "/index.html") => {
                    let dist_path = app
                        .path()
                        .resource_dir()
                        .map(|r| r.join("dist").join("admin.html"))
                        .unwrap_or_else(|_| PathBuf::new());
                    let dist_path = if dist_path.exists() {
                        dist_path
                    } else {
                        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                            .join("..")
                            .join("dist")
                            .join("admin.html")
                    };
                    let mut html = if dist_path.exists() {
                        fs::read_to_string(&dist_path)
                            .unwrap_or_else(|_| include_str!("../admin.html").to_string())
                    } else {
                        include_str!("../admin.html").to_string()
                    };
                    let state = app.state::<AdminState>();
                    let token = state.token.lock().expect("token lock poisoned").clone();
                    let token_script =
                        format!("<script>window.__ADMIN_TOKEN__ = '{}';</script>", token);
                    html = html.replace("</head>", &format!("{}</head>", token_script));
                    let ct = parse_content_type("text/html; charset=utf-8");
                    tiny_http::Response::from_string(html).with_header(ct)
                }

                // API: 情绪状态
                ("GET", "/api/state") => {
                    let path = data_dir.join("emotion.json");
                    let content = if path.exists() {
                        fs::read_to_string(&path).unwrap_or_default()
                    } else {
                        "{}".into()
                    };
                    // Add emoji/color enrichment
                    if let Ok(mut v) = serde_json::from_str::<serde_json::Value>(&content) {
                        let emo = v["emotion"].as_str().unwrap_or("happy").to_string();
                        let mood = v["mood"].as_str().unwrap_or("cheerful").to_string();
                        let emoji_map = serde_json::json!({
                            "happy":"😄","sad":"😢","angry":"😠","shy":"😳","thinking":"🤔",
                            "surprised":"😮","talking":"💬","excited":"🤩","curious":"🧐","sleepy":"😴","idle":"😊"
                        });
                        let mood_map = serde_json::json!({
                            "cheerful":"😄","content":"😊","melancholy":"😔","excited":"🤩","calm":"😌"
                        });
                        v["emotionEmoji"] = serde_json::json!(emoji_map[emo]);
                        v["moodEmoji"] = serde_json::json!(mood_map[mood]);
                        let fav = v["favorability"].as_f64().unwrap_or(50.0);
                        let color = if fav >= 80.0 {
                            "#f59e0b"
                        } else if fav >= 60.0 {
                            "#10b981"
                        } else if fav >= 40.0 {
                            "#6366f1"
                        } else if fav >= 20.0 {
                            "#94a3b8"
                        } else {
                            "#ef4444"
                        };
                        v["favColor"] = serde_json::json!(color);
                        // 读取情绪历史
                        let hist_path = data_dir.join("emotionHistory.json");
                        if let Ok(hist_content) = fs::read_to_string(&hist_path) {
                            if let Ok(hist) =
                                serde_json::from_str::<serde_json::Value>(&hist_content)
                            {
                                v["history"] = hist;
                            }
                        }
                        tiny_http::Response::from_string(v.to_string()).with_header(json_header())
                    } else {
                        tiny_http::Response::from_string(content).with_header(json_header())
                    }
                }

                // API: 记忆数据
                ("GET", "/api/memory") => {
                    let path = data_dir.join("memory.json");
                    let content = if path.exists() {
                        fs::read_to_string(&path).unwrap_or_default()
                    } else {
                        "{}".into()
                    };
                    tiny_http::Response::from_string(content).with_header(json_header())
                }

                // API: 情感历史
                ("GET", "/api/history") => {
                    let path = data_dir.join("emotion.json");
                    let content = if path.exists() {
                        fs::read_to_string(&path).unwrap_or_default()
                    } else {
                        "{}".into()
                    };
                    // 从 emotion 文件读取历史（简化版，实际历史在 localStorage）
                    let mut resp = serde_json::json!({"history": []});
                    if let Ok(v) = serde_json::from_str::<serde_json::Value>(&content) {
                        resp["emotion"] = v["emotion"].clone();
                        resp["mood"] = v["mood"].clone();
                    }
                    tiny_http::Response::from_string(resp.to_string()).with_header(json_header())
                }

                // API: 添加规则
                ("POST", "/api/rules/add") => {
                    let mut body = String::new();
                    let _ = request.as_reader().read_to_string(&mut body);
                    let memory_path = data_dir.join("memory.json");
                    let mut memory: serde_json::Value = if memory_path.exists() {
                        serde_json::from_str(&fs::read_to_string(&memory_path).unwrap_or_default())
                            .unwrap_or(serde_json::json!({}))
                    } else {
                        serde_json::json!({"rules":[]})
                    };
                    if let Ok(payload) = serde_json::from_str::<serde_json::Value>(&body) {
                        let content = payload["content"].as_str().unwrap_or("");
                        if !content.is_empty() {
                            let empty = &mut vec![];
                            let rules = memory["rules"].as_array_mut().unwrap_or(empty);
                            let now_ms = SystemTime::now()
                                .duration_since(UNIX_EPOCH)
                                .unwrap_or_default()
                                .as_millis();
                            rules.push(serde_json::json!({
                                "id": format!("rule_{}", now_ms),
                                "content": content,
                                "enabled": true,
                                "createdAt": now_ms.to_string(),
                            }));
                            let _ = fs::write(&memory_path, memory.to_string());
                            let _ = append_log(
                                &data_dir,
                                "info",
                                &format!(
                                    "添加规则: {}",
                                    content.chars().take(50).collect::<String>()
                                ),
                            );
                            emit_memory_update(&app, &data_dir);
                        }
                    }
                    tiny_http::Response::from_string("{\"ok\":true}").with_header(json_header())
                }

                // API: 切换规则
                ("POST", "/api/rules/toggle") => {
                    let mut body = String::new();
                    let _ = request.as_reader().read_to_string(&mut body);
                    let memory_path = data_dir.join("memory.json");
                    if let Ok(mut memory) = serde_json::from_str::<serde_json::Value>(
                        &fs::read_to_string(&memory_path).unwrap_or_default(),
                    ) {
                        if let Ok(payload) = serde_json::from_str::<serde_json::Value>(&body) {
                            let id = payload["id"].as_str().unwrap_or("");
                            if let Some(rules) = memory["rules"].as_array_mut() {
                                for rule in rules.iter_mut() {
                                    if rule["id"] == id {
                                        let enabled = rule["enabled"].as_bool().unwrap_or(true);
                                        rule["enabled"] = serde_json::json!(!enabled);
                                        break;
                                    }
                                }
                            }
                            let _ = fs::write(&memory_path, memory.to_string());
                        }
                    }
                    emit_memory_update(&app, &data_dir);
                    tiny_http::Response::from_string("{\"ok\":true}").with_header(json_header())
                }

                // API: 删除规则
                ("POST", "/api/rules/remove") => {
                    let mut body = String::new();
                    let _ = request.as_reader().read_to_string(&mut body);
                    let memory_path = data_dir.join("memory.json");
                    if let Ok(mut memory) = serde_json::from_str::<serde_json::Value>(
                        &fs::read_to_string(&memory_path).unwrap_or_default(),
                    ) {
                        if let Ok(payload) = serde_json::from_str::<serde_json::Value>(&body) {
                            let id = payload["id"].as_str().unwrap_or("");
                            if let Some(rules) = memory["rules"].as_array_mut() {
                                rules.retain(|r| r["id"] != id);
                            }
                            let _ = fs::write(&memory_path, memory.to_string());
                        }
                    }
                    emit_memory_update(&app, &data_dir);
                    tiny_http::Response::from_string("{\"ok\":true}").with_header(json_header())
                }

                // API: 清空事实
                ("POST", "/api/facts/clear") => {
                    let memory_path = data_dir.join("memory.json");
                    if let Ok(mut memory) = serde_json::from_str::<serde_json::Value>(
                        &fs::read_to_string(&memory_path).unwrap_or_default(),
                    ) {
                        memory["facts"] = serde_json::json!([]);
                        let _ = fs::write(&memory_path, memory.to_string());
                    }
                    emit_memory_update(&app, &data_dir);
                    tiny_http::Response::from_string("{\"ok\":true}").with_header(json_header())
                }

                // API: 会话列表
                ("GET", "/api/sessions") => {
                    let path = data_dir.join("chat_sessions.json");
                    let content = if path.exists() {
                        fs::read_to_string(&path).unwrap_or_default()
                    } else {
                        "{}".into()
                    };
                    tiny_http::Response::from_string(content).with_header(json_header())
                }

                // API: 会话详情 /api/session/{id}
                ("GET", url)
                    if url.starts_with("/api/session/")
                        && !url.ends_with("/delete")
                        && !url.ends_with("/provider") =>
                {
                    let id = url.trim_start_matches("/api/session/");
                    let path = data_dir.join("chat_sessions.json");
                    let found = (|| -> Option<String> {
                        let content = fs::read_to_string(&path).ok()?;
                        let data: serde_json::Value = serde_json::from_str(&content).ok()?;
                        let sessions = data["sessions"].as_array()?;
                        let session = sessions.iter().find(|s| s["id"] == id)?;
                        Some(session.to_string())
                    })();
                    match found {
                        Some(json) => {
                            tiny_http::Response::from_string(json).with_header(json_header())
                        }
                        None => tiny_http::Response::from_string("{}").with_status_code(404),
                    }
                }

                // API: 发送消息并获取 AI 回复
                ("POST", "/api/chat/send") => {
                    let body = read_body(&mut request);
                    let resp = (|| -> Result<serde_json::Value, String> {
                        let payload: serde_json::Value =
                            serde_json::from_str(&body).map_err(|e| e.to_string())?;
                        let session_id =
                            payload["sessionId"].as_str().ok_or("missing sessionId")?;
                        let user_content = payload["content"].as_str().ok_or("missing content")?;
                        if user_content.is_empty() {
                            return Err("empty content".into());
                        }

                        // 读取会话
                        let sessions_path = data_dir.join("chat_sessions.json");
                        let mut sessions_data: serde_json::Value = serde_json::from_str(
                            &fs::read_to_string(&sessions_path).unwrap_or_default(),
                        )
                        .unwrap_or(serde_json::json!({"sessions":[]}));
                        let sessions = sessions_data["sessions"]
                            .as_array_mut()
                            .ok_or("no sessions")?;
                        let session = sessions
                            .iter_mut()
                            .find(|s| s["id"] == session_id)
                            .ok_or("session not found")?;
                        let messages = session["messages"]
                            .as_array_mut()
                            .ok_or("no messages array")?;

                        // 追加用户消息
                        let now_ms = SystemTime::now()
                            .duration_since(UNIX_EPOCH)
                            .unwrap_or_default()
                            .as_millis();
                        messages.push(serde_json::json!({
                            "id": format!("msg_{}", now_ms),
                            "role": "user",
                            "content": user_content,
                            "timestamp": now_ms.to_string(),
                        }));

                        // 读取 settings.json（用于 system prompt 和 fallback）
                        let settings: serde_json::Value =
                            serde_json::from_str(&read_secure_file("settings").unwrap_or_default())
                                .unwrap_or(serde_json::json!({}));

                        // ===== 解析 AI 配置：三级优先级 =====
                        // 1) 会话级 Provider 覆盖（providers.json sessionOverrides）
                        // 2) 全局活跃 Provider（providers.json activeChatId）
                        // 3) legacy settings.json fallback
                        let mut api_url = String::new();
                        let mut api_key = String::new();
                        let mut model = String::new();
                        let mut is_ollama = false;

                        let _providers_path = data_dir.join("providers.json");
                        {
                            if let Ok(providers_raw) = read_secure_file("providers") {
                                if let Ok(providers) =
                                    serde_json::from_str::<serde_json::Value>(&providers_raw)
                                {
                                    let configs = providers["configs"].as_array();
                                    // 优先级 1: 会话级覆盖
                                    let override_chat_id = providers["sessionOverrides"]
                                        [session_id]["chatId"]
                                        .as_str();
                                    let target_id = override_chat_id.or_else(|| {
                                        // 优先级 2: 全局活跃 Provider
                                        providers["activeChatId"].as_str()
                                    });

                                    if let Some(chat_id) = target_id {
                                        if let Some(configs) = configs {
                                            if let Some(provider) = configs.iter().find(|c| {
                                                c["id"].as_str() == Some(chat_id)
                                                    && c["enable"].as_bool().unwrap_or(true)
                                                    && c["type"].as_str() == Some("chat")
                                            }) {
                                                api_url = provider["apiBase"]
                                                    .as_str()
                                                    .unwrap_or("")
                                                    .to_string();
                                                api_key = provider["apiKey"]
                                                    .as_str()
                                                    .unwrap_or("")
                                                    .to_string();
                                                model = provider["model"]
                                                    .as_str()
                                                    .unwrap_or("")
                                                    .to_string();
                                                is_ollama =
                                                    provider["typeName"].as_str() == Some("ollama");
                                            }
                                        }
                                    }
                                }
                            }
                        }

                        // 优先级 3: legacy settings.json fallback
                        if api_url.is_empty() {
                            api_url = settings["apiUrl"]
                                .as_str()
                                .unwrap_or("https://api.openai.com/v1")
                                .to_string();
                            api_key = settings["apiKey"].as_str().unwrap_or("").to_string();
                            model = settings["model"]
                                .as_str()
                                .unwrap_or("gpt-3.5-turbo")
                                .to_string();
                        }

                        let api_url = api_url.as_str();
                        let api_key = api_key.as_str();
                        let model = model.as_str();
                        // Ollama 不需要 API Key；其他 Provider 需要
                        if !is_ollama && api_key.is_empty() && !api_url.contains("localhost") {
                            return Err("API key not configured. Please configure in Providers or Settings.".into());
                        }

                        // 读取 system prompt（从 settings 或默认值）
                        let system_prompt = settings["systemPrompt"]
                            .as_str()
                            .unwrap_or("You are a cute desktop pet.");

                        // 读取情感状态注入上下文
                        let emotion_path = data_dir.join("emotion.json");
                        let emotion_data: serde_json::Value = serde_json::from_str(
                            &fs::read_to_string(&emotion_path).unwrap_or_default(),
                        )
                        .unwrap_or(serde_json::json!({}));
                        let emo = emotion_data["emotion"].as_str().unwrap_or("happy");
                        let mood = emotion_data["mood"].as_str().unwrap_or("cheerful");
                        let fav = emotion_data["favorability"].as_f64().unwrap_or(50.0);
                        let mood_i = emotion_data["moodIntensity"].as_f64().unwrap_or(0.5);
                        let emo_i = emotion_data["emotionIntensity"].as_f64().unwrap_or(0.5);
                        let fav_desc = if fav >= 80.0 {
                            "非常喜欢"
                        } else if fav >= 60.0 {
                            "有好感"
                        } else if fav >= 40.0 {
                            "友好"
                        } else if fav >= 20.0 {
                            "普通"
                        } else {
                            "冷淡"
                        };

                        // 读取记忆上下文
                        let memory_path = data_dir.join("memory.json");
                        let memory_data: serde_json::Value = serde_json::from_str(
                            &fs::read_to_string(&memory_path).unwrap_or_default(),
                        )
                        .unwrap_or(serde_json::json!({}));
                        let mut context_parts: Vec<String> = vec![];
                        // 规则
                        if let Some(rules) = memory_data["rules"].as_array() {
                            let active: Vec<&str> = rules
                                .iter()
                                .filter(|r| r["enabled"].as_bool().unwrap_or(true))
                                .filter_map(|r| r["content"].as_str())
                                .collect();
                            if !active.is_empty() {
                                context_parts.push(format!("[规则]\n{}", active.join("\n")));
                            }
                        }
                        // 偏好
                        if let Some(prefs) = memory_data["preferences"].as_object() {
                            if !prefs.is_empty() {
                                let p: Vec<String> =
                                    prefs.iter().map(|(k, v)| format!("{}: {}", k, v)).collect();
                                context_parts.push(format!("[用户偏好]\n{}", p.join("\n")));
                            }
                        }
                        let memory_ctx = if context_parts.is_empty() {
                            String::new()
                        } else {
                            context_parts.join("\n\n")
                        };

                        // 构建消息
                        let mut api_messages: Vec<serde_json::Value> = vec![];
                        let mut full_prompt = system_prompt.to_string();
                        if !memory_ctx.is_empty() {
                            full_prompt.push_str(&format!("\n\n{}", memory_ctx));
                        }
                        full_prompt.push_str(&format!("\n\n[你的当前状态]\n心情：{}（强度 {}%）\n情绪：{}（强度 {}%）\n对用户的好感度：{}/100（{}）",
                            mood, (mood_i * 100.0) as i32, emo, (emo_i * 100.0) as i32, fav as i32, fav_desc));
                        if settings["enableThinkTags"].as_bool().unwrap_or(false) {
                            full_prompt.push_str(
                                "\n\n你可以在回复中使用 <think>动作或想法</think> 来表达内心活动。",
                            );
                        }
                        api_messages
                            .push(serde_json::json!({"role":"system","content":full_prompt}));

                        // 最近 20 条历史
                        let recent: Vec<&serde_json::Value> =
                            messages.iter().rev().take(20).rev().collect();
                        for m in recent {
                            api_messages.push(
                                serde_json::json!({"role": m["role"], "content": m["content"]}),
                            );
                        }

                        // 调用 AI API
                        let chat_url =
                            format!("{}/chat/completions", api_url.trim_end_matches('/'));
                        let req_body = serde_json::json!({
                            "model": model,
                            "messages": api_messages,
                            "temperature": 0.7,
                            "max_tokens": 500,
                        })
                        .to_string();

                        let mut cmd = std::process::Command::new("curl");
                        cmd.args([
                            "-s",
                            "--max-time",
                            "30",
                            "-X",
                            "POST",
                            &chat_url,
                            "-H",
                            "Content-Type: application/json",
                            "-d",
                            &req_body,
                        ]);
                        // Ollama 等本地服务不需要 Authorization header
                        if !api_key.is_empty() {
                            cmd.arg("-H");
                            cmd.arg(format!("Authorization: Bearer {}", api_key));
                        }
                        let output = cmd.output().map_err(|e| format!("curl failed: {}", e))?;

                        let resp_raw = String::from_utf8_lossy(&output.stdout).to_string();
                        let resp_data: serde_json::Value = serde_json::from_str(&resp_raw)
                            .map_err(|e| format!("invalid response: {}", e))?;

                        // 提取回复
                        let assistant_content = resp_data["choices"][0]["message"]["content"]
                            .as_str()
                            .unwrap_or("(无回复)")
                            .to_string();

                        // 保存助手回复
                        let now_ms2 = SystemTime::now()
                            .duration_since(UNIX_EPOCH)
                            .unwrap_or_default()
                            .as_millis();
                        messages.push(serde_json::json!({
                            "id": format!("msg_{}", now_ms2),
                            "role": "assistant",
                            "content": assistant_content,
                            "timestamp": now_ms2.to_string(),
                        }));

                        // 更新会话标题（如果是第一条消息）
                        let user_msgs: Vec<_> =
                            messages.iter().filter(|m| m["role"] == "user").collect();
                        if user_msgs.len() == 1 && session["title"].as_str() == Some("新对话") {
                            let title = user_content.chars().take(20).collect::<String>();
                            session["title"] = serde_json::json!(title);
                        }
                        session["updatedAt"] = serde_json::json!(now_ms2.to_string());

                        // 写回文件
                        let _ = fs::write(&sessions_path, sessions_data.to_string());
                        let _ = append_log(
                            &data_dir,
                            "info",
                            &format!(
                                "后台聊天: {} → AI回复({})",
                                user_content.chars().take(30).collect::<String>(),
                                assistant_content.chars().take(30).collect::<String>()
                            ),
                        );

                        Ok(serde_json::json!({"ok":true, "reply": assistant_content}))
                    })();

                    // 通知宠物应用会话已更新
                    let _ = app.emit("admin-sessions-update", ());

                    match resp {
                        Ok(v) => tiny_http::Response::from_string(v.to_string())
                            .with_header(json_header()),
                        Err(e) => tiny_http::Response::from_string(
                            serde_json::json!({"ok":false,"error":e}).to_string(),
                        )
                        .with_header(json_header()),
                    }
                }

                // API: 删除会话 /api/session/{id}/delete
                ("POST", url) if url.starts_with("/api/session/") && url.ends_with("/delete") => {
                    let id = url
                        .trim_start_matches("/api/session/")
                        .trim_end_matches("/delete");
                    let path = data_dir.join("chat_sessions.json");
                    if let Ok(content) = fs::read_to_string(&path) {
                        if let Ok(mut data) = serde_json::from_str::<serde_json::Value>(&content) {
                            let next_id = data["sessions"]
                                .as_array()
                                .and_then(|s| s.iter().find(|x| x["id"] != id))
                                .map(|s| s["id"].clone());
                            if let Some(sessions) = data["sessions"].as_array_mut() {
                                sessions.retain(|s| s["id"] != id);
                                if data["activeSessionId"] == id {
                                    data["activeSessionId"] =
                                        next_id.unwrap_or(serde_json::Value::Null);
                                }
                                let _ = fs::write(&path, data.to_string());
                            }
                        }
                    }
                    let _ = app.emit("admin-sessions-update", ());
                    tiny_http::Response::from_string("{\"ok\":true}").with_header(json_header())
                }

                // API: 设置读取
                ("GET", "/api/settings") => {
                    let content = read_secure_file("settings").unwrap_or_else(|_| String::new());
                    if content.is_empty() { /* 兼容旧逻辑：空文件返回 {} */ }
                    let content = if content.is_empty() {
                        "{}".to_string()
                    } else {
                        content
                    };
                    tiny_http::Response::from_string(content).with_header(json_header())
                }

                // API: 设置保存
                ("POST", "/api/settings/save") => {
                    let mut body = String::new();
                    let _ = request.as_reader().read_to_string(&mut body);
                    let _ = write_secure_file("settings", &body);
                    // 通知宠物应用更新设置
                    if let Ok(payload) = serde_json::from_str::<serde_json::Value>(&body) {
                        let _ = app.emit("admin-settings-update", payload.clone());

                        // 同步 chat 配置到 providers.json（保持新旧系统一致）
                        if let (Some(api_url), Some(api_key), Some(model)) = (
                            payload["apiUrl"].as_str(),
                            payload["apiKey"].as_str(),
                            payload["model"].as_str(),
                        ) {
                            let _ = sync_settings_to_providers(&data_dir, api_url, api_key, model);
                            let _ = app.emit("admin-providers-update", ());
                        }
                    }
                    let _ = append_log(&data_dir, "info", "设置已保存");
                    tiny_http::Response::from_string("{\"ok\":true}").with_header(json_header())
                }

                // API: 修改情绪状态
                ("POST", "/api/state/update") => {
                    let body = read_body(&mut request);
                    let emotion_path = data_dir.join("emotion.json");
                    let mut emotion: serde_json::Value = if emotion_path.exists() {
                        serde_json::from_str(&fs::read_to_string(&emotion_path).unwrap_or_default())
                            .unwrap_or(serde_json::json!({}))
                    } else {
                        serde_json::json!({})
                    };
                    if let Ok(payload) = serde_json::from_str::<serde_json::Value>(&body) {
                        if let Some(v) = payload.get("emotion").and_then(|v| v.as_str()) {
                            emotion["emotion"] = serde_json::json!(v);
                        }
                        if let Some(v) = payload.get("mood").and_then(|v| v.as_str()) {
                            emotion["mood"] = serde_json::json!(v);
                        }
                        if let Some(v) = payload.get("emotionIntensity").and_then(|v| v.as_f64()) {
                            emotion["emotionIntensity"] = serde_json::json!(v);
                        }
                        if let Some(v) = payload.get("moodIntensity").and_then(|v| v.as_f64()) {
                            emotion["moodIntensity"] = serde_json::json!(v);
                        }
                        if let Some(v) = payload.get("favorability").and_then(|v| v.as_f64()) {
                            emotion["favorability"] = serde_json::json!(v);
                        }
                        if let Some(v) = payload.get("reason").and_then(|v| v.as_str()) {
                            emotion["reason"] = serde_json::json!(v);
                        }
                        if let Some(p) = payload.get("personality") {
                            emotion["personality"] = p.clone();
                        }
                        if let Some(p) = payload.get("expressionMap") {
                            emotion["expressionMap"] = p.clone();
                        }
                        if let Some(p) = payload.get("idleExpressions") {
                            emotion["idleExpressions"] = p.clone();
                        }
                        if let Some(p) = payload.get("config") {
                            emotion["config"] = p.clone();
                        }
                        if let Some(p) = payload.get("customEmotions") {
                            emotion["customEmotions"] = p.clone();
                        }
                        let now_ms = SystemTime::now()
                            .duration_since(UNIX_EPOCH)
                            .unwrap_or_default()
                            .as_millis();
                        emotion["lastChange"] = serde_json::json!(now_ms.to_string());
                        let _ = fs::write(&emotion_path, emotion.to_string());
                        let changes: Vec<String> = {
                            let mut c = vec![];
                            if payload.get("emotion").is_some() {
                                c.push(format!(
                                    "emotion={}",
                                    payload["emotion"].as_str().unwrap_or("?")
                                ));
                            }
                            if payload.get("mood").is_some() {
                                c.push(format!("mood={}", payload["mood"].as_str().unwrap_or("?")));
                            }
                            if payload.get("favorability").is_some() {
                                c.push(format!(
                                    "fav={}",
                                    payload["favorability"].as_f64().unwrap_or(0.0)
                                ));
                            }
                            if payload.get("personality").is_some() {
                                c.push("personality".to_string());
                            }
                            c
                        };
                        let _ = append_log(
                            &data_dir,
                            "info",
                            &format!("状态更新: {}", changes.join(", ")),
                        );
                        // Emit event to pet app frontend
                        let _ = app.emit("admin-state-update", payload.clone());
                    }
                    tiny_http::Response::from_string("{\"ok\":true}").with_header(json_header())
                }

                // API: 统计数据
                ("GET", "/api/stats") => {
                    let sessions_path = data_dir.join("chat_sessions.json");
                    let memory_path = data_dir.join("memory.json");
                    let mut total_messages: usize = 0;
                    let mut total_sessions: usize = 0;
                    let mut created_dates: std::collections::HashSet<String> =
                        std::collections::HashSet::new();
                    if let Ok(content) = fs::read_to_string(&sessions_path) {
                        if let Ok(data) = serde_json::from_str::<serde_json::Value>(&content) {
                            if let Some(sessions) = data["sessions"].as_array() {
                                total_sessions = sessions.len();
                                for s in sessions {
                                    if let Some(msgs) = s["messages"].as_array() {
                                        total_messages += msgs.len();
                                    }
                                    if let Some(ts) = s["createdAt"].as_u64() {
                                        let d = chrono_timestamp_to_date(ts);
                                        created_dates.insert(d);
                                    }
                                }
                            }
                        }
                    }
                    let total_facts: usize = if let Ok(content) = fs::read_to_string(&memory_path) {
                        if let Ok(data) = serde_json::from_str::<serde_json::Value>(&content) {
                            data["facts"].as_array().map_or(0, |a| a.len())
                        } else {
                            0
                        }
                    } else {
                        0
                    };
                    let resp = serde_json::json!({
                        "totalSessions": total_sessions,
                        "totalMessages": total_messages,
                        "totalFacts": total_facts,
                        "activeDays": created_dates.len(),
                    });
                    tiny_http::Response::from_string(resp.to_string()).with_header(json_header())
                }

                // API: 添加事实
                ("POST", "/api/memory/add-fact") => {
                    let body = read_body(&mut request);
                    let memory_path = data_dir.join("memory.json");
                    let mut memory: serde_json::Value = if memory_path.exists() {
                        serde_json::from_str(&fs::read_to_string(&memory_path).unwrap_or_default())
                            .unwrap_or(serde_json::json!({"rules":[],"facts":[]}))
                    } else {
                        serde_json::json!({"rules":[],"facts":[]})
                    };
                    if let Ok(payload) = serde_json::from_str::<serde_json::Value>(&body) {
                        let content = payload["content"].as_str().unwrap_or("");
                        let importance = payload["importance"].as_f64().unwrap_or(0.5);
                        if !content.is_empty() {
                            let now_ms = SystemTime::now()
                                .duration_since(UNIX_EPOCH)
                                .unwrap_or_default()
                                .as_millis();
                            let empty_facts = &mut vec![];
                            let facts = memory["facts"].as_array_mut().unwrap_or(empty_facts);
                            facts.push(serde_json::json!({
                                "id": format!("fact_{}", now_ms),
                                "content": content,
                                "importance": importance,
                                "timestamp": now_ms.to_string(),
                                "type": "fact"
                            }));
                            let _ = fs::write(&memory_path, memory.to_string());
                        }
                    }
                    emit_memory_update(&app, &data_dir);
                    tiny_http::Response::from_string("{\"ok\":true}").with_header(json_header())
                }

                // API: 删除事实
                ("POST", "/api/memory/remove-fact") => {
                    let body = read_body(&mut request);
                    let memory_path = data_dir.join("memory.json");
                    if let Ok(mut memory) = serde_json::from_str::<serde_json::Value>(
                        &fs::read_to_string(&memory_path).unwrap_or_default(),
                    ) {
                        if let Ok(payload) = serde_json::from_str::<serde_json::Value>(&body) {
                            let id = payload["id"].as_str().unwrap_or("");
                            if let Some(facts) = memory["facts"].as_array_mut() {
                                facts.retain(|f| f["id"] != id);
                            }
                            let _ = fs::write(&memory_path, memory.to_string());
                        }
                    }
                    emit_memory_update(&app, &data_dir);
                    tiny_http::Response::from_string("{\"ok\":true}").with_header(json_header())
                }

                // API: 添加偏好
                ("POST", "/api/memory/add-preference") => {
                    let body = read_body(&mut request);
                    let memory_path = data_dir.join("memory.json");
                    let mut memory: serde_json::Value = if memory_path.exists() {
                        serde_json::from_str(&fs::read_to_string(&memory_path).unwrap_or_default())
                            .unwrap_or(serde_json::json!({"rules":[],"facts":[],"preferences":{}}))
                    } else {
                        serde_json::json!({"rules":[],"facts":[],"preferences":{}})
                    };
                    if let Ok(payload) = serde_json::from_str::<serde_json::Value>(&body) {
                        let key = payload["key"].as_str().unwrap_or("");
                        let value = &payload["value"];
                        if !key.is_empty() {
                            if memory["preferences"].is_null() {
                                memory["preferences"] = serde_json::json!({});
                            }
                            memory["preferences"][key] = value.clone();
                            let _ = fs::write(&memory_path, memory.to_string());
                        }
                    }
                    emit_memory_update(&app, &data_dir);
                    tiny_http::Response::from_string("{\"ok\":true}").with_header(json_header())
                }

                // API: 删除偏好
                ("POST", "/api/memory/remove-preference") => {
                    let body = read_body(&mut request);
                    let memory_path = data_dir.join("memory.json");
                    if let Ok(mut memory) = serde_json::from_str::<serde_json::Value>(
                        &fs::read_to_string(&memory_path).unwrap_or_default(),
                    ) {
                        if let Ok(payload) = serde_json::from_str::<serde_json::Value>(&body) {
                            let key = payload["key"].as_str().unwrap_or("");
                            if !key.is_empty() {
                                memory["preferences"].as_object_mut().map(|o| o.remove(key));
                                let _ = fs::write(&memory_path, memory.to_string());
                            }
                        }
                    }
                    emit_memory_update(&app, &data_dir);
                    tiny_http::Response::from_string("{\"ok\":true}").with_header(json_header())
                }

                // API: 清空全部记忆
                ("POST", "/api/memory/clear") => {
                    let memory_path = data_dir.join("memory.json");
                    let _ = fs::write(
                        &memory_path,
                        serde_json::json!({"rules":[],"facts":[],"preferences":{}}).to_string(),
                    );
                    emit_memory_update(&app, &data_dir);
                    tiny_http::Response::from_string("{\"ok\":true}").with_header(json_header())
                }

                // API: 创建会话
                ("POST", "/api/session/create") => {
                    let sessions_path = data_dir.join("chat_sessions.json");
                    let mut data: serde_json::Value = if sessions_path.exists() {
                        serde_json::from_str(
                            &fs::read_to_string(&sessions_path).unwrap_or_default(),
                        )
                        .unwrap_or(serde_json::json!({"sessions":[]}))
                    } else {
                        serde_json::json!({"sessions":[]})
                    };
                    let now_ms = SystemTime::now()
                        .duration_since(UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_millis();
                    let session_id =
                        format!("session_{}_{}", now_ms, &format!("{:06}", now_ms % 1000000));
                    let session = serde_json::json!({
                        "id": session_id,
                        "title": "新对话",
                        "messages": [],
                        "createdAt": now_ms,
                        "updatedAt": now_ms,
                    });
                    if let Some(sessions) = data["sessions"].as_array_mut() {
                        sessions.push(session);
                    }
                    let _ = fs::write(&sessions_path, data.to_string());
                    let _ = append_log(&data_dir, "info", &format!("创建新会话: {}", session_id));
                    let _ = app.emit("admin-sessions-update", ());
                    tiny_http::Response::from_string("{\"ok\":true}").with_header(json_header())
                }

                // API: 重命名会话
                ("POST", "/api/session/rename") => {
                    let body = read_body(&mut request);
                    let sessions_path = data_dir.join("chat_sessions.json");
                    if let Ok(mut data) = serde_json::from_str::<serde_json::Value>(
                        &fs::read_to_string(&sessions_path).unwrap_or_default(),
                    ) {
                        if let Ok(payload) = serde_json::from_str::<serde_json::Value>(&body) {
                            let id = payload["id"].as_str().unwrap_or("");
                            let title = payload["title"].as_str().unwrap_or("新对话");
                            if let Some(sessions) = data["sessions"].as_array_mut() {
                                for s in sessions.iter_mut() {
                                    if s["id"] == id {
                                        s["title"] = serde_json::json!(title);
                                        break;
                                    }
                                }
                            }
                            let _ = fs::write(&sessions_path, data.to_string());
                        }
                    }
                    let _ = app.emit("admin-sessions-update", ());
                    tiny_http::Response::from_string("{\"ok\":true}").with_header(json_header())
                }

                // API: 测试连接
                ("POST", "/api/settings/test") => {
                    let body = read_body(&mut request);
                    if let Ok(payload) = serde_json::from_str::<serde_json::Value>(&body) {
                        let api_url = payload["apiUrl"]
                            .as_str()
                            .unwrap_or("https://api.openai.com/v1");
                        let api_key = payload["apiKey"].as_str().unwrap_or("");
                        let model = payload["model"].as_str().unwrap_or("gpt-3.5-turbo");
                        let base = api_url.trim_end_matches('/');

                        // 自动检测 API 格式：URL 含 "anthropic" → Anthropic 格式，否则 → OpenAI 格式
                        let is_anthropic = base.to_lowercase().contains("anthropic");

                        let (chat_url, req_body, auth_args): (String, String, Vec<String>) =
                            if is_anthropic {
                                // Anthropic 格式：x-api-key 认证，/messages 端点
                                let url = if base.ends_with("/messages") {
                                    base.to_string()
                                } else {
                                    format!("{}/messages", base)
                                };
                                let body = serde_json::json!({
                                    "model": model,
                                    "max_tokens": 1,
                                    "messages": [{"role":"user","content":"hi"}],
                                })
                                .to_string();
                                let auth = vec![
                                    "-H".to_string(),
                                    format!("x-api-key: {}", api_key),
                                    "-H".to_string(),
                                    "anthropic-version: 2023-06-01".to_string(),
                                ];
                                (url, body, auth)
                            } else {
                                // OpenAI 格式：Bearer 认证，/chat/completions 端点
                                let url = if base.ends_with("/chat/completions") {
                                    base.to_string()
                                } else {
                                    format!("{}/chat/completions", base)
                                };
                                let body = serde_json::json!({
                                    "model": model,
                                    "messages": [{"role":"user","content":"hi"}],
                                    "max_tokens": 1,
                                })
                                .to_string();
                                let auth = vec![
                                    "-H".to_string(),
                                    format!("Authorization: Bearer {}", api_key),
                                ];
                                (url, body, auth)
                            };

                        let fmt_name = if is_anthropic { "Anthropic" } else { "OpenAI" };
                        let mut args = vec![
                            "-s".to_string(),
                            "-w".to_string(),
                            "\n%{http_code}".to_string(),
                            "--max-time".to_string(),
                            "15".to_string(),
                            "-X".to_string(),
                            "POST".to_string(),
                            chat_url.clone(),
                            "-H".to_string(),
                            "Content-Type: application/json".to_string(),
                        ];
                        args.extend(auth_args);
                        args.push("-d".to_string());
                        args.push(req_body.clone());

                        match std::process::Command::new("curl").args(&args).output() {
                            Ok(output) => {
                                let raw = String::from_utf8_lossy(&output.stdout).to_string();
                                let lines: Vec<&str> = raw.lines().collect();
                                let code = lines.last().unwrap_or(&"000").trim();
                                let resp_body = lines[..lines.len().saturating_sub(1)].join("\n");
                                if code.starts_with('2') {
                                    let _ = append_log(&data_dir, "info", &format!("API 连接成功 [{}]: {} (HTTP {})", fmt_name, model, code));
                                    tiny_http::Response::from_string(serde_json::json!({"ok":true,"model":model,"status":code,"apiFormat":fmt_name}).to_string()).with_header(json_header())
                                } else {
                                    let error_msg = if let Ok(v) = serde_json::from_str::<serde_json::Value>(&resp_body) {
                                        v["error"]["message"].as_str().or_else(|| v["error"]["type"].as_str()).unwrap_or("").to_string()
                                    } else { String::new() };
                                    let detail = if error_msg.is_empty() { format!("HTTP {}", code) } else { format!("HTTP {} — {}", code, error_msg) };
                                    let _ = append_log(&data_dir, "warn", &format!("API 测试失败 [{}]: {} ({})", fmt_name, detail, chat_url));
                                    tiny_http::Response::from_string(serde_json::json!({"ok":false,"error":detail,"url":chat_url,"apiFormat":fmt_name}).to_string()).with_header(json_header())
                                }
                            }
                            Err(e) => {
                                tiny_http::Response::from_string(serde_json::json!({"ok":false,"error":format!("curl 不可用: {}", e)}).to_string()).with_header(json_header())
                            }
                        }
                    } else {
                        tiny_http::Response::from_string(
                            serde_json::json!({"ok":false,"error":"请求格式错误"}).to_string(),
                        )
                        .with_header(json_header())
                    }
                }

                // API: 模型配置
                ("GET", "/api/model-config") => {
                    // 优先从数据目录读取（宠物应用启动时同步）
                    let config_path = data_dir.join("model-config.json");
                    let response_content = if config_path.exists() {
                        fs::read_to_string(&config_path).unwrap_or_else(|_| "{}".to_string())
                    } else {
                        // 回退：尝试从 public 目录读取
                        let possible_paths = vec![
                            std::path::PathBuf::from("desk-pet/public/models/nahida/config.json"),
                            std::path::PathBuf::from("public/models/nahida/config.json"),
                        ];
                        let mut found = "{}".to_string();
                        for p in &possible_paths {
                            if p.exists() {
                                if let Ok(content) = fs::read_to_string(p) {
                                    found = content;
                                    break;
                                }
                            }
                        }
                        found
                    };
                    tiny_http::Response::from_string(response_content).with_header(json_header())
                }

                // API: 获取日志
                ("GET", "/api/logs") => {
                    let logs = read_logs(&data_dir);
                    tiny_http::Response::from_string(serde_json::json!({"logs":logs}).to_string())
                        .with_header(json_header())
                }

                // API: 前端推送日志（error/warn 级别自动转发到后端）
                ("POST", "/api/log") => {
                    let body = read_body(&mut request);
                    if let Ok(payload) = serde_json::from_str::<serde_json::Value>(&body) {
                        let level = payload["level"].as_str().unwrap_or("info");
                        let source = payload["source"].as_str().unwrap_or("webview");
                        let message = payload["message"].as_str().unwrap_or("");
                        let _ = append_log(
                            &data_dir,
                            level,
                            &format!("[webview:{}] {}", source, message),
                        );
                    }
                    tiny_http::Response::from_string("{\"ok\":true}").with_header(json_header())
                }

                // API: 清空日志
                ("POST", "/api/logs/clear") => {
                    let log_path = data_dir.join("logs.json");
                    let _ = fs::write(&log_path, "[]");
                    tiny_http::Response::from_string("{\"ok\":true}").with_header(json_header())
                }

                // API: 预览表情（临时切换 Live2D 表情）
                ("POST", "/api/preview-expression") => {
                    let body = read_body(&mut request);
                    if let Ok(payload) = serde_json::from_str::<serde_json::Value>(&body) {
                        if let Some(expr) = payload.get("expression").and_then(|v| v.as_str()) {
                            let _ = app.emit("admin-preview-expression", expr.to_string());
                        }
                    }
                    tiny_http::Response::from_string("{\"ok\":true}").with_header(json_header())
                }

                // API: 偏好读取
                ("GET", "/api/preferences") => {
                    let path = data_dir.join("preferences.json");
                    let content = if path.exists() {
                        fs::read_to_string(&path).unwrap_or_default()
                    } else {
                        "{}".into()
                    };
                    tiny_http::Response::from_string(content).with_header(json_header())
                }

                // API: 偏好保存
                ("POST", "/api/preferences/save") => {
                    let mut body = String::new();
                    let _ = request.as_reader().read_to_string(&mut body);
                    let path = data_dir.join("preferences.json");
                    let _ = fs::write(&path, &body);
                    tiny_http::Response::from_string("{\"ok\":true}").with_header(json_header())
                }

                // API: Provider 列表
                ("GET", "/api/providers") => {
                    let providers_raw =
                        read_secure_file("providers").unwrap_or_else(|_| String::new());
                    let content = if !providers_raw.is_empty() {
                        providers_raw
                    } else {
                        // 尝试从旧 settings 迁移
                        let settings_raw =
                            read_secure_file("settings").unwrap_or_else(|_| String::new());
                        if !settings_raw.is_empty() {
                            if let Ok(settings) =
                                serde_json::from_str::<serde_json::Value>(&settings_raw)
                            {
                                if let Some(api_url) = settings["apiUrl"].as_str() {
                                    if !api_url.is_empty() {
                                        let migrated = serde_json::json!({
                                            "configs": [{
                                                "id": "default-openai",
                                                "type": "chat",
                                                "typeName": "openai_chat",
                                                "name": "OpenAI 兼容接口",
                                                "enable": true,
                                                "apiKey": settings["apiKey"].as_str().unwrap_or(""),
                                                "apiBase": api_url,
                                                "model": settings["model"].as_str().unwrap_or("gpt-3.5-turbo"),
                                                "systemPrompt": settings["systemPrompt"].as_str().unwrap_or(""),
                                                "enableThinkTags": settings["enableThinkTags"].as_bool().unwrap_or(false),
                                                "enableSmartChat": settings["enableSmartChat"].as_bool().unwrap_or(false)
                                            }],
                                            "activeChatId": "default-openai",
                                            "activeTTSId": null,
                                            "activeSTTId": null,
                                            "voice": {
                                                "ttsEnabled": false,
                                                "ttsAutoPlay": true,
                                                "ttsLipSync": false,
                                                "ttsVolume": 0.8,
                                                "sttEnabled": false,
                                                "sttEmotionLink": true,
                                                "sttLanguage": "zh"
                                            }
                                        });
                                        let _ =
                                            write_secure_file("providers", &migrated.to_string());
                                        migrated.to_string()
                                    } else {
                                        default_providers_json()
                                    }
                                } else {
                                    default_providers_json()
                                }
                            } else {
                                default_providers_json()
                            }
                        } else {
                            default_providers_json()
                        }
                    };
                    tiny_http::Response::from_string(content).with_header(json_header())
                }

                // API: Provider 保存（全量覆盖）
                ("POST", "/api/providers/save") => {
                    let body = read_body(&mut request);
                    let _path = data_dir.join("providers.json");
                    // 确保 voice 字段始终存在（Providers 页面操作可能不携带 voice，导致设置丢失）
                    if let Ok(mut v) = serde_json::from_str::<serde_json::Value>(&body) {
                        if v.get("voice").is_none() {
                            v["voice"] = serde_json::json!({
                                "ttsEnabled": false,
                                "ttsAutoPlay": true,
                                "ttsLipSync": false,
                                "ttsVolume": 0.8,
                                "sttEnabled": false,
                                "sttEmotionLink": true,
                                "sttLanguage": "zh"
                            });
                        }
                        // 反向同步：将活跃 Chat Provider 的配置写入 settings.json
                        sync_providers_to_settings(&data_dir, &v);
                        let out = v.to_string();
                        let _ = write_secure_file("providers", &out);
                        let _ = app.emit("admin-providers-update", v);
                    } else {
                        let _ = write_secure_file("providers", &body);
                    }
                    let _ = append_log(&data_dir, "info", "Provider 配置已保存");
                    tiny_http::Response::from_string("{\"ok\":true}").with_header(json_header())
                }

                // API: 获取会话级 Provider 覆盖
                (method, url)
                    if method == "GET"
                        && url.starts_with("/api/session/")
                        && url.ends_with("/provider") =>
                {
                    let parts: Vec<&str> = url.split('/').collect();
                    let session_id = parts[3]; // /api/session/{id}/provider
                    let content: String = {
                        let providers_raw =
                            read_secure_file("providers").unwrap_or_else(|_| String::new());
                        if let Ok(providers) =
                            serde_json::from_str::<serde_json::Value>(&providers_raw)
                        {
                            let overrides = &providers["sessionOverrides"][session_id];
                            serde_json::json!({
                                "chatId": overrides["chatId"].as_str(),
                                "ttsId": overrides["ttsId"].as_str(),
                                "sttId": overrides["sttId"].as_str(),
                                "perceptionId": overrides["perceptionId"].as_str(),
                            })
                            .to_string()
                        } else {
                            "{}".to_string()
                        }
                    };
                    tiny_http::Response::from_string(content).with_header(json_header())
                }

                // API: 设置会话级 Provider 覆盖
                (method, url)
                    if method == "POST"
                        && url.starts_with("/api/session/")
                        && url.ends_with("/provider") =>
                {
                    let parts: Vec<&str> = url.split('/').collect();
                    let session_id = parts[3]; // /api/session/{id}/provider
                    let body = read_body(&mut request);
                    let payload: serde_json::Value =
                        serde_json::from_str(&body).unwrap_or(serde_json::json!({}));
                    let ptype = payload["type"].as_str().unwrap_or("chat");
                    let provider_id = payload["providerId"].as_str(); // null = 清除覆盖

                    let mut providers: serde_json::Value = serde_json::from_str(
                        &read_secure_file("providers").unwrap_or_default()
                    ).unwrap_or(serde_json::json!({"configs":[],"activeChatId":null,"activeTTSId":null,"activeSTTId":null,"sessionOverrides":{}}));

                    // 确保 sessionOverrides 对象存在
                    if providers["sessionOverrides"].as_object().is_none() {
                        providers["sessionOverrides"] = serde_json::json!({});
                    }

                    let key = match ptype {
                        "tts" => "ttsId",
                        "stt" => "sttId",
                        "perception" => "perceptionId",
                        _ => "chatId",
                    };

                    if let Some(pid) = provider_id {
                        // 设置覆盖
                        if providers["sessionOverrides"][session_id]
                            .as_object()
                            .is_none()
                        {
                            providers["sessionOverrides"][session_id] = serde_json::json!({});
                        }
                        providers["sessionOverrides"][session_id][key] = serde_json::json!(pid);
                    } else {
                        // 清除覆盖
                        if let Some(obj) = providers["sessionOverrides"][session_id].as_object_mut()
                        {
                            obj.remove(key);
                            if obj.is_empty() {
                                if let Some(overrides) =
                                    providers["sessionOverrides"].as_object_mut()
                                {
                                    overrides.remove(session_id);
                                }
                            }
                        }
                    }

                    let _ = write_secure_file("providers", &providers.to_string());
                    if let Ok(payload) =
                        serde_json::from_str::<serde_json::Value>(&providers.to_string())
                    {
                        let _ = app.emit("admin-providers-update", payload);
                    }
                    tiny_http::Response::from_string("{\"ok\":true}").with_header(json_header())
                }

                // API: Provider 测试连接
                ("POST", "/api/providers/test") => {
                    let body = read_body(&mut request);
                    let result: serde_json::Value = {
                        let payload: serde_json::Value =
                            serde_json::from_str(&body).unwrap_or(serde_json::json!({}));
                        let ptype = payload["type"].as_str().unwrap_or("chat");
                        let api_base = payload["apiBase"].as_str().unwrap_or("");

                        match ptype {
                            "chat" => {
                                let api_key = payload["apiKey"].as_str().unwrap_or("");
                                let model = payload["model"].as_str().unwrap_or("gpt-3.5-turbo");
                                let url =
                                    format!("{}/chat/completions", api_base.trim_end_matches('/'));
                                let req_body = serde_json::json!({
                                    "model": model,
                                    "messages": [{"role":"user","content":"hi"}],
                                    "max_tokens": 1,
                                })
                                .to_string();
                                let mut cmd = std::process::Command::new("curl");
                                cmd.args([
                                    "-s",
                                    "-w",
                                    "\n%{http_code}",
                                    "--max-time",
                                    "15",
                                    "-X",
                                    "POST",
                                    &url,
                                    "-H",
                                    "Content-Type: application/json",
                                    "-d",
                                    &req_body,
                                ]);
                                if !api_key.is_empty() {
                                    cmd.arg("-H");
                                    cmd.arg(format!("Authorization: Bearer {}", api_key));
                                }
                                match cmd.output() {
                                    Ok(output) => {
                                        let raw = String::from_utf8_lossy(&output.stdout);
                                        let lines: Vec<&str> = raw.lines().collect();
                                        let code = lines.last().unwrap_or(&"000").trim();
                                        if code.starts_with('2') {
                                            serde_json::json!({"ok":true,"message":format!("连接成功 (HTTP {})", code)})
                                        } else {
                                            serde_json::json!({"ok":false,"error":format!("HTTP {}", code)})
                                        }
                                    }
                                    Err(e) => serde_json::json!({"ok":false,"error":e.to_string()}),
                                }
                            }
                            "tts" | "stt" => {
                                // 先试 /docs（FastAPI 内置端点，所有服务统一返回 200），再试根路径
                                // 只有 2xx 算成功，4xx/5xx 如实报告
                                let base = api_base.trim_end_matches('/');
                                let urls_to_try = [format!("{}/docs", base), base.to_string()];
                                let mut final_code = String::from("000");
                                let mut final_stderr = String::new();
                                let mut final_exit_ok = false;

                                for url in &urls_to_try {
                                    let curl_output = std::process::Command::new("curl")
                                        .args([
                                            "-s",
                                            "-S",
                                            "-o",
                                            "NUL",
                                            "-w",
                                            "%{http_code}",
                                            "--max-time",
                                            "5",
                                            url,
                                        ])
                                        .output();
                                    match curl_output {
                                        Ok(output) => {
                                            let code = String::from_utf8_lossy(&output.stdout)
                                                .trim()
                                                .to_string();
                                            let stderr_info =
                                                String::from_utf8_lossy(&output.stderr)
                                                    .trim()
                                                    .to_string();
                                            let exit_ok = output.status.success();
                                            final_code = code.clone();
                                            final_stderr = stderr_info;
                                            final_exit_ok = exit_ok;
                                            // 2xx = 真成功，直接返回
                                            if code.starts_with('2') && exit_ok {
                                                break;
                                            }
                                        }
                                        Err(_) => {
                                            final_code = String::from("ERR");
                                            final_exit_ok = false;
                                        }
                                    }
                                }

                                if final_code.starts_with('2') && final_exit_ok {
                                    let _ = append_log(
                                        &data_dir,
                                        "info",
                                        &format!(
                                            "Provider 测试 [{}] 成功: {} (HTTP {})",
                                            ptype, base, final_code
                                        ),
                                    );
                                    serde_json::json!({"ok":true,"message":format!("服务可达 (HTTP {})", final_code), "url": base})
                                } else {
                                    let detail = if !final_stderr.is_empty() {
                                        final_stderr
                                            .lines()
                                            .next()
                                            .unwrap_or("连接失败")
                                            .to_string()
                                    } else {
                                        format!("无响应 (HTTP {})", final_code)
                                    };
                                    let _ = append_log(
                                        &data_dir,
                                        "warn",
                                        &format!(
                                            "Provider 测试 [{}] 失败: {} — {}",
                                            ptype, base, detail
                                        ),
                                    );
                                    serde_json::json!({"ok":false,"error":format!("{} — {}", detail, base), "url": base})
                                }
                            }
                            "perception" => {
                                // WebSocket 服务，使用 TCP 端口检测
                                let base = api_base.trim_end_matches('/');
                                let port = if let Some(port_str) = base.split(':').next_back() {
                                    port_str.parse::<u16>().unwrap_or(8765)
                                } else {
                                    8765
                                };
                                let addr = format!("127.0.0.1:{}", port);
                                match std::net::TcpStream::connect_timeout(
                                    &addr.parse().unwrap(),
                                    std::time::Duration::from_secs(5),
                                ) {
                                    Ok(_) => {
                                        let _ = append_log(
                                            &data_dir,
                                            "info",
                                            &format!(
                                                "Provider 测试 [{}] 成功: 端口 {} 可达",
                                                ptype, port
                                            ),
                                        );
                                        serde_json::json!({"ok":true,"message":format!("服务可达 (端口 {})", port), "url": base})
                                    }
                                    Err(e) => {
                                        let _ = append_log(
                                            &data_dir,
                                            "warn",
                                            &format!(
                                                "Provider 测试 [{}] 失败: 端口 {} — {}",
                                                ptype, port, e
                                            ),
                                        );
                                        serde_json::json!({"ok":false,"error":format!("端口不可达 — {}", e), "url": base})
                                    }
                                }
                            }
                            _ => serde_json::json!({"ok":false,"error":"unknown type"}),
                        }
                    };
                    tiny_http::Response::from_string(result.to_string()).with_header(json_header())
                }

                // API: 启动服务
                ("POST", "/api/service/start") => {
                    let body = read_body(&mut request);
                    let payload: serde_json::Value =
                        serde_json::from_str(&body).unwrap_or(serde_json::json!({}));
                    let id = payload["id"].as_str().unwrap_or("").to_string();
                    let command = payload["command"].as_str().unwrap_or("").to_string();
                    let args: Vec<String> = payload["args"]
                        .as_array()
                        .map(|a| {
                            a.iter()
                                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                                .collect()
                        })
                        .unwrap_or_default();
                    let port = payload["port"].as_u64().unwrap_or(0) as u16;

                    // 解析工作目录：相对路径基于应用根目录
                    let app_root = crate::backend::backend_root(&app);
                    let raw_work_dir = payload["workDir"].as_str().unwrap_or("").to_string();
                    let work_dir = if raw_work_dir.is_empty() || raw_work_dir == "." {
                        app_root.to_string_lossy().to_string()
                    } else if raw_work_dir.starts_with('.') || raw_work_dir.starts_with("..") {
                        app_root.join(&raw_work_dir).to_string_lossy().to_string()
                    } else {
                        raw_work_dir
                    };

                    // 解析命令路径：相对路径（含分隔符）基于 workDir 解析
                    let resolved_command = if command.contains('/') || command.contains('\\') {
                        std::path::Path::new(&work_dir)
                            .join(&command)
                            .to_string_lossy()
                            .to_string()
                    } else {
                        command.clone()
                    };

                    if id.is_empty() || command.is_empty() {
                        tiny_http::Response::from_string(
                            "{\"ok\":false,\"error\":\"缺少 id 或 command\"}",
                        )
                        .with_header(json_header())
                    } else {
                        let result = service::service_start_raw(
                            &resolved_command,
                            &args,
                            &work_dir,
                            port,
                            &app,
                        );
                        match result {
                            Ok(info) => tiny_http::Response::from_string(
                                serde_json::json!({"ok":true, "info": info}).to_string(),
                            )
                            .with_header(json_header()),
                            Err(e) => tiny_http::Response::from_string(
                                serde_json::json!({"ok":false, "error": e}).to_string(),
                            )
                            .with_header(json_header()),
                        }
                    }
                }

                // API: 停止服务
                ("POST", "/api/service/stop") => {
                    let body = read_body(&mut request);
                    let payload: serde_json::Value =
                        serde_json::from_str(&body).unwrap_or(serde_json::json!({}));
                    let id = payload["id"].as_str().unwrap_or("").to_string();

                    let manager = app.state::<service::ServiceManager>();
                    let _ = service::service_stop_by_id(&manager, &id);
                    tiny_http::Response::from_string("{\"ok\":true}").with_header(json_header())
                }

                // API: 查询服务状态
                ("GET", "/api/service/status") => {
                    let url_str = request.url().to_string();
                    let id = url_str
                        .split('?')
                        .nth(1)
                        .and_then(|q| q.split('=').nth(1))
                        .unwrap_or("");

                    let manager = app.state::<service::ServiceManager>();
                    let info = service::service_get_status(&manager, id.to_string());
                    tiny_http::Response::from_string(
                        serde_json::json!({"ok":true, "info": info}).to_string(),
                    )
                    .with_header(json_header())
                }

                // API: 列出所有运行中的服务
                ("GET", "/api/service/list") => {
                    let manager = app.state::<service::ServiceManager>();
                    let mut list = service::service_list_all(&manager);
                    // 额外检测已配置 Provider 的端口（捕获外部启动的服务）
                    if let Ok(content) = read_secure_file("providers") {
                        if let Ok(providers) = serde_json::from_str::<serde_json::Value>(&content) {
                            if let Some(configs) = providers["configs"].as_array() {
                                for cfg in configs {
                                    if let Some(port_val) = cfg["port"].as_u64() {
                                        let port = port_val as u16;
                                        let id = format!("service_{}", port);
                                        // 仅检测不在托管列表中的端口
                                        if !list.iter().any(|s| s.id == id) {
                                            // 用 HTTP 健康检查（含 TCP 检测 + HTTP GET /health）
                                            if service::check_http_health(port) {
                                                list.push(service::ServiceInfo {
                                                    id,
                                                    status: service::ServiceStatus::Running,
                                                    port,
                                                    error: String::new(),
                                                });
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                    tiny_http::Response::from_string(
                        serde_json::json!({"ok":true, "services": list}).to_string(),
                    )
                    .with_header(json_header())
                }

                // 静态资源：提供 Vite 构建产物（JS/CSS/字体等）
                (method, url) if method == "GET" && url.starts_with("/assets/") => {
                    let file_name = url.trim_start_matches('/');
                    // 防止路径穿越：拒绝包含 ".." 的请求
                    if file_name.contains("..") {
                        tiny_http::Response::from_string("{\"error\":\"invalid path\"}")
                            .with_status_code(400)
                    } else {
                        let dist_dir = app
                            .path()
                            .resource_dir()
                            .map(|r| r.join("dist"))
                            .unwrap_or_else(|_| {
                                std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                                    .join("..")
                                    .join("dist")
                            });
                        let file_path = dist_dir.join(file_name);
                        // 规范化路径校验，确保最终路径仍在 dist 目录内
                        let canonical_dist = dist_dir.canonicalize().unwrap_or(dist_dir.clone());
                        let canonical_file = file_path.canonicalize().unwrap_or(file_path.clone());
                        if canonical_file.starts_with(&canonical_dist) && file_path.exists() {
                            let content = fs::read(&file_path).unwrap_or_default();
                            let mime = if file_name.ends_with(".js") {
                                "application/javascript; charset=utf-8"
                            } else if file_name.ends_with(".css") {
                                "text/css; charset=utf-8"
                            } else if file_name.ends_with(".woff2") {
                                "font/woff2"
                            } else if file_name.ends_with(".woff") {
                                "font/woff"
                            } else if file_name.ends_with(".svg") {
                                "image/svg+xml"
                            } else if file_name.ends_with(".json") {
                                "application/json"
                            } else {
                                "application/octet-stream"
                            };
                            let ct = parse_content_type(mime);
                            let response = tiny_http::Response::from_data(content).with_header(ct);
                            let _ = request.respond(response.with_header(cors_header()));
                            continue;
                        }
                        tiny_http::Response::from_string("{\"error\":\"asset not found\"}")
                            .with_status_code(404)
                    }
                }

                // API: 获取内容安全配置
                ("GET", "/api/settings/safety") => {
                    let content: serde_json::Value =
                        serde_json::from_str(&read_secure_file("settings").unwrap_or_default())
                            .unwrap_or(serde_json::json!({}));
                    let safety = content.get("contentSafety").cloned().unwrap_or(
                        serde_json::json!({
                            "enabled": false,
                            "checkResponse": false,
                            "keywords": {"enabled": true, "patterns": []},
                            "lengthLimit": {"enabled": true, "maxLength": 4096},
                            "rateLimit": {"enabled": true, "maxMessages": 20, "windowSeconds": 60}
                        }),
                    );
                    tiny_http::Response::from_string(safety.to_string()).with_header(json_header())
                }

                // API: 保存内容安全配置
                ("POST", "/api/settings/safety") => {
                    let body = read_body(&mut request);
                    let mut settings: serde_json::Value =
                        serde_json::from_str(&read_secure_file("settings").unwrap_or_default())
                            .unwrap_or(serde_json::json!({}));
                    if let Ok(safety) = serde_json::from_str::<serde_json::Value>(&body) {
                        settings["contentSafety"] = safety;
                    }
                    let _ = write_secure_file("settings", &settings.to_string());
                    let _ = app.emit("admin-settings-update", settings.clone());
                    let _ = append_log(&data_dir, "info", "内容安全配置已保存");
                    tiny_http::Response::from_string("{\"ok\":true}").with_header(json_header())
                }

                // ===== Persona APIs =====

                // API: 获取人设存储
                ("GET", "/api/persona") => {
                    let path = data_dir.join("persona_store.json");
                    let content = if path.exists() {
                        fs::read_to_string(&path).unwrap_or_default()
                    } else {
                        String::from("{}")
                    };
                    tiny_http::Response::from_string(content).with_header(json_header())
                }

                // API: 保存/更新人设
                ("POST", "/api/persona/profile") => {
                    let body = read_body(&mut request);
                    let path = data_dir.join("persona_store.json");
                    let mut store: serde_json::Value = if path.exists() {
                        serde_json::from_str(&fs::read_to_string(&path).unwrap_or_default())
                            .unwrap_or(serde_json::json!({}))
                    } else {
                        serde_json::json!({})
                    };
                    if let Ok(profile) = serde_json::from_str::<serde_json::Value>(&body) {
                        // 确保 profiles 数组存在
                        if store["profiles"].is_null() || !store["profiles"].is_array() {
                            store["profiles"] = serde_json::json!([]);
                        }
                        let profiles = store["profiles"]
                            .as_array_mut()
                            .expect("BUG: profiles was just initialized as array");
                        let id = profile["id"].as_str().unwrap_or("");
                        if let Some(idx) =
                            profiles.iter().position(|p| p["id"].as_str() == Some(id))
                        {
                            profiles[idx] = profile;
                        } else {
                            profiles.push(profile);
                        }
                    }
                    let _ = fs::write(&path, store.to_string());
                    let _ = app.emit("admin-persona-update", &store);
                    let _ = append_log(&data_dir, "info", "人设已保存");
                    tiny_http::Response::from_string("{\"ok\":true}").with_header(json_header())
                }

                // API: 删除人设
                (method, url) if method == "DELETE" && url.starts_with("/api/persona/profile/") => {
                    let id = url.trim_start_matches("/api/persona/profile/");
                    let path = data_dir.join("persona_store.json");
                    let mut store: serde_json::Value = if path.exists() {
                        serde_json::from_str(&fs::read_to_string(&path).unwrap_or_default())
                            .unwrap_or(serde_json::json!({}))
                    } else {
                        serde_json::json!({})
                    };
                    if let Some(profiles) = store["profiles"].as_array_mut() {
                        profiles.retain(|p| p["id"].as_str() != Some(id));
                    }
                    // 如果删除的是活跃人设，切到第一个
                    if store["activePersonaId"].as_str() == Some(id) {
                        if let Some(profiles) = store["profiles"].as_array() {
                            if let Some(first) = profiles.first() {
                                store["activePersonaId"] = first["id"].clone();
                            }
                        }
                    }
                    let _ = fs::write(&path, store.to_string());
                    let _ = app.emit("admin-persona-update", &store);
                    let _ = append_log(&data_dir, "info", &format!("人设 {} 已删除", id));
                    tiny_http::Response::from_string("{\"ok\":true}").with_header(json_header())
                }

                // API: 设置活跃人设
                ("POST", "/api/persona/active") => {
                    let body = read_body(&mut request);
                    let path = data_dir.join("persona_store.json");
                    let mut store: serde_json::Value = if path.exists() {
                        serde_json::from_str(&fs::read_to_string(&path).unwrap_or_default())
                            .unwrap_or(serde_json::json!({}))
                    } else {
                        serde_json::json!({})
                    };
                    if let Ok(payload) = serde_json::from_str::<serde_json::Value>(&body) {
                        if let Some(id) = payload["id"].as_str() {
                            store["activePersonaId"] = serde_json::json!(id);
                        }
                    }
                    let _ = fs::write(&path, store.to_string());
                    let _ = app.emit("admin-persona-update", &store);
                    tiny_http::Response::from_string("{\"ok\":true}").with_header(json_header())
                }

                // API: 恢复预设人设
                ("POST", "/api/persona/restore-presets") => {
                    // 通知前端处理（预设数据在前端维护）
                    let _ = app.emit("admin-persona-restore-presets", &serde_json::json!({}));
                    let _ = append_log(&data_dir, "info", "预设人设已恢复");
                    tiny_http::Response::from_string("{\"ok\":true}").with_header(json_header())
                }

                // API: 检查文件是否存在（仅允许项目目录内的相对路径）
                ("POST", "/api/file/exists") => {
                    let body = read_body(&mut request);
                    let payload: serde_json::Value =
                        serde_json::from_str(&body).unwrap_or(serde_json::json!({}));
                    let file_path = payload["path"].as_str().unwrap_or("");
                    // 拒绝绝对路径和路径穿越，仅允许项目内相对路径
                    let is_absolute = file_path.starts_with('/')
                        || (file_path.len() > 1 && &file_path[1..2] == ":");
                    let has_traversal = file_path.contains("..");
                    let exists = if is_absolute || has_traversal || file_path.is_empty() {
                        false
                    } else {
                        let app_root = crate::backend::backend_root(&app);
                        let abs_path = app_root.join(file_path);
                        let canonical_root = app_root.canonicalize().unwrap_or(app_root.clone());
                        let canonical_path = abs_path.canonicalize().unwrap_or(abs_path.clone());
                        canonical_path.starts_with(&canonical_root) && abs_path.exists()
                    };
                    tiny_http::Response::from_string(
                        serde_json::json!({"ok":true, "exists": exists}).to_string(),
                    )
                    .with_header(json_header())
                }

                // API: 批量检查 GPT-SoVITS 模型文件
                ("POST", "/api/models/check-gptsovits") => {
                    let app_root = crate::backend::backend_root(&app);
                    let server_root = app_root.join("server");
                    let models: serde_json::Value = {
                        let check = |rel: &str| -> bool {
                            server_root.join("gpt_sovits").join(rel).exists()
                        };
                        serde_json::json!({
                            "gpt_model": check("GPT_weights_v2Pro/nahida-e15.ckpt"),
                            "sovits_model": check("SoVITS_weights_v2/nahida_e8_s6464.pth"),
                            "sovits_config": check("GPT_SoVITS/configs/s2.json"),
                            "bert_model": check("GPT_SoVITS/pretrained_models/chinese-roberta-wwm-ext-large/pytorch_model.bin"),
                            "hubert_model": check("GPT_SoVITS/pretrained_models/chinese-hubert-base/pytorch_model.bin"),
                            "gsv_pretrained": check("GPT_SoVITS/pretrained_models/gsv-v2final-pretrained/s2G2333k.pth") || check("GPT_SoVITS/pretrained_models/gsv-v2final-pretrained/s2D2333k.pth"),
                            "api_v2": check("api_v2.py"),
                        })
                    };
                    let all_ok = models
                        .as_object()
                        .map(|o| o.values().all(|v| v.as_bool().unwrap_or(false)))
                        .unwrap_or(false);
                    tiny_http::Response::from_string(
                        serde_json::json!({"ok":true, "all_ok": all_ok, "models": models})
                            .to_string(),
                    )
                    .with_header(json_header())
                }

                // API: 检查 Ollama 是否安装（HTTP 端点，不依赖 Tauri invoke）
                ("GET", "/api/ollama/check-installed") => {
                    let installed = std::process::Command::new("ollama")
                        .arg("--version")
                        .output()
                        .map(|o| o.status.success())
                        .unwrap_or(false);
                    tiny_http::Response::from_string(
                        serde_json::json!({"ok":true, "installed": installed}).to_string(),
                    )
                    .with_header(json_header())
                }

                // API: 查询服务日志
                // GET /api/service/logs?service_id=xxx&limit=50
                ("GET", "/api/service/logs") => {
                    let url_str = request.url().to_string();
                    let qs: std::collections::HashMap<String, String> = url_str
                        .split('?')
                        .nth(1)
                        .unwrap_or("")
                        .split('&')
                        .filter_map(|p| {
                            let mut parts = p.splitn(2, '=');
                            Some((
                                parts.next()?.to_string(),
                                parts.next().unwrap_or("").to_string(),
                            ))
                        })
                        .collect();
                    let service_id_filter = qs.get("service_id").cloned();
                    let limit: usize = qs.get("limit").and_then(|v| v.parse().ok()).unwrap_or(100);

                    let manager = app.state::<service::ServiceManager>();
                    let all_logs = manager.get_logs(limit);
                    let filtered: Vec<&service::LogEntry> = if let Some(ref sid) = service_id_filter
                    {
                        if sid.is_empty() {
                            all_logs.iter().collect()
                        } else {
                            all_logs.iter().filter(|e| e.service_id == *sid).collect()
                        }
                    } else {
                        all_logs.iter().collect()
                    };
                    tiny_http::Response::from_string(
                        serde_json::json!({"ok":true, "logs": filtered}).to_string(),
                    )
                    .with_header(json_header())
                }

                _ => tiny_http::Response::from_string("{\"error\":\"not found\"}")
                    .with_status_code(404),
            };

            let _ = request.respond(response.with_header(cors_header()));
        }
    });
}
