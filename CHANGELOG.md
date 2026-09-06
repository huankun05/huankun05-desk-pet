# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added

- **并行子 Agent（task_group）**：Work/Code 模式新增 `task_group` 内置工具，一次调用可并行委派多个互不依赖的子任务（默认并发上限 4，结果按输入顺序聚合返回）；子任务各自独立会话/checkpoint/角色租约，单个失败不影响其余
- **AGENTS.md 项目上下文**：Code（及绑定工作目录的 Work）模式启动时读取工作区根目录 AGENTS.md 注入启动 transcript，让模型看到项目级构建/测试/架构约定；超长自动截断，无文件时零侵入
- **迭代预算（IterationBudget）**：移植自 Hermes，Agent 主循环每次模型调用消耗一次迭代预算，防止死循环；父 agent 默认 90 次，子 agent 默认 50 次；程序化验证工具（run_verification）成功后退还预算
- **预算耗尽自动总结**：迭代预算耗尽时自动发起一次无工具 LLM 调用，要求模型总结已完成工作与当前进度，替代静默中断
- **文件变更失败页脚**：追踪 write_file/patch/edit_file 等文件变更工具的失败调用，若未被后续同路径成功写入覆盖，在最终回复尾部追加警告，防止模型虚报"全部修改成功"
- **跨会话搜索增强**：recall_history 工具新增 limit 参数（默认 5，最大 20）和 sessionId 过滤参数（限定搜索特定会话），每条结果增加来源会话标签；检索候选池扩大避免过滤后结果不足
- **凭据全量加密**：新增 CredentialVault（基于 Electron safeStorage / Windows DPAPI），model-settings.json 中所有 API Key 落盘时自动加密，读取时解密；旧明文配置自动兼容；safeStorage 不可用时优雅回退
- **定时任务桌面通知**：ScheduledTask 新增 deliver 字段（local/desktop），deliver=desktop 时任务完成/失败后自动弹桌面通知（成功显示结果预览，失败显示错误信息）
- **成本核算**：新增 model-pricing（30+ 常见模型默认单价，支持自定义覆盖）和 cost-calculator（input/output/cacheHit/cacheCreation 四档成本计算，按天/按模型汇总，智能格式化输出）
- **Trajectory 导出**：新增 trajectory-exporter，将聊天会话导出为 JSONL 格式（含 session 元数据/turn 内容/工具调用与结果/token 用量），支持敏感信息脱敏和按会话/模式/时间范围筛选
- **工具重复失败检测（护栏）**：移植自 Hermes tool_guardrails，新增 ToolCallGuardrailController，每轮重置计数；三类检测：相同工具+相同参数失败 3 次后 block、同一工具失败 5 次后 halt、只读工具相同结果 3 次后 block（无进展）；warn 去重，成功后清除失败记录
- **execute_code 独立代码执行工具**：新增 execute_code 工具，支持 Python / Node.js / Shell 三种语言；薄封装 run_shell（写入临时文件 → 构建运行时命令 → 调用 run_shell → 清理临时文件），完全复用沙箱/双计时器/进程树终止/权限档位等安全逻辑；运行时不存在时返回 RUNTIME_NOT_FOUND + 友好提示
- **后台 LLM 审查**：新增 llm-reviewer 模块（prompt 构建 + 结果解析 + 审查执行 + 持久化，LLM 调用抽象为 LLMCallFn 不依赖具体 model client）；harness-adapter 新增 setLLMReviewCallback 可注入回调，Run 结束后异步触发 LLM 审查（默认不启用，保持可逆性）；审查结果包含质量评分/安全问题/潜在 bug/改进建议，持久化到 llm-review.json
- **文件安全黑名单**：移植自 Hermes file_safety，新增 file-safety 模块（精确敏感路径+目录前缀+读取拒绝，适配 Windows，纯函数可测试）；fs-tools read_file/write_file 集成安全检查，阻止 Agent 误写/误读 SSH 私钥、.env、凭据文件等敏感文件（防御性深度，非安全边界）
- **流式思维链清理**：移植自 Hermes think_scrubber，新增 StreamingThinkScrubber 状态机（部分标签跨 delta 暂存+块边界规则+5种标签变体+不区分大小写+孤立标签移除）；支持 feed/flush/reset 流式接口和 scrubThinkBlocks 一次性清理便捷函数；核心模块完成，集成到流式输出管线留作后续优化
- **think-filter 增强**：增强已有 think-filter 模块（已集成 runtime.ts 流式管线），新增 5 种标签变体支持（think/thinking/reasoning/thought/REASONING_SCRATCHPAD）+ 孤立关闭标签移除 + 精确部分标签暂存（maxPartialSuffix）；保持 createThinkFilter/stripThinkBlocks/ThinkStreamFilter 接口完全兼容
- **execute_code Python fallback**：execute_code 工具新增 Python 运行时自动 fallback 机制，主命令 python 失败时自动尝试 py（Windows Python Launcher）；LanguageRuntime 新增 fallbackCommand 字段；fallback 成功时添加提示；不影响 Node.js 和 Shell 语言
- **LLM 审查列表与统计**：llm-reviewer 新增 listLLMReviews（按时间倒序列出所有审查结果，支持 limit 参数）和 getReviewStats（统计汇总：总审查数/状态分布/平均质量分/安全问题数/潜在bug数/文件数/时间范围）；新增 ReviewStats 类型；平均质量分仅统计 completed 状态
- **消息脱敏模块**：移植自 Hermes redact.py，新增 message-redactor.ts（30+ API key 前缀 + 15 种脱敏模式 + 性能预检查优化）；支持已知 API key 前缀、ENV 赋值、JSON 字段、Authorization header、私钥块、数据库连接串、JWT、URL 查询参数、手机号等脱敏；短 token 完全脱敏为 ***，长 token 保留前 6 后 4 字符；支持 force/codeFile/enabled 配置和 redactObject 递归脱敏；集成到 trajectory 导出（sanitizeText 增强）
- **日志系统集成脱敏**：logger 新增 setLogRedactor/getLogRedactor 脱敏钩子；emit 函数自动脱敏所有日志输出（stdout/stderr + 文件落盘）；脱敏函数异常时静默忽略不影响主链路；main 进程默认注册 redactSensitiveText，环境变量 CYRENE_LOG_REDACT=false 可关闭
- **技能推荐器**：新增 skill-recommender.ts，基于关键词匹配的技能推荐；中英文混合分词 + 200+ 停用词过滤；4维度加权评分（描述40%/id20%/名称20%/工具20%）；recommendSkills/recommendTopSkill 函数；支持 limit/minScore/mode/onlyEnabled 选项；推荐结果包含 score/matchedKeywords/reason
- **LSP 集成基础框架**：新增 lsp/ 目录；lsp-protocol.ts 纯函数协议层（JSON-RPC 编码/解码 + 标准错误码 + 消息分类 + 诊断类型 + Unicode Content-Length 正确计算）；lsp-client.ts 客户端框架（依赖注入 LSPProcess 接口 + 连接管理 + 请求/响应匹配 + 通知发送 + 文本文档同步 + 诊断存储 + 优雅关闭 + 进程退出处理）
- **message-redactor YAML 格式支持**：新增 YAML_FIELD_RE 正则，支持 `apiKey: value`（冒号分隔，不带引号）格式的敏感字段脱敏；支持驼峰（apiKey）和下划线（api_key）命名；排除 authorization/auth（由 AUTH_HEADER_RE 专门处理）；使用负向前瞻排除已脱敏的值（包含 `...`），避免二次脱敏
- **日志脱敏性能优化**：LogRedactor 函数签名添加 level 参数，可根据日志级别决定是否脱敏；main 进程默认只对 info 及以上级别脱敏，debug 级别跳过以提升性能；可通过环境变量 CYRENE_LOG_REDACT=false 完全关闭
- **技能推荐器语义匹配增强**：新增同义词词典（40+ 同义词组，覆盖编程/音乐/天气/翻译/搜索/文件/邮件/日历/系统/学习/写作/图像/视频/数学/数据/安全/网络/购物/导航/健康/财务/旅行等领域）；expandKeywords 函数将用户关键词扩展为同义词；中英文同义词互译（如"写代码"→"programming"，"music"→"音乐"）
- **LSP 真实进程集成**：新增 lsp-process.ts，实现 createLSPProcess 函数，使用 child_process.spawn 启动真实语言服务器；支持 Windows shell 兼容；stdout/stderr/exit 事件回调；优雅终止（SIGTERM + stdin end）；新增 isLSPCommandAvailable 函数检查命令是否可用（Windows 使用 where，其他系统使用 command -v）
- **LSP 代码智能功能**：lsp-client.ts 新增 getCompletions（发送 textDocument/completion 请求，返回补全项列表，支持 CompletionList 和 CompletionItem[] 两种返回格式）、getHover（发送 textDocument/hover 请求，返回悬停内容）、getDefinition（发送 textDocument/definition 请求，返回定义位置）；lsp-protocol.ts 新增 CompletionItem/CompletionList/Hover/Location 类型定义
- **技能服务集成**：新增 skill-catalog-store.ts（内置 17 个可用技能模板，覆盖开发/数据/写作/教育/生活/办公 6 大分类，每个技能包含 id/名称/描述/分类/版本/模式/工具/标签）；新增 skill-installer.ts（技能安装器，从目录安装技能到用户目录，自动生成 SKILL.md 模板，支持安装/卸载/重复检查）；新增 skill-service.ts（统一技能服务，整合推荐/查询/安装，listSkills/recommendSkills/getSkillCatalog/searchCatalog/installSkill/uninstallSkill 方法，同时推荐已安装和未安装技能）
- **商汤 SenseAudio TTS 支持**：新增商汤 SenseAudio 语音合成引擎，支持 34 种系统音色，1.5/2.0 模型选择，语速调节
- **技能管理面板**：新增独立的技能管理设置页面，支持技能列表查看、启用/禁用、按来源筛选、重新扫描技能目录
- **备份管理系统**：新增独立的备份管理模块，支持手动备份、自动备份（人设/风格修改时）、备份恢复、备份删除、保留数量设置
- **自定义下拉栏组件**：封装统一的 CustomSelect 组件，粉色主题，"吸连"效果，全局替换原生 select
- **风格管理 UI**：新增完整的风格编辑界面，包含风格选择、人设 Prompt 编辑、Temperature 调节、保存/重新加载
- **人设管理**：新增独立的人设管理区域，可以编辑 soul.md
- **视觉模型配置**：支持本地 Ollama + 云端模型混合配置，Ollama 服务自动拉起
- **API Key 眼睛图标**：所有密码/API Key 输入框统一添加可查看/隐藏的眼睛图标
- **音量和语速本地实时调节**：播放时实时调节音量和语速，不需要重新合成
- **技能自整理机制**：支持技能自动合并、归档，定期或阈值触发，辅助模型参与
- **LSP 设置面板接线**：lsp-config-ipc（配置存储/连接测试/状态）在主进程组合根注册，LSP 设置面板的保存/测试/状态查询链路打通；设置面板中启用的自定义服务器（lsp-config.json）优先于内置语言服务候选（支持按 workspaceRoot 限定生效范围）
- **技能自动创建闭环**：移植 Hermes skill creation 设计，新增 skill-creation.ts（Run 结束后异步判定是否沉淀技能：确定性门槛检查 → LLM 生成 SKILL.md → 幂等检查 → 安全扫描 → 写入技能库）与 security-scan.ts（静态正则扫描技能内容，拦截 curl 密钥窃取/rm -rf/降权提权等危险命令）；harness-adapter 新增 setSkillCreationCallback 可注入回调，default-dependencies 组合根注入后台执行（复用主模型配置，默认不注入时不启用）
- **脚本内 RPC 调用工具**：移植 Hermes code_execution_tool RPC 设计，新增 execute-code-rpc.ts（回环 TCP 服务器：工具白名单 + 单次调用上限 + newline-delimited JSON 协议）；execute_code 工具启动脚本时自动注入 stub（rpc_stubs.py / rpc_stubs.js），脚本内可调用 read_file/run_shell/web_search 等白名单工具；Node stub 响应消费后自动关闭连接，脚本可自然退出；修复 Windows 下子进程退出后服务器侧 socket ECONNRESET 未监听导致的崩溃隐患
- **Git Worktree 隔离**：移植 Hermes `hermes -w` 工作区隔离设计，新增 worktree.ts（在仓库根下创建 `.worktrees/cyrene-<8hex>` 隔离 worktree + 独立分支 `cyrene/<name>`，自动写入 `.gitignore`）；支持 `.worktreeinclude` 白名单文件复制进 worktree（目录优先 symlink，Windows 无权限回退 copytree，拒绝目录穿越/逃逸）；清理时保留含未推送提交的 worktree（相对 refs/remotes/* 判定，无远端基线视为无未推送）；harness-adapter 接入 setupWorktree/cleanupWorktree，cyrene-agent.ts 新增 `useWorktree` 选项（默认关闭）

### Changed

- **LSP 客户端去重**：删除未接入的 lsp-client.ts 死代码（其 LSPProcess/LSPClientConfig 类型迁移至 lsp-process.ts），保留已接入 manager 的 client.ts；LSP 代码智能功能（补全/悬停/定义）由 manager 通用 request 通道提供

- **粉色主题**：全局 UI 主题从紫色改为粉色（#f472b6）
- **导航栏结构优化**：技能管理和备份管理从通用设置中移出，作为独立导航项
- **技能标签分类**：简化为"自进化"和"外部获取"两种标签，内置和用户技能都归为"外部获取"
- **TTS 引擎持久化**：修复 TTS 引擎选择、音色选择等配置不持久化的问题
- **TTS 缓存优化**：缓存 key 包含音色信息，切换音色时自动清空缓存，避免播放错误音色
- **TTS 播放锁**：连续点击播放时从头播放，避免音频重叠

### Fixed

- **导航栏选中样式**：修复技能管理和备份管理页面导航栏选中样式不更新的问题，将激活状态更新移到 switchSection 函数开头
- **LSP 进程 shell 解析错乱**：修复 createLSPProcess 在 Windows 无条件启用 shell 导致 cmd.exe 把含括号等特殊字符的参数（如 `node -e` 内联脚本）拆解成多条命令并生成垃圾文件的问题（同时消除 Node DEP0190 注入风险）；shell 仅对 `.cmd/.bat` 命令启用，普通可执行文件直接 spawn 原样传参
- **CustomSelect 重复方法**：删除 getElement() 方法的重复定义
- **商汤 TTS 音频解码**：修复商汤 TTS 返回的十六进制编码音频解码错误的问题，使用 Buffer.from(audio, "hex") 解码
- **TTS 缓存 key 校验**：修复 tts-cache-key.ts 中 CACHE_KEY_PREFIX 正则不包含 senseaudio 导致校验失败的问题
- **TTS 引擎白名单**：修复 settings-facade.ts 中 ttsEngine normalize 白名单不包含 "senseaudio" 的问题
- **辅助模型设置重复**：删除 index.html 中重复的 5 个辅助模型配置区
- **备份删除按钮颜色**：修复备份管理页面删除按钮颜色与背景重合的问题，改为红色背景+白色文字

### Technical

- **项目结构**：采用总分文件结构，新增模块独立成目录（backup/、components/custom-select/）
- **配置持久化**：所有用户操作配置确保持久化到 app-settings.json
- **错误处理**：所有面板初始化添加 try-catch 保护，避免单个面板错误影响整个设置页面
