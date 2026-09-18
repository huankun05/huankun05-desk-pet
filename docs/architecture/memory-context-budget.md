# 记忆主人与上下文注入预算

**状态**：当前方案  
**问题**：关系记忆会不断增长；全部丢进上下文不可行。

---

## 1. 记忆主人（单一真相）

| 数据 | 主人 | 存储 |
|---|---|---|
| 会话原文 L0 | Hermes SessionDB | `HERMES_HOME` 下 state.db + FTS5 |
| 关系记忆 L1/L2/L3 | Hermes MemoryManager + **LifeMemoryProvider** | Provider 自管（SQLite/文件等） |
| 用户画像 L3 | 同上 | 同上 |
| 角色人设 / Worldbook | **角色卡** | 安装包/用户目录，注入 system/上下文 |
| 情绪瞬时状态 | LifeKernel | 应用数据 |

原则：**每种记忆只有一个主人**。模式是标签与配额，不是分库。

---

## 2. LifeMemoryProvider（扩展字段）

在 Hermes `MemoryProvider` 接口上扩展（插件，不改 core）：

- `layer`: `L1|L2|L3`（及可选 evidence 指向 L0）  
- `emotion_snapshot`: 创建时情绪摘要  
- `is_permanent`: 跳过遗忘/降权  
- `mode_affinity`: 与 chat/work/code/learn 的适配度  
- `character_id`: 可选  
- `sensitivity`: 可选 public/private/secret  

生命周期对齐 Hermes：`initialize / system_prompt_block / prefetch / sync_turn / shutdown`。

---

## 3. 注入预算（每轮必须裁剪）

### 3.1 默认预算（可配置）

| 参数 | 建议默认 | 说明 |
|---|---|---|
| `memory_token_budget` | 1500–2500 | 关系记忆占用上限 |
| `max_items` | 6–10 | 条数上限 |
| `persona_worldbook_budget` | 另计（角色卡） | 不与关系记忆抢同一叙事时可合并统计 |
| `life_state_budget` | ~200 tokens | 情绪/关系状态摘要 |

### 3.2 层配额示例

| 层 | 单轮最多 |
|---|---|
| L3 画像 | 1 |
| L2 场景/摘要 | 2 |
| L1 事实/偏好/规则 | 4 |
| 原话 evidence | 2 |

### 3.3 打分筛选

```text
score = relevance × importance × recency × emotion_weight × mode_fit
```

- 超预算：从低分开始丢  
- 单条过长：截断或预摘要  
- `is_permanent` 可提高权重但**仍受 token 预算约束**（可多条竞争，不可无限注入）  

### 3.4 模式差异

| 模式 | 倾向 |
|---|---|
| Chat | 偏好/互动/情绪相关；少工具输出细节 |
| Learn | 学习目标/进度相关 |
| Work | 约定/项目上下文；少闲聊 |
| Code | 构建约定/技术偏好；最少闲聊 |

---

## 4. 与 Cyrene DMAE 的关系

| 能力 | 是否采用 |
|---|---|
| 激活 / 衰减 / 跨轮驻留的**思想** | 可参考，用于**人设 Worldbook** 简化版 |
| 关系记忆再开一套 DMAE 引擎 | **不采用** |
| L2 全量进 prompt | **禁止**，一律过预算 |

历史设计见 `../history/cyrene-harness/2026-08-08-dmae-v5-upgrade-and-l2-working-memory.md`（只读参考）。

---

## 5. 遗忘与整理

- Provider 内：importance/access/decay 类字段可保留旧版思路  
- 后台：反思系统可提议「巩固 / 合并 / 降权」  
- 删除：低价值条目归档或物理删需可配置，默认保守  

---

## 6. 验收要点

- [ ] 记忆库条数很大时，单次请求注入条数与 token 仍受预算限制  
- [ ] 四模式召回分布符合 mode 倾向  
- [ ] 换角色卡不丢关系记忆  
- [ ] 不出现双库同时写同一事实  
