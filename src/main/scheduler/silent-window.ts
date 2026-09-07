/**
 * 定时任务投递静默时段判定。
 * 纯函数，无运行时依赖。配置为空字符串 = 未启用。
 */

/** 静默时段配置：start/end 均为 "HH:MM"。 */
export interface SilentWindow {
  start: string;
  end: string;
}

/** 解析 "HH:MM" 为当天分钟数（0~1439）；非法或空字符串返回 null。 */
export function parseTimeOfDay(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/**
 * 判断 now 是否落在静默时段内。
 * - start/end 任一非法（含空串）→ 未启用，返回 false
 * - start === end → 空窗口，返回 false
 * - 支持跨午夜（如 23:00-06:00）：当前分钟 >= start 或 < end 均视为静默
 */
export function isInSilentWindow(window: SilentWindow, now: Date): boolean {
  const start = parseTimeOfDay(window.start);
  const end = parseTimeOfDay(window.end);
  if (start === null || end === null) return false;
  if (start === end) return false;
  const minutes = now.getHours() * 60 + now.getMinutes();
  if (start < end) return minutes >= start && minutes < end;
  return minutes >= start || minutes < end;
}
