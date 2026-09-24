/**
 * HermesClient 工厂 — 按当前有效设置构造客户端。
 *
 * 这是 HermesClient 唯一的接线入口：proc-mgr / IPC / 冒烟脚本
 * 都通过这里拿 client，避免各处重复拼 baseUrl / apiKey。
 */
import { HermesClient, type ChatMessage } from "./hermes-client";
import {
  loadHermesSettings,
  resolveEffectiveHermesSettings,
} from "./hermes-settings";

/** 按当前设置构造 HermesClient（端口/主机/key 全部来自有效设置）。 */
export function createHermesClientFromSettings(): HermesClient {
  const s = resolveEffectiveHermesSettings(loadHermesSettings());
  return new HermesClient({
    baseUrl: `http://${s.apiHost || "127.0.0.1"}:${s.apiPort || 8642}`,
    apiKey: s.apiServerKey,
  });
}

export type HermesSmokeResult = {
  ok: boolean;
  steps: Array<{ name: string; ok: boolean; detail: string }>;
  reply?: string;
};

/**
 * 最小 SSE 冒烟：health → capabilities → chat completions。
 *
 * 任何一步失败都会终止并返回已完成的步骤，便于设置页直接展示
 * 「卡在哪一步」。chat 失败不阻塞（可能只是没配模型凭据）。
 */
export async function runHermesSmoke(): Promise<HermesSmokeResult> {
  const steps: HermesSmokeResult["steps"] = [];
  const client = createHermesClientFromSettings();

  const health = await client.health();
  steps.push({
    name: "health",
    ok: health.ok,
    detail: health.ok ? "网关 /health 正常" : `HTTP ${health.status}`,
  });
  if (!health.ok) return { ok: false, steps };

  try {
    const messages: ChatMessage[] = [{ role: "user", content: "ping" }];
    const res = (await client.chatCompletions(messages)) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const reply = res.choices?.[0]?.message?.content ?? "";
    steps.push({
      name: "chat",
      ok: true,
      detail: reply ? `收到回复（${reply.length} 字）` : "HTTP 200 但无回复内容",
    });
    return { ok: true, steps, reply };
  } catch (err) {
    steps.push({ name: "chat", ok: false, detail: String(err) });
    return { ok: false, steps };
  }
}
