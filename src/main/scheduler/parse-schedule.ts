// parse-schedule.ts —— 把 LLM 生成的调度字符串解析为 ScheduleConfig
// 移植 Hermes cron/jobs.py 的 parse_schedule，语义对齐：
//   "30m" / "2h" / "1d"          → 从现在起一次（once）
//   "every 30m" / "every 2h"     → 周期间隔（interval）
//   "0 9 * * *"                  → 标准 5 字段 cron 表达式（cron）
//   "2026-09-06T09:00"           → 指定时间一次（once）
//
// 与 Hermes 的差异（有意为之）：
// - Hermes 用 croniter 支持 5/6 字段（6 字段第 6 位是年）；本项目用 croner（纯 JS），
//   仅支持 5 字段 cron。带年字段的表达式直接报错，避免静默吞掉用户意图。
// - 间隔输出收敛到本项目的 interval 模型（every + minutes/hours），超 1 天请用 cron。

import { Cron } from "croner";
import type { ScheduleConfig } from "./types";

/** "30m" / "2h" / "1d" → 分钟数（Hermes parse_duration：m=1, h=60, d=1440）。 */
export function parseDuration(value: string): number {
  const match = /^(\d+)\s*([mhd])$/i.exec(String(value).trim());
  if (!match) throw new Error(`无效时长 '${value}'（格式：30m / 2h / 1d）`);
  const n = Number(match[1]);
  const multipliers = { m: 1, h: 60, d: 1440 } as const;
  const minutes = n * multipliers[match[2].toLowerCase() as keyof typeof multipliers];
  if (!Number.isInteger(minutes) || minutes <= 0) throw new Error(`无效时长 '${value}'`);
  return minutes;
}

/** 分钟数 → interval 配置；非整小时且超过一天上限时报错（请改用 cron）。 */
function toInterval(minutes: number, original: string): ScheduleConfig {
  if (minutes % 60 === 0) {
    return { kind: "interval", every: minutes / 60, unit: "hours" };
  }
  if (minutes > 1440) {
    throw new Error(`间隔 '${original}' 超过 1 天且不是整小时，请改用 cron 表达式（如 '0 9 * * *'）`);
  }
  return { kind: "interval", every: minutes, unit: "minutes" };
}

const CRON_FIELD_RE = /^[\d*\-,/]+$/;
const YEAR_RE = /^\d{4}$/;

function parseCronExpr(raw: string, parts: string[]): ScheduleConfig {
  const head = parts.slice(0, 5);
  if (head.some((p) => !CRON_FIELD_RE.test(p))) {
    throw new Error(`无效 cron 表达式 '${raw}'`);
  }
  const tail = parts.slice(5);
  if (tail.length > 0) {
    const extra = tail.join(" ");
    if (tail.length === 1 && YEAR_RE.test(tail[0])) {
      throw new Error(`cron 表达式 '${raw}' 带年字段（${tail[0]}），本项目仅支持 5 字段 cron`);
    }
    throw new Error(`cron 表达式 '${raw}' 字段过多：'${extra}' 无法识别`);
  }
  const expr = head.join(" ");
  try {
    new Cron(expr); // 仅校验；next-run 计算在 schedule-calculator 里做
  } catch (err) {
    throw new Error(`无效 cron 表达式 '${expr}': ${err instanceof Error ? err.message : String(err)}`);
  }
  return { kind: "cron", expr };
}

/**
 * 解析调度字符串为 ScheduleConfig。解析失败抛 Error（错误消息给 LLM 看，指导重试）。
 */
export function parseSchedule(schedule: string): ScheduleConfig {
  const raw = String(schedule ?? "").trim();
  if (!raw) throw new Error("调度字符串不能为空");
  const lower = raw.toLowerCase();

  // "every X" → 周期间隔
  if (lower.startsWith("every ")) {
    const minutes = parseDuration(raw.slice(6).trim());
    return toInterval(minutes, raw);
  }

  // 5 字段 cron 表达式
  const parts = raw.split(/\s+/);
  if (parts.length >= 5 && parts.length <= 6 && parts.slice(0, 5).every((p) => CRON_FIELD_RE.test(p))) {
    return parseCronExpr(raw, parts);
  }

  // ISO 时间戳 / 日期 → once
  if (raw.includes("T") || /^\d{4}-\d{2}-\d{2}/.test(raw)) {
    const runAt = new Date(raw);
    if (Number.isNaN(runAt.getTime())) throw new Error(`无效时间 '${raw}'`);
    return { kind: "once", runAt: runAt.toISOString() };
  }

  // 时长 "30m" / "2h" / "1d" → 从现在起一次
  try {
    const minutes = parseDuration(raw);
    return { kind: "once", runAt: new Date(Date.now() + minutes * 60_000).toISOString() };
  } catch { /* 落入最后的报错 */ }

  throw new Error(
    `无法识别的调度 '${raw}'。请使用：` +
      `'30m'/'2h'/'1d'（一次性）、'every 30m'/'every 2h'（周期）、` +
      `'0 9 * * *'（5 字段 cron 表达式）或 '2026-09-06T09:00'（指定时间）`,
  );
}
