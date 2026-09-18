# 角色卡（Character Card）规范

**状态**：当前方案  
**原则**：人设可换皮；**关系记忆默认共享**；Live2D 与身份/性格绑定在同一张卡。

---

## 1. 目录结构

```text
characters/
  <card-id>/
    card.yaml
    identity.md
    soul.md
    worldbook/
      *.md
    style/
      chat.md
      work.md
      code.md
      learn.md
```

---

## 2. card.yaml（示例）

```yaml
id: cyrene
name: 昔涟
live2d:
  model: "assets/models/cyrene/model3.json"
  expressionMap: "characters/cyrene/expressions.yaml"
voice:
  local: "cosyvoice/cyrene"    # 或 gpt-sovit
  cloud: "senseaudio:xxx"
baseEmotion: calm
modes: [chat, work, code, learn]
memory:
  shared: true                 # 关系记忆共享
  characterId: cyrene          # 可选标注
```

---

## 3. 内容分工

| 文件 | 内容 |
|---|---|
| `identity.md` | 她是谁、背景（昔涟等） |
| `soul.md` | 价值观、底线、绝不做的事 |
| `worldbook/` | 人物/世界观条目（触发词+正文）；**不是**关系记忆 |
| `style/*.md` | 四模式说话与行为风格 |

**昔涟迁移**：将现有 `prompts/worldbook/*` 与风格 prompt **转换**到本结构，作为第一张卡 `cyrene`。

---

## 4. 切换语义

| 切换时 | 变 | 不变 |
|---|---|---|
| 角色卡 | Live2D、身份、Worldbook、风格、默认声音 | 用户关系记忆、会话历史 |
| 模式 | 提示/工具集/权限策略 | 角色卡、记忆库 |

---

## 5. 与大脑的衔接

- Electron 加载当前卡 → 组装 system/世界书注入 Hermes  
- LifeKernel 状态摘要叠加在卡之上（同一角色也有今天的心情）  
- Worldbook 可用简化激活（关键词/常驻），**关系记忆走 MemoryProvider 预算**  

---

## 6. 验收

- [ ] 换卡后 Live2D/风格/人设变化，记忆仍可召回  
- [ ] worldbook 不会与 MemoryProvider 双写同一事实  
- [ ] 四模式 style 可独立修改而不改 identity  
