/**
 * 成本计算模块
 *
 * 基于 token-usage-store 的用量数据 + model-pricing 的单价配置，
 * 计算 API 调用成本（美元）。
 *
 * 计算公式：
 *   cost = (inputTokens / 1_000_000) * inputPrice
 *        + (outputTokens / 1_000_000) * outputPrice
 *        + (cacheHitTokens / 1_000_000) * cacheHitPrice
 *        + (cacheCreationTokens / 1_000_000) * cacheCreationPrice
 *
 * 设计原则：
 * - 纯函数，无副作用，易于测试
 * - 未匹配定价的模型返回 null（不显示成本）
 * - 精度保留 6 位小数（避免浮点误差累积）
 * - 完全可逆：移除本模块不影响 token 用量追踪
 */

import { getModelPricing, type ModelPricing } from "./model-pricing";
import type { TokenUsageDay, TokenUsageModel } from "../token-usage-store";

export interface CostBreakdown {
  /** 输入 token 成本（美元） */
  inputCost: number;
  /** 输出 token 成本（美元） */
  outputCost: number;
  /** 缓存命中 token 成本（美元） */
  cacheHitCost: number;
  /** 缓存创建 token 成本（美元） */
  cacheCreationCost: number;
  /** 总成本（美元） */
  totalCost: number;
}

const TOKENS_PER_UNIT = 1_000_000;
const ROUND_PRECISION = 6;

function round(value: number): number {
  return Number(value.toFixed(ROUND_PRECISION));
}

/**
 * 根据 token 用量和定价计算成本明细。
 */
export function calculateCost(
  inputTokens: number,
  outputTokens: number,
  pricing: ModelPricing,
  cacheHitTokens = 0,
  cacheCreationTokens = 0,
): CostBreakdown {
  const inputCost = (inputTokens / TOKENS_PER_UNIT) * pricing.inputPrice;
  const outputCost = (outputTokens / TOKENS_PER_UNIT) * pricing.outputPrice;
  const cacheHitPrice = pricing.cacheHitPrice ?? pricing.inputPrice * 0.5;
  const cacheCreationPrice = pricing.cacheCreationPrice ?? pricing.inputPrice * 1.25;
  const cacheHitCost = (cacheHitTokens / TOKENS_PER_UNIT) * cacheHitPrice;
  const cacheCreationCost = (cacheCreationTokens / TOKENS_PER_UNIT) * cacheCreationPrice;
  const totalCost = inputCost + outputCost + cacheHitCost + cacheCreationCost;

  return {
    inputCost: round(inputCost),
    outputCost: round(outputCost),
    cacheHitCost: round(cacheHitCost),
    cacheCreationCost: round(cacheCreationCost),
    totalCost: round(totalCost),
  };
}

/**
 * 根据模型名和 token 用量计算成本。
 * 模型未匹配定价时返回 null。
 */
export function calculateCostForModel(
  modelName: string,
  inputTokens: number,
  outputTokens: number,
  cacheHitTokens = 0,
  cacheCreationTokens = 0,
): CostBreakdown | null {
  const pricing = getModelPricing(modelName);
  if (!pricing) return null;
  return calculateCost(inputTokens, outputTokens, pricing, cacheHitTokens, cacheCreationTokens);
}

/**
 * 计算单日用量的总成本（按模型拆分后汇总）。
 * 如果某天没有按模型拆分的数据（旧版 v1 数据），尝试用"未归类"匹配。
 * 返回 null 表示所有模型都未匹配定价。
 */
export function calculateDayCost(day: TokenUsageDay): CostBreakdown | null {
  if (day.models && Object.keys(day.models).length > 0) {
    let total: CostBreakdown = { inputCost: 0, outputCost: 0, cacheHitCost: 0, cacheCreationCost: 0, totalCost: 0 };
    let hasAnyPricing = false;
    for (const [modelName, modelUsage] of Object.entries(day.models)) {
      const cost = calculateCostForModel(
        modelName,
        modelUsage.input,
        modelUsage.output,
        modelUsage.hit,
        modelUsage.cacheCreation,
      );
      if (cost) {
        hasAnyPricing = true;
        total = {
          inputCost: round(total.inputCost + cost.inputCost),
          outputCost: round(total.outputCost + cost.outputCost),
          cacheHitCost: round(total.cacheHitCost + cost.cacheHitCost),
          cacheCreationCost: round(total.cacheCreationCost + cost.cacheCreationCost),
          totalCost: round(total.totalCost + cost.totalCost),
        };
      }
    }
    return hasAnyPricing ? total : null;
  }

  // 旧版数据：没有按模型拆分，无法确定定价，返回 null
  return null;
}

/**
 * 计算单个模型用量的成本。
 */
export function calculateModelCost(modelName: string, usage: TokenUsageModel): CostBreakdown | null {
  return calculateCostForModel(modelName, usage.input, usage.output, usage.hit, usage.cacheCreation);
}

/** 默认美元→人民币汇率（可在 Token 面板覆盖）。 */
export const DEFAULT_USD_CNY_RATE = 7.2;

/**
 * 格式化成本为可读字符串。
 * - >= 1: 保留 2 位小数（$1.23 / ¥8.86）
 * - >= 0.01: 保留 4 位小数（$0.0123）
 * - < 0.01: 保留 6 位小数（$0.000123）
 * @param currency 货币符号；"CNY" 输出 ¥，其余输出 $。
 */
export function formatCost(cost: number, currency: "USD" | "CNY" = "USD"): string {
  const symbol = currency === "CNY" ? "¥" : "$";
  if (cost >= 1) return `${symbol}${cost.toFixed(2)}`;
  if (cost >= 0.01) return `${symbol}${cost.toFixed(4)}`;
  return `${symbol}${cost.toFixed(6)}`;
}

/** 美元按汇率换算为人民币（保留 6 位小数，避免浮点误差累积）。 */
export function usdToCny(usd: number, rate: number): number {
  return round(usd * rate);
}
