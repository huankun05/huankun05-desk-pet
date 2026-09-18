/**
 * 模型上下文窗口知识表 —— "自动获取上下文长度"的数据源（唯一定义点）。
 *
 * 用途：当用户没有手动填写上下文窗口时，按（厂商, 模型）自动解析出该模型
 * 支持的上下文长度，替代一刀切的 DEFAULT_CONTEXT_WINDOW_TOKENS（256000）。
 *
 * 覆盖范围：presets 中内置的 9 家厂商及其默认模型。未收录的厂商/模型
 * 返回 undefined，调用方回退到全局默认值。
 *
 * 说明：各模型值取该模型家族官方公开的上下文窗口（约数）；模型名精确匹配
 * 不区分大小写，未命中时用该厂商的 providerDefault（厂商级兜底）。
 */

/** 厂商级兜底值（该厂商任何模型都未命中时的默认）。 */
interface ContextWindowCatalogEntry {
  providerDefault?: number;
  /** 模型名（小写）→ 上下文窗口（Token）。 */
  models?: Record<string, number>;
}

/**
 * key 同时收录 displayName（"MiniMax（稀宇科技）"）、shortName（"MiniMax"）
 * 与 capability id（"minimax"），保证 profile/perProvider/顶层镜像三种来源
 * 都能命中。值全部小写存储，查找时统一 toLowerCase()。
 */
const CONTEXT_WINDOW_CATALOG: Record<string, ContextWindowCatalogEntry> = {
  "minimax（稀宇科技）": { providerDefault: 1_000_000, models: { "minimax-m3": 1_000_000, "minimax-m2.7": 1_000_000, "minimax-m2.5": 1_000_000 } },
  minimax: { providerDefault: 1_000_000 },
  "deepseek（深度求索）": {
    providerDefault: 131_072,
    models: {
      // 渠道别名 / 新一代命名（SenseNova 等可能用 v4-*）
      "deepseek-v4-pro": 262_144,
      "deepseek-v4-flash": 131_072,
      // 官方 API 常见 ID
      "deepseek-chat": 131_072,
      "deepseek-reasoner": 131_072,
      "deepseek-chat-v3": 131_072,
      "deepseek-chat-v3.1": 131_072,
      "deepseek-v3": 131_072,
      "deepseek-v3.1": 131_072,
      "deepseek-r1": 131_072,
    },
  },
  deepseek: { providerDefault: 131_072 },
  "豆包（火山方舟）": { providerDefault: 262_144, models: { "doubao-seed-2-1-pro-260628": 262_144, "doubao-seed-2-0-pro-260215": 262_144, "doubao-seed-2-0-lite-260428": 262_144, "doubao-seed-2-0-mini-260428": 262_144 } },
  doubao: { providerDefault: 262_144 },
  "glm（智谱）": { providerDefault: 131_072, models: { "glm-5.3": 131_072, "glm-5.2": 131_072, "glm-5.1": 131_072, "glm-5-turbo": 131_072, "glm-4.7": 131_072 } },
  glm: { providerDefault: 131_072 },
  "kimi（月之暗面）": { providerDefault: 131_072, models: { "kimi-k2.6": 131_072, "kimi-k2.5": 131_072, "kimi-k2-thinking": 131_072 } },
  kimi: { providerDefault: 131_072 },
  "qwen（通义千问）": { providerDefault: 32_768, models: { "qwen-max": 32_768, "qwen-plus": 131_072, "qwen-turbo": 1_048_576 } },
  qwen: { providerDefault: 32_768 },
  "chatgpt（openai）": { providerDefault: 131_072, models: { "gpt-5.6": 131_072 } },
  chatgpt: { providerDefault: 131_072 },
  "claude（anthropic）": { providerDefault: 200_000, models: { "claude-fable-5": 200_000, "claude-opus-4-8": 200_000, "claude-sonnet-4-6": 200_000 } },
  claude: { providerDefault: 200_000 },
  "mimo（小米）": { providerDefault: 131_072, models: { "mimo-v2.5-pro": 131_072 } },
  mimo: { providerDefault: 131_072 },
  // 旧名别名（normalize 迁移前的历史存储名，防首次升级瞬间查询漏配）
  "智谱 glm": { providerDefault: 131_072, models: { "glm-5.3": 131_072, "glm-5.2": 131_072, "glm-5.1": 131_072, "glm-5-turbo": 131_072, "glm-4.7": 131_072 } },
  "通义千问（dashscope）": { providerDefault: 32_768, models: { "qwen-max": 32_768, "qwen-plus": 131_072, "qwen-turbo": 1_048_576 } },
  "通义千问": { providerDefault: 32_768, models: { "qwen-max": 32_768, "qwen-plus": 131_072, "qwen-turbo": 1_048_576 } },
};

/** 小写化并去首尾空白。 */
function normalizeKey(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * 按（厂商, 模型）解析上下文窗口长度。
 * - 模型精确命中 → 返回该模型值
 * - 否则厂商命中 → 返回 providerDefault
 * - 否则 → undefined（调用方回退全局默认值）
 */
export function lookupModelContextWindow(provider: string, model: string): number | undefined {
  const providerKey = normalizeKey(provider);
  const entry = CONTEXT_WINDOW_CATALOG[providerKey];
  if (!entry) return undefined;

  const modelKey = normalizeKey(model);
  if (modelKey && entry.models) {
    const hit = entry.models[modelKey];
    if (typeof hit === "number") return hit;
  }
  return entry.providerDefault;
}

/** 供测试/调试查看的已收录厂商数。 */
export function getCatalogSize(): number {
  return Object.keys(CONTEXT_WINDOW_CATALOG).length;
}
