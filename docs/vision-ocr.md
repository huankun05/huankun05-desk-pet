# 视觉模型与 OCR 预处理

> 本文档说明 Cyrene Agent 的视觉模型架构、OCR 预处理功能、以及 Ollama 自动启动机制。

## 一、视觉模型架构

### 1.1 工作流程

Cyrene 使用**独立视觉模型**架构，与主对话模型解耦：

```
用户发图
  ↓
主模型支持多模态？
  ├─ 是 → 直接发图给主模型（direct）
  └─ 否 → 视觉模型把图片转成文本描述 → 文本描述传给主模型（caption）
```

- **主模型**：负责对话、推理、工具调用（如 DeepSeek、Qwen 等）
- **视觉模型**：负责图片理解，返回文本描述（如 minicpm-v4.6、moondream 等）
- **判断逻辑**：`src/main/chat/image-send-strategy.ts`

### 1.2 视觉模型实现

唯一接触多模态协议的地方：`src/main/orchestrator/vision-captioner.ts`

- 永远走 OpenAI 兼容 `image_url` 格式，不分 transport
- 支持任意 OpenAI 兼容的视觉模型 API（本地 Ollama / 云端）
- 超时策略：`resolveTimeoutPolicy({ stage: "vision-caption" })`
- max_tokens: 512（视觉描述用不到 4096，防回灌撑爆主模型上下文）

### 1.3 配置位置

设置 → 模型与API → 最底部「视觉模型（全局）」

配置字段（`model-settings.json` 的 `vision` 对象）：
```json
{
  "vision": {
    "baseUrl": "http://localhost:11434/v1",
    "apiKey": "ollama",
    "model": "minicpm-v4.6:q5_0",
    "ocrEnabled": false
  }
}
```

## 二、推荐视觉模型对比

| 模型 | 参数量 | 大小 | 无文字图 | 有文字图(OCR) | 速度 | 推荐场景 |
|------|--------|------|---------|--------------|------|---------|
| **minicpm-v4.6:q5_0** | 8B(量化) | 1.7GB | 好 | **好（自带OCR）** | 中等(5-8s) | **日常使用，全能型** |
| moondream:1.8b | 1.8B | 1.7GB | 快 | 差（无OCR） | 快(1-2s) | 无文字图片，追求速度 |
| qwen2.5-vl-7b | 7B | 5.5GB | 好 | 很好 | 慢(8GB显存超时) | 高配置机器 |

**当前推荐：minicpm-v4.6:q5_0**
- 既能描述图片内容，又能直接读文字（自带 OCR 能力）
- 8GB 显存可流畅运行
- 不需要额外的 OCR 预处理

## 三、OCR 预处理（可选）

### 3.1 功能说明

当视觉模型本身没有 OCR 能力（如 moondream）时，可以启用本地 OCR 预处理：

1. 先用 Tesseract.js 提取图片中的文字
2. 把 OCR 结果补充到视觉模型的 prompt 中
3. 视觉模型结合图片内容和 OCR 文字回答用户问题

**注意**：minicpm-v4.6 本身就有 OCR 能力，**不需要启用此功能**。仅在使用 moondream 等纯视觉模型时才需要。

### 3.2 实现

- OCR 服务：`src/main/orchestrator/ocr-service.ts`
- 集成位置：`vision-captioner.ts` 的 `captionImage()` 函数
- 引擎：tesseract.js v5.1.1（v7 在 Electron 主进程有兼容性问题）
- 语言：中文简体（chi_sim）+ 英文（eng）

### 3.3 语言包持久化

- 缓存目录：`%APPDATA%\live2d-cyrene\tessdata`
- 首次使用从 CDN 下载，后续直接读本地缓存
- 语言包文件：`chi_sim.traineddata`（2.47MB）+ `eng.traineddata`（5.20MB）

### 3.4 阈值过滤

OCR 识别文字超过 **20 字符**才补充给视觉模型，避免只有 "1/10" 这类编号干扰视觉模型描述图片内容。

### 3.5 Tesseract OCR 准确率说明

Tesseract 是传统 OCR 引擎，对**截图、照片、有背景、字体复杂**的图片准确率有限（中文约 40-60%）。如果需要高准确率 OCR，建议：
- 直接使用 minicpm-v4.6 等自带 OCR 能力的视觉模型
- 或接入云端 OCR API（百度/腾讯/阿里，有免费额度）
- 或部署 PaddleOCR（中文准确率 85-95%，需 Python 环境）

## 四、Ollama 自动启动

### 4.1 功能说明

当使用本地 Ollama 模型（视觉模型或主模型）时，如果检测到 Ollama 服务未运行，**自动静默启动 Ollama**，等待服务就绪后自动重试请求。

用户无需手动启动 Ollama，发图或对话时自动拉起。

### 4.2 实现

- 服务模块：`src/main/orchestrator/ollama-service.ts`
- 集成位置：`vision-captioner.ts` 的 `captionImage()` 函数（请求失败且是本地 Ollama 地址时触发）

### 4.3 关键特性

1. **静默启动**：使用 PowerShell `Start-Process -WindowStyle Hidden`，无控制台窗口闪烁
2. **全局锁**：并发请求只启动一次，后续请求等待同一次启动完成，不会重复拉起
3. **双重检测**：启动前检测 HTTP 接口（`/api/tags`）+ 系统进程列表（`tasklist`）
4. **等待就绪**：启动后轮询服务状态，最长等待 30 秒
5. **自动重试**：启动成功后自动重试失败的请求，用户无感知

### 4.4 触发条件

- 请求失败且错误信息包含 `fetch failed`
- 模型 baseUrl 是本地 Ollama 地址（`localhost:11434` 或 `127.0.0.1:11434`）

### 4.5 Ollama 可执行文件查找顺序

1. `D:\Ollama\ollama.exe`
2. `C:\Program Files\Ollama\ollama.exe`
3. `C:\Users\<用户名>\AppData\Local\Programs\Ollama\ollama.exe`
4. PATH 中的 `ollama`（通过 `where ollama` 查找）

## 五、配置示例

### 5.1 推荐配置（minicpm-v4.6，无需 OCR）

```json
{
  "vision": {
    "baseUrl": "http://localhost:11434/v1",
    "apiKey": "ollama",
    "model": "minicpm-v4.6:q5_0",
    "ocrEnabled": false
  },
  "multimodal": false
}
```

### 5.2 速度优先配置（moondream + OCR 预处理）

```json
{
  "vision": {
    "baseUrl": "http://localhost:11434/v1",
    "apiKey": "ollama",
    "model": "moondream:1.8b",
    "ocrEnabled": true
  },
  "multimodal": false
}
```

### 5.3 云端视觉模型配置

```json
{
  "vision": {
    "baseUrl": "https://api.openai.com/v1",
    "apiKey": "sk-xxx",
    "model": "gpt-4o",
    "ocrEnabled": false
  },
  "multimodal": false
}
```

## 六、常见问题

### Q1: 视觉模型请求失败，提示 "fetch failed"

A: 这是因为 Ollama 没运行。现在系统会自动启动 Ollama 并重试。如果自动启动失败，请手动启动 Ollama（运行 `ollama serve` 或打开 Ollama 桌面应用）。

### Q2: 发图后模型说"看不了"或"没有图片"

A: 检查 `multimodal` 设置是否为 `false`。如果主模型不支持多模态，必须设为 `false`，让系统走视觉模型转文本的流程。同时检查 `perProvider` 和 `modelProfiles` 中的 `multimodal` 是否也为 `false`（档案级设置会覆盖顶层）。

### Q3: OCR 识别不准，乱码多

A: Tesseract 对复杂图片准确率有限。建议直接使用 minicpm-v4.6（自带 OCR），或接入云端 OCR API。

### Q4: 启动 Ollama 时弹出黑窗口

A: 已修复为 PowerShell 静默启动（`-WindowStyle Hidden`），不会再弹窗口。如果仍有闪烁，请确认使用的是最新代码。

### Q5: 视觉模型测试时模型名改了报错

A: 修改配置后需要重启应用才能生效（应用启动时加载配置到内存）。或者在设置页面修改后点「保存档案」，部分设置会热更新。

## 七、相关文件

| 文件 | 说明 |
|------|------|
| `src/main/orchestrator/vision-captioner.ts` | 视觉模型请求实现，OCR 预处理集成，Ollama 自动启动重试 |
| `src/main/orchestrator/ocr-service.ts` | Tesseract.js OCR 服务封装，单例 worker，语言包持久化 |
| `src/main/orchestrator/ollama-service.ts` | Ollama 服务管理，检测运行状态，静默启动，等待就绪，全局锁 |
| `src/main/chat/image-send-strategy.ts` | 图片发送策略裁决（direct vs caption） |
| `src/main/settings/model-settings.ts` | 视觉模型配置接口与规范化 |
| `src/main/settings/settings-ipc.ts` | 视觉模型测试 / OCR 测试 IPC handler |
