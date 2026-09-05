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

### Changed

- **粉色主题**：全局 UI 主题从紫色改为粉色（#f472b6）
- **导航栏结构优化**：技能管理和备份管理从通用设置中移出，作为独立导航项
- **技能标签分类**：简化为"自进化"和"外部获取"两种标签，内置和用户技能都归为"外部获取"
- **TTS 引擎持久化**：修复 TTS 引擎选择、音色选择等配置不持久化的问题
- **TTS 缓存优化**：缓存 key 包含音色信息，切换音色时自动清空缓存，避免播放错误音色
- **TTS 播放锁**：连续点击播放时从头播放，避免音频重叠

### Fixed

- **导航栏选中样式**：修复技能管理和备份管理页面导航栏选中样式不更新的问题，将激活状态更新移到 switchSection 函数开头
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
