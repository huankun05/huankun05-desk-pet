/**
 * 行为系统类型定义
 *
 * 事件驱动 Handler + 过滤器链，借鉴 AstrBot 插件机制设计。
 */

import type { ChatMessage } from '../provider/types';

// ===== EventType 枚举 =====

export enum EventType {
  /** 宠物启动完成 */
  INIT = 'init',
  /** 用户发送消息 */
  MESSAGE_SENT = 'message:sent',
  /** AI 回复完成 */
  MESSAGE_RESPONSE = 'message:response',
  /** 情感状态变化 */
  EMOTION_CHANGED = 'emotion:changed',
  /** 空闲一段时间（可配置） */
  IDLE = 'idle',
  /** 双击宠物 */
  DOUBLE_CLICK = 'double_click',
  /** 长按宠物 */
  LONG_PRESS = 'long_press',
  /** 窗口获得焦点 */
  WINDOW_FOCUS = 'window:focus',
  /** 窗口失去焦点 */
  WINDOW_BLUR = 'window:blur',
  /** 定时器触发 */
  TIMER = 'timer',
  /** 系统唤醒（从睡眠恢复） */
  SYSTEM_WAKE = 'system:wake',
  /** 好感度变化 */
  FAVORABILITY_CHANGED = 'favorability:changed',
  /** 人设切换 */
  PERSONA_CHANGED = 'persona:changed',
  /** 用户手势识别结果 */
  PERCEPTION_GESTURE = 'perception:gesture',
  /** 用户面部表情识别结果 */
  PERCEPTION_FACE_EXPR = 'perception:face_expr',
  /** 用户拍打头部 */
  INTERACTION_PAT = 'interaction:pat',
  /** 用户点击身体 */
  INTERACTION_TAP = 'interaction:tap',
  /** 用户戳脚 */
  INTERACTION_STEP = 'interaction:step',
}

// ===== 过滤器 =====

export enum FilterAction {
  Pass = 'pass',
  Block = 'block',
  Skip = 'skip',
}

export interface HandlerFilter {
  /** 过滤器名称 */
  name: string;
  /** 优先级（数字越小越先执行） */
  priority: number;
  /** 过滤检查，返回 Pass 则继续下一个 Handler */
  check: (event: EventType, payload: unknown) => FilterAction | Promise<FilterAction>;
}

/** 正则匹配过滤器 */
export class RegexFilter implements HandlerFilter {
  name = 'regex';
  priority = 10;
  private pattern: RegExp;

  constructor(pattern: RegExp) {
    this.pattern = pattern;
  }

  check(event: EventType, payload: unknown): FilterAction {
    if (event !== EventType.MESSAGE_SENT) return FilterAction.Pass;
    const text = (payload as { text?: string })?.text ?? '';
    return this.pattern.test(text) ? FilterAction.Pass : FilterAction.Skip;
  }
}

/** 好感度过滤器 */
export class FavorabilityFilter implements HandlerFilter {
  name = 'favorability';
  priority = 20;
  private minLevel: number;

  constructor(minLevel = 30) {
    this.minLevel = minLevel;
  }

  check(_event: EventType, payload: unknown): FilterAction {
    const fav = (payload as { favorability?: number })?.favorability ?? 0;
    return fav >= this.minLevel ? FilterAction.Pass : FilterAction.Block;
  }
}

/** 事件类型匹配过滤器 */
export class CommandFilter implements HandlerFilter {
  name = 'command';
  priority = 5;
  private allowedEvents: EventType[];

  constructor(allowedEvents: EventType[]) {
    this.allowedEvents = allowedEvents;
  }

  check(event: EventType, _payload: unknown): FilterAction {
    return this.allowedEvents.includes(event) ? FilterAction.Pass : FilterAction.Skip;
  }
}

/** 自定义过滤器 */
export class CustomFilter implements HandlerFilter {
  name: string;
  priority: number;
  private fn: (event: EventType, payload: unknown) => FilterAction | Promise<FilterAction>;

  constructor(
    name: string,
    priority: number,
    fn: (event: EventType, payload: unknown) => FilterAction | Promise<FilterAction>,
  ) {
    this.name = name;
    this.priority = priority;
    this.fn = fn;
  }

  check(event: EventType, payload: unknown): FilterAction | Promise<FilterAction> {
    return this.fn(event, payload);
  }
}

// ===== Handler =====

export interface BehaviorHandler {
  /** 监听的事件类型 */
  eventType: EventType;
  /** 优先级（数字越小越先执行） */
  priority: number;
  /** 过滤器链（全部 Pass 才执行 handler） */
  filters?: HandlerFilter[];
  /** 执行函数 */
  handler: (payload: unknown) => void | Promise<void>;
}

// ===== Context 类型（重新导出） =====

export type { ChatMessage };
