# 🐱 Desk Pet — 智能桌面助手

基于 Tauri 2.0 + React 19 的桌面宠物/智能助手。Live2D 角色互动 + AI 对话 + 语音合成/识别 + 系统自动化。

## 快速开始

```bash
cd desk-pet
npm install
python -m venv venv
venv\Scripts\pip install -r server/requirements.txt
# 如需 CUDA: venv\Scripts\pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu121
npm run tauri dev
```

## 项目结构

```
desk-pet/
├── src/                   # React 前端（Live2D + 对话 + 管理后台）
├── src-tauri/             # Tauri Rust 后端
├── server/                # Python 后端（TTS/STT 引擎 + 对话管线，共享 venv）
├── venv/                  # 共享 Python 虚拟环境
└── ...
```

详见 [PLAN.md](PLAN.md) 完整路线图，[ARCHITECTURE.md](ARCHITECTURE.md) 系统架构。

---

## 添加新的 TTS Provider 指南

给 desk-pet 添加一个新的 TTS（语音合成）Provider，让它可以在设置窗的服务页中管理、切换时自动启停、通过前端正常调用合成。

### 你需要改动 3 个地方

| # | 改什么 | 在哪 | 必须？ |
|---|--------|------|--------|
| 1 | 后端 Python 服务器 | `server/xxx_server.py` | 如果服务需要自启动 |
| 2 | 前端 TS 适配器 | `src/services/provider/tts/xxx.ts` | 必须（否则前端不会调用它做合成） |
| 3 | 注册到 Provider 注册表 | `src/services/provider/registry.ts` | 可选（AUTO_REGISTER_TTS 会自动扫描注册表） |

---

### 第一步：后端 Python 服务器

如果新增的 TTS 引擎需要由 desk-pet 自动启动，写一个 FastAPI 服务器。

#### 脚手架

```python
"""
MyTTS HTTP Server
启动: python server/my_tts_server.py --port 5678
"""
import argparse, io, logging, numpy as np
from pathlib import Path
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
log = logging.getLogger("mytts-server")

from fastapi import FastAPI
from fastapi.responses import Response
from pydantic import BaseModel

app = FastAPI(title="MyTTS Server", version="1.0.0")

class TTSRequest(BaseModel):
    text: str
    voice: str = ""
    speed: float = 1.0

@app.post("/tts")
async def synthesize(req: TTSRequest):
    """合成语音，返回 WAV 音频（16-bit PCM, 24000Hz）"""
    # TODO: 调用你的 TTS 引擎
    audio_np = np.zeros(24000, dtype=np.float32)  # 1秒占位
    import soundfile as sf
    buf = io.BytesIO()
    sf.write(buf, audio_np, 24000, format="wav")
    return Response(content=buf.getvalue(), media_type="audio/wav")

@app.get("/voices")
async def list_voices():
    return {"voices": ["default"]}

@app.get("/health")
async def health():
    return {"status": "ok", "model_loaded": True}

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=5678)
    args = parser.parse_args()
    import uvicorn
    uvicorn.run(app, host=args.host, port=args.port)
```

#### 必须实现的端点

| 端点 | 方法 | 用途 | 返回 |
|------|------|------|------|
| `/tts` | POST | 文字转语音 | `audio/wav` 二进制 |
| `/voices` | GET | 可用声音列表 | `{"voices": [...]}` |
| `/health` | GET | 健康检查 | `{"status": "ok"}` |

参考现有实现：`server/edge_tts_server.py`（135行）、`server/voxcpm_server.py`（140行）。

---

### 第二步：前端 TS 适配器

在 `src/services/provider/tts/` 下新建文件，实现 `TTSProvider` 接口。

#### 适配器模板

```typescript
// src/services/provider/tts/mytts.ts
import type { TTSProvider, TTSResult } from '../types';

export class MyTTSProvider implements TTSProvider {
  readonly type = 'tts' as const;
  readonly typeName = 'mytts';                // 全局唯一标识
  readonly name = 'MyTTS 引擎';
  readonly defaultBase = 'http://localhost:5678';

  async validate(config: { apiBase?: string }): Promise<boolean> {
    try {
      const res = await fetch(`${config.apiBase || this.defaultBase}/health`, {
        signal: AbortSignal.timeout(5000),
      });
      return res.ok;
    } catch { return false; }
  }

  async synthesize(text: string, options: { voice?: string; speed?: number; apiBase?: string }): Promise<TTSResult> {
    const base = options.apiBase || this.defaultBase;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
      const res = await fetch(`${base}/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voice: options.voice || '', speed: options.speed || 1.0 }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      return { audioData: new Uint8Array(await blob.arrayBuffer()), sampleRate: 24000 };
    } finally { clearTimeout(timer); }
  }

  synthesizeStream?(text: string, _options?: { voice?: string; speed?: number; apiBase?: string }): AbortableAsyncGenerator<Uint8Array> {
    return null as any; // 暂不支持流式
  }

  abort() { /* 中断当前合成 */ }
}
```

#### 注册到系统

打开 `src/services/provider/registry.ts`，在 `tts` Map 中添加：

```typescript
import { MyTTSProvider } from './tts/mytts';
registry.register('tts', 'mytts', () => new MyTTSProvider());
```

`manager.ts` 中的 `AUTO_REGISTER_TTS` 数组会自动扫描注册表，无需额外修改。

---

### 第三步（可选）：注册到 Provider 注册表

> 第二步在 `src/services/provider/tts/xxx.ts` 实现的适配器，会被 `src/services/provider/manager.ts` 的 `AUTO_REGISTER_TTS` 自动扫描注册（参见上文），通常无需额外改动。

如需把它作为**内置预设**出现在设置窗服务页的下拉里，在 `src/services/provider/registry.ts` 用 `registry.register('tts', '<id>', { ... })` 注册（参考已有的 cosyvoice 等条目）。用户在设置窗服务页添加 TTS Provider 时，选择该引擎就会自动填好命令、参数、端口。

---

### 自动启停机制

设置服务页（`TTSPage.tsx` / `STTPage.tsx` / `LLMPage.tsx`）的 `handleSetActive` 实现了切换 TTS/STT Provider 时的自动启停：

```
点击"设为活跃"
  ├─ 停止旧活跃 Provider 的进程（有 command+port 时）
  ├─ 启动新活跃 Provider 的进程（有 command+port 时）
  └─ 切换活跃状态
```

你只需要确保 ProviderConfig 里填了 `command`、`commandArgs`、`port`，切换时就会自动管理后端进程，不需要写额外代码。

**退出清理**：关闭主窗口时，Rust 后端自动调用 `service_stop_all` 终止所有子进程（`taskkill /F /T` 进程树），不会残留孤儿进程。

---

### 完整示例

| 步骤 | 文件 | 做什么 |
|------|------|--------|
| 1 | `server/cosyvoice_server.py` | 写 FastAPI `/tts` + `/health` + `/voices` |
| 2 | `src/services/provider/tts/cosyvoice.ts` | 实现 `TTSProvider` 接口 |
| 3 | `src/services/provider/registry.ts` | 注册 `registry.register('tts', 'cosyvoice', ...)` |
| 4 | `src/services/provider/registry.ts` | 用 `registry.register('tts','cosyvoice', ...)` 注册为内置预设 |
| ✅ | 完成 | 切换 CosyVoice → 自动启动 → 前端正常合成 |
