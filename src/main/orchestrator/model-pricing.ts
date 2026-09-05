/**
 * 模型定价配置
 *
 * 价格单位：美元 / 1M tokens（行业标准单位）
 * - inputPrice: 输入 token 单价
 * - outputPrice: 输出 token 单价
 * - cacheHitPrice: 缓存命中 token 单价（通常为 input 的折扣价）
 *
 * 设计原则：
 * - 内置常见模型默认价（按模型名模糊匹配）
 * - 未匹配模型返回 null（调用方决定是否显示成本）
 * - 价格可被用户配置覆盖（后续扩展）
 * - 完全可逆：移除本模块不影响 token 用量追踪
 */

export interface ModelPricing {
  /** 输入 token 单价（美元 / 1M tokens） */
  inputPrice: number;
  /** 输出 token 单价（美元 / 1M tokens） */
  outputPrice: number;
  /** 缓存命中 token 单价（美元 / 1M tokens），默认 = inputPrice * 0.5 */
  cacheHitPrice?: number;
  /** 缓存创建 token 单价（美元 / 1M tokens），默认 = inputPrice * 1.25 */
  cacheCreationPrice?: number;
}

interface PricingEntry {
  /** 模型名匹配模式（小写、包含匹配） */
  pattern: string;
  pricing: ModelPricing;
}

/**
 * 内置常见模型定价（2026 年公开价，仅供参考）。
 * 按 pattern 小写包含匹配，先匹配先生效。
 * 用户自定义模型未匹配时返回 null。
 */
const BUILTIN_PRICING: PricingEntry[] = [
  // OpenAI
  { pattern: "gpt-4o", pricing: { inputPrice: 2.5, outputPrice: 10.0, cacheHitPrice: 1.25, cacheCreationPrice: 3.75 } },
  { pattern: "gpt-4.1", pricing: { inputPrice: 2.0, outputPrice: 8.0, cacheHitPrice: 0.5, cacheCreationPrice: 2.5 } },
  { pattern: "gpt-4-turbo", pricing: { inputPrice: 10.0, outputPrice: 30.0, cacheHitPrice: 5.0, cacheCreationPrice: 12.5 } },
  { pattern: "o1", pricing: { inputPrice: 15.0, outputPrice: 60.0, cacheHitPrice: 7.5, cacheCreationPrice: 18.75 } },
  { pattern: "o3", pricing: { inputPrice: 10.0, outputPrice: 40.0, cacheHitPrice: 5.0, cacheCreationPrice: 12.5 } },

  // Anthropic
  { pattern: "claude-3-5-sonnet", pricing: { inputPrice: 3.0, outputPrice: 15.0, cacheHitPrice: 0.3, cacheCreationPrice: 3.75 } },
  { pattern: "claude-3.5-sonnet", pricing: { inputPrice: 3.0, outputPrice: 15.0, cacheHitPrice: 0.3, cacheCreationPrice: 3.75 } },
  { pattern: "claude-3-5-haiku", pricing: { inputPrice: 0.8, outputPrice: 4.0, cacheHitPrice: 0.08, cacheCreationPrice: 1.0 } },
  { pattern: "claude-3.5-haiku", pricing: { inputPrice: 0.8, outputPrice: 4.0, cacheHitPrice: 0.08, cacheCreationPrice: 1.0 } },
  { pattern: "claude-3-opus", pricing: { inputPrice: 15.0, outputPrice: 75.0, cacheHitPrice: 1.5, cacheCreationPrice: 18.75 } },
  { pattern: "claude-3-sonnet", pricing: { inputPrice: 3.0, outputPrice: 15.0, cacheHitPrice: 0.3, cacheCreationPrice: 3.75 } },
  { pattern: "claude-3-haiku", pricing: { inputPrice: 0.25, outputPrice: 1.25, cacheHitPrice: 0.03, cacheCreationPrice: 0.31 } },

  // DeepSeek
  { pattern: "deepseek-chat", pricing: { inputPrice: 0.27, outputPrice: 1.10, cacheHitPrice: 0.07, cacheCreationPrice: 0.34 } },
  { pattern: "deepseek-reasoner", pricing: { inputPrice: 0.55, outputPrice: 2.19, cacheHitPrice: 0.14, cacheCreationPrice: 0.69 } },

  // MiniMax
  { pattern: "minimax-m2", pricing: { inputPrice: 0.3, outputPrice: 1.2, cacheHitPrice: 0.15, cacheCreationPrice: 0.38 } },
  { pattern: "minimax", pricing: { inputPrice: 0.5, outputPrice: 2.0, cacheHitPrice: 0.25, cacheCreationPrice: 0.63 } },

  // 智谱 GLM
  { pattern: "glm-4-plus", pricing: { inputPrice: 0.7, outputPrice: 5.6, cacheHitPrice: 0.35, cacheCreationPrice: 0.88 } },
  { pattern: "glm-4", pricing: { inputPrice: 0.7, outputPrice: 5.6, cacheHitPrice: 0.35, cacheCreationPrice: 0.88 } },
  { pattern: "glm-3", pricing: { inputPrice: 0.05, outputPrice: 0.35, cacheHitPrice: 0.025, cacheCreationPrice: 0.06 } },

  // 通义千问
  { pattern: "qwen-max", pricing: { inputPrice: 0.8, outputPrice: 8.0, cacheHitPrice: 0.4, cacheCreationPrice: 1.0 } },
  { pattern: "qwen-plus", pricing: { inputPrice: 0.3, outputPrice: 1.2, cacheHitPrice: 0.15, cacheCreationPrice: 0.38 } },
  { pattern: "qwen-turbo", pricing: { inputPrice: 0.08, outputPrice: 0.3, cacheHitPrice: 0.04, cacheCreationPrice: 0.1 } },

  // Kimi (月之暗面)
  { pattern: "kimi-k2", pricing: { inputPrice: 0.3, outputPrice: 2.0, cacheHitPrice: 0.15, cacheCreationPrice: 0.38 } },
  { pattern: "moonshot", pricing: { inputPrice: 0.3, outputPrice: 2.0, cacheHitPrice: 0.15, cacheCreationPrice: 0.38 } },

  // 豆包 (火山方舟)
  { pattern: "doubao-1.5-pro", pricing: { inputPrice: 0.8, outputPrice: 2.0, cacheHitPrice: 0.4, cacheCreationPrice: 1.0 } },
  { pattern: "doubao-1.5-lite", pricing: { inputPrice: 0.3, outputPrice: 0.6, cacheHitPrice: 0.15, cacheCreationPrice: 0.38 } },
  { pattern: "doubao", pricing: { inputPrice: 0.5, outputPrice: 1.5, cacheHitPrice: 0.25, cacheCreationPrice: 0.63 } },
];

/** 用户自定义定价覆盖（后续可从 settings 加载）。 */
let customPricing: PricingEntry[] = [];

/** 设置用户自定义定价覆盖（会优先于内置定价匹配）。 */
export function setCustomPricing(entries: PricingEntry[]): void {
  customPricing = [...entries];
}

/** 清空用户自定义定价。 */
export function clearCustomPricing(): void {
  customPricing = [];
}

/**
 * 根据模型名查找定价。
 * - 先匹配自定义定价，再匹配内置定价
 * - 匹配规则：模型名小写后包含 pattern
 * - 未匹配返回 null（调用方决定是否显示成本）
 */
export function getModelPricing(modelName: string): ModelPricing | null {
  if (!modelName || !modelName.trim()) return null;
  const lower = modelName.toLowerCase().trim();

  // 自定义定价优先
  for (const entry of customPricing) {
    if (lower.includes(entry.pattern.toLowerCase())) {
      return { ...entry.pricing };
    }
  }

  // 内置定价
  for (const entry of BUILTIN_PRICING) {
    if (lower.includes(entry.pattern.toLowerCase())) {
      return { ...entry.pricing };
    }
  }

  return null;
}

/** 获取所有内置定价条目（用于 UI 展示/调试）。 */
export function getBuiltinPricingEntries(): ReadonlyArray<PricingEntry> {
  return BUILTIN_PRICING;
}
