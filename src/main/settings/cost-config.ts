/**
 * 成本配置与预算告警
 *
 * 存储：<userData>/cost-config.json
 * 字段：
 *   monthlyBudgetUsd — 月度预算（美元）；0 = 关闭告警
 *   exchangeRate     — 美元→人民币汇率（Token 面板人民币结算显示用）
 *   lastAlertMonth   — 上次告警月份（YYYY-MM），保证每月最多通知一次
 *
 * 人民币结算：成本计算模块统一以美元为准，展示时按 exchangeRate 换算为人民币。
 * 预算告警：月度成本超过 monthlyBudgetUsd 时投递桌面通知（每月一次），
 * 持久化 lastAlertMonth 避免重复打扰。
 */

import { app, Notification } from "electron";
import * as fs from "fs";
import * as path from "path";
import { DEFAULT_USD_CNY_RATE, calculateDayCost } from "../orchestrator/cost-calculator";
import { getCurrentMonthDays } from "../token-usage-store";

export interface CostConfig {
  monthlyBudgetUsd: number;
  exchangeRate: number;
  lastAlertMonth: string | null;
}

export interface BudgetAlertState {
  /** 是否启用了预算（预算 > 0）。 */
  enabled: boolean;
  /** 当前自然月已消耗成本（美元）。 */
  monthCostUsd: number;
  /** 月度预算（美元）。 */
  budgetUsd: number;
  /** 本月成本是否已超过预算。 */
  exceeded: boolean;
  /** 已用预算比例（0-1+）；未启用时为 0。 */
  ratio: number;
}

const DEFAULT_CONFIG: CostConfig = {
  monthlyBudgetUsd: 0,
  exchangeRate: DEFAULT_USD_CNY_RATE,
  lastAlertMonth: null,
};

let cache: CostConfig | null = null;

function getFilePath(): string {
  return path.join(app.getPath("userData"), "cost-config.json");
}

function sanitize(raw: unknown): CostConfig {
  const p = (raw ?? {}) as Partial<CostConfig>;
  return {
    monthlyBudgetUsd:
      typeof p.monthlyBudgetUsd === "number" && Number.isFinite(p.monthlyBudgetUsd) && p.monthlyBudgetUsd >= 0
        ? p.monthlyBudgetUsd
        : DEFAULT_CONFIG.monthlyBudgetUsd,
    exchangeRate:
      typeof p.exchangeRate === "number" && Number.isFinite(p.exchangeRate) && p.exchangeRate > 0
        ? p.exchangeRate
        : DEFAULT_USD_CNY_RATE,
    lastAlertMonth: typeof p.lastAlertMonth === "string" ? p.lastAlertMonth : null,
  };
}

function load(): CostConfig {
  if (cache) return cache;
  try {
    if (fs.existsSync(getFilePath())) {
      const raw = JSON.parse(fs.readFileSync(getFilePath(), "utf8")) as unknown;
      cache = sanitize(raw);
      return cache;
    }
  } catch (err) {
    console.warn("[cost-config] 加载失败，使用默认值:", err);
  }
  cache = { ...DEFAULT_CONFIG };
  return cache;
}

function flush(): void {
  const filePath = getFilePath();
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  try {
    fs.writeFileSync(filePath + ".tmp", JSON.stringify(load(), null, 2), "utf8");
    fs.renameSync(filePath + ".tmp", filePath);
  } catch (err) {
    console.warn("[cost-config] 落盘失败:", err);
  }
}

/** 当前配置副本（外部修改不影响内部缓存）。 */
export function getCostConfig(): CostConfig {
  return { ...load() };
}

/** 保存配置；无效字段忽略。返回保存后的配置副本。 */
export function saveCostConfig(partial: Partial<CostConfig>): CostConfig {
  const current = load();
  if (typeof partial.monthlyBudgetUsd === "number" && Number.isFinite(partial.monthlyBudgetUsd)) {
    current.monthlyBudgetUsd = Math.max(0, partial.monthlyBudgetUsd);
  }
  if (typeof partial.exchangeRate === "number" && Number.isFinite(partial.exchangeRate) && partial.exchangeRate > 0) {
    current.exchangeRate = partial.exchangeRate;
  }
  if (partial.lastAlertMonth !== undefined) {
    current.lastAlertMonth = partial.lastAlertMonth;
  }
  flush();
  return { ...current };
}

/** 当前自然月成本（美元），按模型拆分汇总。 */
export function getCurrentMonthCostUsd(): number {
  let total = 0;
  for (const { day } of getCurrentMonthDays()) {
    const cost = calculateDayCost(day);
    if (cost) total += cost.totalCost;
  }
  return Number(total.toFixed(6));
}

/** 当前自然月标识（YYYY-MM）。 */
export function currentMonthKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** 评估当前预算告警状态（纯计算，不投递通知）。 */
export function evaluateBudgetAlert(config = getCostConfig()): BudgetAlertState {
  const monthCostUsd = getCurrentMonthCostUsd();
  const enabled = config.monthlyBudgetUsd > 0;
  return {
    enabled,
    monthCostUsd,
    budgetUsd: config.monthlyBudgetUsd,
    exceeded: enabled && monthCostUsd > config.monthlyBudgetUsd,
    ratio: enabled ? monthCostUsd / config.monthlyBudgetUsd : 0,
  };
}

/**
 * 预算超限时投递桌面通知（每月最多一次）。
 * 返回是否真正发出了通知。
 */
export function maybeNotifyBudgetExceeded(): boolean {
  const config = getCostConfig();
  const state = evaluateBudgetAlert(config);
  if (!state.enabled || !state.exceeded) return false;
  const month = currentMonthKey();
  if (config.lastAlertMonth === month) return false;
  saveCostConfig({ lastAlertMonth: month });
  try {
    const notification = new Notification({
      title: "本月 API 预算已超限",
      body: `本月已消耗约 ${state.monthCostUsd.toFixed(2)} 美元（约 ¥${(state.monthCostUsd * config.exchangeRate).toFixed(2)}），超过月度预算 ${state.budgetUsd.toFixed(2)} 美元。可在「设置 → Token 用量」查看详情。`,
      silent: false,
    });
    notification.show();
    return true;
  } catch (err) {
    console.error("[cost-config] 预算告警通知失败:", err);
    return false;
  }
}
