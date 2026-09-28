/**
 * Chat 模式本地引擎路由（P1 换脑第一刀）。
 *
 * chatViaHermes 开启时，把 Chat 模式的模型请求指向 Hermes gateway 的
 * OpenAI 兼容端点（`POST /v1/chat/completions`，网关侧 agent 化：内部跑
 * 完整 agent 循环，请求里的 system messages 合成 ephemeral system prompt）。
 *
 * 设计取舍：
 * - 只做「模型接入层」替换：记忆注入、模式提示、上下文、流式事件、
 *   会话持久化等 Harness 管线原样复用，网关对 Harness 而言就是一个
 *   说 OpenAI 协议的厂商端点；
 * - 失败回退由调用方（cyrene-agent chat 分支）负责：捕获异常后用原始
 *   settings 重跑 runChatLoop；
 * - 无 API_SERVER_KEY（网关强制要求 ≥16 字符密钥）时视为未配置，不路由。
 */
import { loadHermesSettings, resolveEffectiveHermesSettings } from "./hermes-settings";

export interface HermesChatBaseSettings {
  provider: string;
  baseUrl: string;
  model: string;
  apiKey: string;
}

export function getHermesChatSettingsView<T extends HermesChatBaseSettings>(base: T): T | null {
  // 路由层绝不抛错：任何异常（设置缺失、环境不完整）一律回退原路径
  try {
    const hermes = resolveEffectiveHermesSettings(loadHermesSettings());
    if (hermes.chatViaHermes !== true) return null;
    if (!hermes.apiServerKey) return null;
    const host = hermes.apiHost || "127.0.0.1";
    const port = hermes.apiPort || 8642;
    return {
      ...base,
      provider: "hermes",
      baseUrl: `http://${host}:${port}/v1`,
      apiKey: hermes.apiServerKey,
      model: hermes.defaultModel || base.model,
    };
  } catch (err) {
    console.warn("[HermesChatBridge] 路由判断失败，回退默认路径：", err);
    return null;
  }
}
