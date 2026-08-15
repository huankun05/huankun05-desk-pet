# TTS 后端架构与部署（自动启动 · 热插拔）

> 最后更新：2026-08-15
> 适用范围：本仓库 TTS（语音合成）子系统。LLM/STT/Embedding 同属 Provider 体系，但本文聚焦 TTS 后端进程的生命周期管理。

## 1. 总览

桌面宠物的「说话」能力 = **前端 Provider 抽象 + Rust 后台托管的 Python TTS 进程**：

```
React 前端（需要说话）
   │  getActiveTTSProvider() 取当前活跃模型
   ▼
ensureActiveTTSBackend()  ── 探测 /health ── 未就绪？
   │                                          │
   │ 是                                       ▼
   │                               POST /api/service/start（Rust 后台 :9876）
   │                                          │
   │                                          ▼
   │                               Rust ServiceManager 拉起 Python 进程
   │                               （server/cosyvoice/.venv/.../python.exe cosyvoice_server.py --port 8003）
   │                                          │
   └──────────────────────────────────────────┘
                  ▼
       宠物 HTTP 调 http://localhost:8003/tts  →  WAV 音频  →  播放
```

**关键结论**：TTS Provider（前端配置）与 TTS 后端（Python 进程）是两层。Provider 只描述「用什么模型、访问哪个端口」；真正发声的是后端进程。后端**不会自动随 app 启动**，必须由代码显式拉起——这正是 `ensureActiveTTSBackend` 的职责。

## 2. 服务生命周期（四种触发）

| 触发 | 函数 | 时机 | 说明 |
|------|------|------|------|
| **按需自动启动** | `ensureActiveTTSBackend()` | 任意 speak 路径首次需要说话时 | 探测不可达 → 拉起 → 轮询到 `model_loaded=true` |
| **手动启动** | `startProviderService()` | 设置向导「保存」时 | 仅一次，重启 app 后失效（已被按需启动覆盖） |
| **热插拔切换** | `switchActiveTTSBackend(oldPort)` | 设置里切换激活模型 | 先 `stop` 旧后端（释放端口/显存）→ 拉起新后端 |
| **停止** | `stopProviderService()` | 切换时停旧 / 用户停止 | `POST /api/service/stop {id:"service_<port>"}` |

### 2.1 幂等保护（重要）

Rust 侧 `service_start_raw` **非幂等**：每次调用都会先 kill 同端口旧进程再 spawn 新进程。因此前端在拉起前必须：

1. 先查 `GET /api/service/list`（带端口 + 运行状态）确认该端口未被跟踪；
2. 用 module 级 `inFlight` Promise 锁防止并发/跨窗口重复 POST。

否则重复拉起会把正在加载（约 10–20s）的 CosyVoice 杀掉重来。

### 2.2 健康探针语义

- `validate()`：仅判断 HTTP 可达（`status < 500`）。**模型加载中 `/health` 已返回 200（`model_loaded:false`）**，故 `validate` 会**过早判定就绪**。
- `isAvailable()`（CosyVoice 已实现）：要求 `model_loaded && model_exists && !load_error` 才返回 true。自动启动逻辑用 `isAvailable ?? validate`，确保等到模型真正能合成才放行（首句不再卡 10–20s）。

## 3. CosyVoice 自包含部署

模型代码 + 权重 + 环境**已复制进本项目** `server/cosyvoice/`，不再依赖外部绝对路径（除一处回退，见 §6）。

```
server/cosyvoice/
├── cosyvoice_server.py      # HTTP 入口（已重写为项目内自包含）
├── CosyVoice/               # 第三方 CosyVoice 源码（4.1M，已提交）
│   ├── cosyvoice/           # cosyvoice 包
│   ├── models/              # （空，权重在下方 models/）
│   └── third_party/Matcha-TTS/
├── modules/
│   └── tts_cosyvoice_v3.py  # 适配器（零样本克隆 + 流式接口，已提交）
├── assets/nahida/
│   └── vo_HSEQ002_11_nahida_12.wav  # 参考音频（零样本克隆必需，692K，已提交）
├── models/nahida_cv3_finetuned/inference_model/  # 权重 11G（gitignore）
│   ├── llm.pt  flow.pt  hift.pt  campplus.onnx
└── .venv/                  # Python 环境 9.6G（gitignore，torch 2.4.1+cu121 + FP16）
```

**Git 策略**（`.gitignore`）：提交源码/适配器/参考音频；**忽略 `.venv/` 与 `models/`**（机器强绑定 + 体积巨大）。权重与 venv 由「共享项目环境」提供（开发机已就绪），不进版本库。

启动命令（由 `serviceLauncher.ts` 的 `TTS_LAUNCH_SPECS.cosyvoice` 解析）：

```bash
server/cosyvoice/.venv/Scripts/python.exe server/cosyvoice_server.py --port 8003
```

实测数据：模型加载 ~12–22s（RTX 4070 Laptop + CUDA 12.1，FP16 已启用），RTF<1，合成秒级，输出 24kHz WAV。

## 4. 全部 TTS 调用点（切换后全部跟新模型走）

| # | 功能 | 代码位置 | 取模型方式 | 自动拉起 | 切换后行为 |
|---|------|----------|-----------|---------|-----------|
| 1 | 聊天朗读（Pipeline） | `src/services/pipeline/stages/tts.ts` | 每次 `getSessionTTSProvider` | ✅ | ✅ 实时 |
| 2 | 聊天朗读（Hermes 流式） | `src/hooks/useHermesGateway.ts` | 每次 `getActiveTTSProvider` | ✅ | ✅ 实时 |
| 3 | 语音通话回话 | `src/hooks/useVoiceCall.ts` | 每次 `getActiveTTSProvider` | ✅ | ✅ 实时 |
| 4 | 唤醒回应 | `src/hooks/useWakeWord.ts` | 每次 `getActiveTTSProvider` | ✅ | ✅ 实时 |
| 5 | 一起看 | `src/hooks/useWatchTogether.ts` | 每次 `getActiveTTSProvider` | ✅ | ✅ 实时 |
| 6 | **预制台词预热** | `src/services/audio/interact-tts.ts` | **感知变化→重置+清缓存** | ✅ | ✅ 实时（修过 stale-cache） |

> 第 6 条曾是最危险的坑：`InteractTTS` 首启后把旧模型实例 + 旧声音永久缓存，切换后还在用旧模型。现已改为「检测 `activeTTSId` 变化 → 丢弃旧实例 + 清空旧缓存 + 实时合成兜底 + `reprewarm()` 重新预热」。

## 5. 热插拔体验

在设置页「TTS」点另一个已配置模型（或向导新注册即激活）：

1. `handleSetActive` / `wizardSave` → 记旧端口 → `setActiveTTSProvider` → `switchActiveTTSBackend(oldPort)`
2. 旧后端被 `stop`（端口 + GPU 显存立即释放）
3. 新后端被 `start` 并在后台加载（约 10–20s）
4. 切换动作即时返回不卡 UI；首次说话时等模型就绪，之后秒回
5. `InteractTTS.reprewarm()` 以新模型重新生成预制台词

> 真正的「不杀进程、原地换权重」做不到——GPU 模型整进程加载进显存，换权重必须杀进程重拉。后台只有 `start/stop`，无 `restart/reload`。当前「拔旧的、插新的」即热插拔标准语义。

## 6. 已知问题（非阻断，待办）

1. **语音通话网关与前端不一致**：`server/voice_services.py` 的 `sendVoice('start')` 只拉 Edge TTS(:8001)+FunASR，`all_ready` 不含 CosyVoice(:8003)。当前靠前端 `playTts` 单独 `ensureActiveTTSBackend` 拉起 CosyVoice 顶着，功能可用，但网关会多起一个闲置 Edge :8001。彻底对齐需改 `voice_services.py` 按 `activeTTSId` 拉对应引擎。
2. **开源清理**：`server/cosyvoice_server.py` 中 `_REF_VENV = r"F:/Work/Create/TTS/.venv"` 是绝对回退路径（项目内 `.venv` 存在时不触发），开源前需删除。
3. **流式降级**：`supportStream` 当前返回 false，TTS 走整段合成（非逐句流式），首句延迟略高。

## 7. 本地实测记录（2026-08-15）

- 通过 admin `POST /api/service/start` 启动 CosyVoice → `/health` 约 22s 后 `model_loaded:true`
- `POST /tts` 合成「你好，我是你的桌面宠物…」→ 200 + 合法 24kHz WAV（~220KB）
- admin `POST /api/service/stop` → 8003 LISTENING 消失，`/health` 连接拒绝（进程已死）
- **修复的阻断 bug**：参考音频 `assets/nahida/vo_HSEQ002_11_nahida_12.wav` 此前未复制进项目，导致 `/tts` 500。已补（692KB）。
- `tsc --noEmit` 全绿。
