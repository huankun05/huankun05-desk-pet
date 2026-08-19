# 情绪与人格系统分析（desk-pet）

> 分析时间：2026-08-19。范围：情绪状态页（EmotionPage）、人格画像页（PersonalityPage）、
> 前端 `useEmotion` 引擎、后端 core 服务（`server/core/`）情绪/人格引擎。
> 结论先行：**九维情绪是「活」的，HEXACO 人格是「半死」的**（只读不漂移），
> 前后端结构不匹配已修复；优化方向按学术界 PAD/OCC 三层模型对齐。

## 一、两套体系，别混淆

| | 前端 useEmotion（主窗运行时） | 后端 core 服务（soul/heart/bridge） |
|---|---|---|
| 情绪 | emotion 11 种 + mood 5 种 + 强度 | 汐月九维（pleasure/energy/empathy/curiosity/confidence/gratitude/anxiety/loneliness/excitement）→ PAD |
| 人格 | personality 4 维（cheerfulness/sensitivity/sociability/energy） | HEXACO 六维（honesty_humility/emotionality/extraversion/agreeableness/conscientiousness/openness） |
| 存储 | localStorage（emotion/emotionHistory） | SQLite（emotion_states/personality_states/emotion_history） |
| 驱动 | 文本/语音/互动 → 引擎 → eventBus | useBrainBridge 喂事件 → emotion_bridge |
| 展示页 | （无独立页，体现在交互） | EmotionPage（九维+PAD）、PersonalityPage（HEXACO+PAD 基线） |

## 二、事件 → 数值变化链路（「活」不活）

### 汐月九维情绪（EmotionPage）—— ✅ 活的
- **触发源**（`useBrainBridge.ts` 监听 eventBus）：
  - `perception:gesture`（手势）→ `postEmotionBridgeEvent('perception:gesture', gesture)`
  - `perception:face_expr`（表情）→ `postEmotionBridgeEvent('perception:face_expr', expr)`
  - `interaction:pat` / `interaction:tap` / `interaction:step`（摸头/拍打/踩脚）
  - 对话消息写入主会话（`message:sent` / `message:response`）
- **后端**：`emotion_bridge.py` 读映射表（`emotion_to_pad` 权重）→ 更新九维 → 映射 PAD → mood_label
- **回环**：`useBrainBridge` 30s 轮询 bridge/state → mood_label 变化时 emit `expression:change` → Live2D 表情跟随
- **展示**：EmotionPage 拉 bridge/state（dimensions/pad/mood_label/recent_history）

### HEXACO 人格（PersonalityPage）—— ⚠️ 半死
- **只读**：`GET /api/core/soul/personality` 返回当前六维 + description + pad_baseline
- **可写但无人调用**：`POST /api/core/soul/personality/drift`（PersonalityDrifter 支持
  positive_interaction / negative_interaction / learning / shared_goal / emotional_support
  五类漂移）在**前端零调用** → 人格永不变化，除非手工 POST
- **时间节律**（circadian / reunion）同样前端零调用

## 三、已修复的问题（本次）

1. **PersonalityPage toFixed 崩溃根因**：后端返回 `{ hexaco: {六维}, description, pad_baseline, updated_at }`
   （六维嵌套在 `hexaco` 下），前端却从顶层取 `data.honesty_humility` → undefined → `.toFixed(2)` 崩。
   - `coreApi.getPersonality()` 现在适配解包（扁平化六维 + 带回 description/pad_baseline）
   - PersonalityPage 优先采用后端 `description` / `pad_baseline`（后端未提供时回退前端规则）
2. **硬编码中文未进 i18n**：人格页「中间型人格」「低/高」、情绪页相对时间（秒前/分钟前…）与 PAD 标签全部接入 zh/en。
3. **防御性取值**：所有 `data[维度]` 消费点 `Number(x ?? 0)`，后端缺字段不再崩。

## 四、学术参照与优化建议（WebSearch 调研）

调研结论（PAD 情绪模型 Mehrabian / OCC 评估模型 / Sentipolis 2026 arxiv）：
> 三层时标：**情绪=短期瞬态**（事件驱动的 PAD 位移）、**心境=中期**（PAD 空间中的聚合位置）、
> **人格=长期基线**（定义情绪回落的稳定点）。情绪评估（OCC）改变 PAD；事件停止后回落到人格基线。
> 人格还决定情绪衰减速率（神经质高的人负面情绪消退慢）。Sentipolis 进一步提出
> **PAD 半衰期衰减** `s(t+Δt)=s(t)·2^(-Δt/T₁/₂)`、**情绪-记忆耦合**（记忆附带情绪影响）、
> **PAD→语义标签注入 LLM prompt**（KNN 到真实人类 PAD 数据 → Plutchik 情绪标签，而非裸数值）。

### 已实施（2026-08-19 晚，合并为一套 + 双向影响）

| # | 项 | 落地 |
|---|----|------|
| 1 | **人格→PAD 基线回路** | `server/core/api_server.py`：`get_state` 读 HEXACO → `pad_baseline_influence()` 作为 `EmotionState.baseline`，每次读取向基线 `drift()` 回落并持久化——**人格真正塑造情绪** |
| 2 | **人格决定衰减速率** | `_get_drift_rate`：情绪性高 → 回落慢（情绪持久/敏感），情绪性低 → 回落快（冷静），0.01~0.05 |
| 3 | **漂移触发接线（情绪→人格）** | `process_event` 末尾 `apply_drift_from_event`：正向互动（表扬/喜欢/pat/tap）→ 诚实-谦逊/宜人性微升；负面（生气/踩脚/频繁）→ 情绪性升/宜人性降；学习 → 开放性升。幅度 ±0.01，需数百次互动才明显 |
| 4 | 半衰期/指数衰减 | `drift()` 向基线按比例插值，语义等价指数衰减（无需单独改） |
| 5 | **前后端合并为一套** | 新增 `src/services/emotionBackendMap.ts`（PAD/mood_label → 本地 emotion/mood/intensity 映射）；`useEmotion` 初始化从 `GET /api/core/heart/emotion` 读后端状态覆盖本地情绪，`setNewEmotion` 等事件 `POST /api/core/heart/emotion/event` 双写（后端持久化 + 人格漂移）。后端为长期事实源，前端为运行时镜像，core 服务离线时自动降级纯本地 |
| 6 | **时间节律接入** | `get_state` 叠加 `CircadianRhythm().pad_influence()`（±15% 权重，仅影响展示/表情，不写库），昼夜节律让情绪随时间自然起伏 |

### 待后续（需要更多上下文/跨服务改造）

| # | 项 | 说明 |
|---|----|------|
| 7 | **PAD→prompt 注入** | 聊天/主动消息的 system prompt 注入当前情绪标签（"愉悦·兴奋"），让人格一致性可感知（主窗 proactive 已注入 emotion/mood，聊天窗 gateway 未接） |
| 8 | **情绪-记忆耦合** | 记忆抽取时附带当时 PAD/情绪标签，回忆时影响当下情绪（`server/hermes_core/brain/`） |
| 9 | 人格页可视化"漂移历史" | 后端 `PersonalityDrifter.history` 已记录每次漂移，可在 PersonalityPage 展示变化轨迹 |

## 五、结论

- 情绪系统（前端 useEmotion + 后端 heart/bridge）是**完整且活跃**的闭环。
- **合并已完成**：后端为单一事实源（SQLite + 人格基线/漂移/时间节律），前端 useEmotion 初始化和事件均与后端同步（离线自动降级本地）。
- **人格⇄情绪双向影响已打通**：人格→情绪（PAD 基线回落 + 衰减速率）、情绪→人格（事件驱动 HEXACO 漂移）。
- 结构不匹配（toFixed 崩溃）已治本修复；后续新增 soul 端点注意前后端字段对齐。
