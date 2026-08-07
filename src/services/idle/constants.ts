/** Idle 检测阈值（毫秒） */
export const IDLE_THRESHOLDS = {
  /** 短空闲：5分钟，用于 LLM 上下文提示 */
  short: 5 * 60 * 1000,
  /** 中空闲：6分钟，用于行为系统派发 IDLE 事件 */
  medium: 6 * 60 * 1000,
  /** 长空闲：30分钟，用于主动陪伴调度器 */
  long: 30 * 60 * 1000,
} as const;
