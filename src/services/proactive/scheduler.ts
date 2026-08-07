/**
 * ProactiveScheduler — 主动行为调度器
 *
 * 基于时间和事件触发桌面宠物的主动交互：
 * - 空闲检测 + 久未互动提醒
 * - 时间提醒（午餐/晚餐/深夜/早安）
 * - 情绪变化响应
 */

import { eventBus } from '../eventBus';
import { PROACTIVE_SCENES, type ProactiveScene } from '../../data/liveModePrompts';
import { createLogger } from '../../utils/logger';
import { IDLE_THRESHOLDS } from '../idle/constants';

const log = createLogger('ProactiveScheduler');

export interface ProactiveConfig {
  /** 是否启用主动行为 */
  enabled: boolean;
  /** 空闲检测间隔（毫秒） */
  idleCheckInterval: number;
  /** 久未互动阈值（毫秒，默认 30 分钟） */
  longIdleThreshold: number;
  /** 工作提醒阈值（毫秒，默认 1 小时） */
  workReminderThreshold: number;
  /** 主动消息间隔（毫秒，避免频繁打扰） */
  messageCooldown: number;
  /** 每日主动消息上限 */
  dailyLimit: number;
}

const DEFAULT_CONFIG: ProactiveConfig = {
  enabled: false,
  idleCheckInterval: 60000,
  longIdleThreshold: IDLE_THRESHOLDS.long,
  workReminderThreshold: 60 * 60 * 1000,
  messageCooldown: 5 * 60 * 1000,
  dailyLimit: 24,
};

export type ProactiveTrigger = {
  scene: ProactiveScene;
  reason: string;
};

export type ProactiveCallback = (trigger: ProactiveTrigger) => void;

export class ProactiveScheduler {
  config: ProactiveConfig;
  private lastInteractionTime: number;
  private lastProactiveTime: number;
  private dailyCount: number;
  private dailyResetDate: string;
  private checkTimer: ReturnType<typeof setInterval> | null;
  private callbacks: Set<ProactiveCallback>;
  private unsubscribers: Array<() => void>;
  /** 标记当天首次互动是否已触发早安问候 */
  private morningGreeted: boolean;
  /** 最近用户消息历史（用于上下文感知） */
  private recentUserMessages: string[] = [];
  /** 最近情感趋势（positive/negative/neutral） */
  private emotionTrend: 'positive' | 'negative' | 'neutral' = 'neutral';
  private lastEmotionCheck = 0;
  private emotionCheckInterval = 5 * 60 * 1000; // 每 5 分钟检查一次

  constructor(config: Partial<ProactiveConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.lastInteractionTime = Date.now();
    this.lastProactiveTime = 0;
    this.dailyCount = 0;
    this.dailyResetDate = this.todayKey();
    this.checkTimer = null;
    this.callbacks = new Set();
    this.unsubscribers = [];
    this.morningGreeted = false;
  }

  private todayKey(): string {
    const d = new Date();
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  }

  /** 注册回调：当触发主动行为时调用 */
  onTrigger(cb: ProactiveCallback): () => void {
    this.callbacks.add(cb);
    return () => this.callbacks.delete(cb);
  }

  /** 开始在事件总线上监听 + 启动定时检查 */
  start(): void {
    if (!this.config.enabled) return;
    log.info('ProactiveScheduler started');

    // 监听用户交互事件（刷新 lastInteractionTime + 追踪上下文）
    this.unsubscribers.push(
      eventBus.on('message:sent', (payload) => {
        this.lastInteractionTime = Date.now();
        const p = payload as { text?: string };
        if (p.text) {
          this.recordUserMessage(p.text);
        }
      }),
      eventBus.on('message:response', () => {
        this.lastInteractionTime = Date.now();
      }),
      eventBus.on('emotion:changed', (payload) => {
        // 如果情绪变差，触发安慰场景
        const intensity = (payload as unknown as { intensity?: number })?.intensity;
        const emotion = (payload as unknown as { emotion?: string })?.emotion;
        if (
          emotion &&
          ['sad', 'angry', 'lonely', 'upset'].includes(emotion) &&
          (intensity ?? 0) > 0.5
        ) {
          this.tryTrigger('mood_change', '检测到情绪变化');
        }
      }),
    );

    // 定时检查
    this.checkTimer = setInterval(() => this.tick(), this.config.idleCheckInterval);
  }

  /** 停止调度器 */
  stop(): void {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }
    for (const unsub of this.unsubscribers) {
      unsub();
    }
    this.unsubscribers = [];
    log.info('ProactiveScheduler stopped');
  }

  /** 更新配置 */
  updateConfig(partial: Partial<ProactiveConfig>): void {
    const wasEnabled = this.config.enabled;
    this.config = { ...this.config, ...partial };
    if (!wasEnabled && this.config.enabled) {
      this.start();
    } else if (wasEnabled && !this.config.enabled) {
      this.stop();
    }
  }

  /** 手动触发交互（如用户点击角色时调用） */
  onInteraction(): void {
    this.lastInteractionTime = Date.now();
  }

  /** 记录用户消息（用于上下文感知的主动行为） */
  recordUserMessage(text: string): void {
    this.recentUserMessages.push(text);
    if (this.recentUserMessages.length > 10) {
      this.recentUserMessages = this.recentUserMessages.slice(-10);
    }
  }

  /** 更新情感趋势（由外部定期调用） */
  updateEmotionTrend(trend: 'positive' | 'negative' | 'neutral'): void {
    this.emotionTrend = trend;
    this.lastEmotionCheck = Date.now();
  }

  /** 获取上下文感知的额外提示 */
  getContextHints(): string[] {
    const hints: string[] = [];
    if (this.emotionTrend === 'negative') {
      hints.push('用户近期情绪偏低落，主动给予安慰');
    }
    if (this.emotionTrend === 'positive') {
      hints.push('用户近期情绪良好，可以更活泼');
    }
    const recent = this.recentUserMessages.slice(-3).join('、');
    if (recent) {
      hints.push(`最近话题：${recent}`);
    }
    return hints;
  }

  /** 定时检查逻辑 */
  private tick(): void {
    // 重置每日计数
    const today = this.todayKey();
    if (today !== this.dailyResetDate) {
      this.dailyResetDate = today;
      this.dailyCount = 0;
      this.morningGreeted = false;
    }

    if (this.dailyCount >= this.config.dailyLimit) return;

    // 冷却检查
    const now = Date.now();
    if (now - this.lastProactiveTime < this.config.messageCooldown) return;

    const idleDuration = now - this.lastInteractionTime;
    const hour = new Date().getHours();
    const minute = new Date().getMinutes();

    // 早安问候（首次检测到 7:00-9:00）
    if (!this.morningGreeted && hour >= 7 && hour < 9) {
      this.morningGreeted = true;
      this.tryTrigger('morning_greeting', '早安问候');
      return;
    }

    // 久未互动
    if (idleDuration > this.config.longIdleThreshold) {
      this.tryTrigger('idle_long', `已闲置 ${Math.round(idleDuration / 60000)} 分钟`);
      return;
    }

    // 休息提醒
    if (idleDuration > this.config.workReminderThreshold) {
      this.tryTrigger('work_reminder', `已连续活动 ${Math.round(idleDuration / 60000)} 分钟`);
      return;
    }

    // 午餐提醒
    if (hour === 12 && minute < 30) {
      this.tryTrigger('lunch_time', '午餐时间');
      return;
    }

    // 晚餐提醒
    if (hour === 18 || (hour === 19 && minute < 30)) {
      this.tryTrigger('dinner_time', '晚餐时间');
      return;
    }

    // 深夜提醒
    if (hour >= 23 || hour < 2) {
      this.tryTrigger('late_night', '深夜提醒');
      return;
    }
  }

  private tryTrigger(sceneId: string, reason: string): void {
    const scene = PROACTIVE_SCENES.find((s) => s.id === sceneId);
    if (!scene) return;
    if (this.dailyCount >= this.config.dailyLimit) return;

    this.lastProactiveTime = Date.now();
    this.dailyCount++;

    const trigger: ProactiveTrigger = { scene, reason };
    log.info('Proactive trigger', { scene: sceneId, reason, dailyCount: this.dailyCount });

    for (const cb of this.callbacks) {
      try {
        cb(trigger);
      } catch (err) {
        log.error('Proactive callback error', err);
      }
    }
  }
}

/** 全局单例 */
export const proactiveScheduler = new ProactiveScheduler();
