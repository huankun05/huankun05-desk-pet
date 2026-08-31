/**
 * ProactiveScheduler — 主动行为调度器
 *
 * 基于时间和事件触发桌面宠物的主动交互：
 * - 空闲检测 + 久未互动提醒
 * - 时间提醒（午餐/晚餐/深夜/早安）
 * - 情绪变化响应
 * - 上下文感知：注入最近话题/情绪趋势到主动消息生成
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
  /** 免打扰时段开关：开启后在时段内否决一切主动触发（硬闸，优先级高于任何场景） */
  quietHoursEnabled: boolean;
  /** 免打扰起始小时（0-23，含） */
  quietHoursStart: number;
  /** 免打扰结束小时（0-23，不含）；start > end 表示跨午夜，如 23 → 7 */
  quietHoursEnd: number;
  /** 廉价模型裁决开关：硬规则提案后，再由裁决器判断"此刻该不该说" */
  judgeEnabled: boolean;
}

const DEFAULT_CONFIG: ProactiveConfig = {
  enabled: false,
  idleCheckInterval: 60000,
  longIdleThreshold: IDLE_THRESHOLDS.long,
  workReminderThreshold: 60 * 60 * 1000,
  messageCooldown: 2 * 60 * 60 * 1000,
  dailyLimit: 12,
  quietHoursEnabled: true,
  quietHoursStart: 23,
  quietHoursEnd: 7,
  judgeEnabled: false,
};

export interface ProactiveTrigger {
  scene: ProactiveScene;
  reason: string;
  /** 上下文感知提示（最近话题/情绪趋势） */
  hints?: string[];
}

export type ProactiveCallback = (trigger: ProactiveTrigger) => void;

/** 裁决器输入：供廉价模型判断"此刻该不该主动说话" */
export interface ProactiveJudgeContext {
  scene: ProactiveScene;
  reason: string;
  hints: string[];
  /** 距上次互动的分钟数 */
  idleMinutes: number;
  /** 当前小时（0-23） */
  hour: number;
  /** 近期情感趋势 */
  emotionTrend: 'positive' | 'negative' | 'neutral';
  /** 今日已发出的主动消息条数 */
  todayCount: number;
  /** 今日与用户的对话轮次 */
  todayTurns: number;
  /** 昼夜节律主动系数（0-1，越小越应克制；供裁决器参考） */
  initiativeMultiplier: number;
}

/**
 * 裁决器：返回 true 放行、false 否决。
 *
 * 由外部注入（通常是一次廉价模型调用），调度器本身不依赖 aiService，
 * 避免循环依赖并保持可测试性。
 */
export type ProactiveJudge = (ctx: ProactiveJudgeContext) => Promise<boolean>;

/** 情感极性分类：仅使用 EmotionType 真实存在的取值 */
const NEGATIVE_EMOTIONS = ['sad', 'angry'] as const;
const POSITIVE_EMOTIONS = ['happy', 'excited', 'curious'] as const;

/** 情感趋势采样窗口（毫秒）：只看最近 30 分钟 */
const EMOTION_TREND_WINDOW = 30 * 60 * 1000;

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
  /** 标记当天是否已触发每日状态简报（21:00 一次） */
  private dailyBriefed: boolean;
  /** 当天与用户的对话轮次（每次收到用户消息 +1，供每日简报注入真实数据） */
  private todayTurns: number;
  /** 最近用户消息历史（用于上下文感知） */
  private recentUserMessages: string[] = [];
  /** 最近情感趋势（positive/negative/neutral） */
  private emotionTrend: 'positive' | 'negative' | 'neutral' = 'neutral';
  private lastEmotionCheck = 0;
  private lastEmotionTrigger = 0;
  private emotionTriggerCooldown = 30 * 60 * 1000;
  /**
   * 情感采样窗口：{ t: 时间戳, score: +1 正面 / -1 负面 }
   *
   * 由 `emotion:changed` 事件流自动填充，`emotionTrend` 据此实时推导，
   * 不再依赖外部调用 `updateEmotionTrend()`（历史上从未有调用方，
   * 导致趋势永远停留在 neutral、每日简报恒报"情绪平稳"）。
   */
  private emotionSamples: Array<{ t: number; score: number }> = [];
  /** 忙碌标志：语音通话/语音助手活跃/回复流式中为 true，忙碌时暂停一切主动触发 */
  private busy = false;
  /** 裁决器（可选）：硬规则提案后的第二道闸 */
  private judge: ProactiveJudge | null = null;
  /** 裁决进行中标志：防止 tick 在等待裁决期间重复提案 */
  private judging = false;
  /** 今日裁决调用次数（含被否决的），用于封顶裁决成本 */
  private judgeCallsToday = 0;
  /**
   * 昼夜节律主动系数（0-1，来自后端 circadian.initiative_multiplier）。
   *
   * 只缩放"随机主动"这条非必需通道的概率：深夜（0.3）时桌宠明显更克制，
   * 白天（1.0）正常。免打扰时段硬闸不受影响，仍优先于一切。
   */
  private circadianMultiplier = 1;

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
    this.dailyBriefed = false;
    this.todayTurns = 0;
    this.lastEmotionTrigger = 0;
    this.emotionTriggerCooldown = 30 * 60 * 1000;
  }

  /** 设置/清除忙碌状态（语音通话、语音助手、回复流式中调用；忙碌时暂停主动触发） */
  setBusy(busy: boolean): void {
    this.busy = busy;
  }

  /** 当前是否忙碌（对话/通话进行中，不应被主动消息打扰） */
  isBusy(): boolean {
    return this.busy;
  }

  /**
   * 注入/清除裁决器（廉价模型"该不该说"判断）。
   *
   * 仅在 `config.judgeEnabled` 为 true 时生效。裁决器抛错或超时按"放行"降级——
   * 硬规则已经判定该说，裁决只是额外的一道否决闸，不应因为它挂掉而让桌宠彻底沉默。
   */
  setJudge(judge: ProactiveJudge | null): void {
    this.judge = judge;
  }

  /**
   * 注入昼夜节律主动系数（0-1，来自后端 GET /api/core/time/circadian）。
   *
   * 由外部（MainPetApp）在启动与周期刷新时调用；后端不可用时保留上次值，默认 1。
   */
  setCircadianMultiplier(multiplier: number): void {
    this.circadianMultiplier = Number.isFinite(multiplier)
      ? Math.min(1, Math.max(0, multiplier))
      : this.circadianMultiplier;
  }

  /**
   * 是否处于免打扰时段（硬闸）。
   *
   * 支持跨午夜配置：start=23、end=7 表示 23:00–07:00 全程静默。
   */
  isQuietHours(at: Date = new Date()): boolean {
    if (!this.config.quietHoursEnabled) return false;
    const { quietHoursStart: start, quietHoursEnd: end } = this.config;
    if (start === end) return false; // 起止相同视为不启用，避免全天静默
    const hour = at.getHours();
    return start < end ? hour >= start && hour < end : hour >= start || hour < end; // 跨午夜
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
        this.todayTurns += 1;
        const p = payload as { text?: string };
        if (p.text) {
          this.recordUserMessage(p.text);
        }
      }),
      eventBus.on('message:response', () => {
        this.lastInteractionTime = Date.now();
      }),
      eventBus.on('emotion:changed', (payload) => {
        const intensity = (payload as unknown as { intensity?: number })?.intensity ?? 0;
        const emotion = (payload as unknown as { emotion?: string })?.emotion;

        // 采样先行：即使忙碌也要记录，趋势数据本身与"要不要打扰"无关
        this.recordEmotionSample(emotion, intensity);

        // 如果情绪变差，触发安慰场景（忙碌时跳过，避免打断对话）
        if (this.busy) return;
        if (
          emotion &&
          (NEGATIVE_EMOTIONS as readonly string[]).includes(emotion) &&
          intensity > 0.5 &&
          // 距上次互动超过短空闲阈值才触发：对话期间情绪波动不抢话
          Date.now() - this.lastInteractionTime > IDLE_THRESHOLDS.short
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

  /**
   * 手动覆盖情感趋势（保留给外部数据源，如后端 PAD 状态）。
   *
   * 正常情况下趋势由 `emotion:changed` 事件流自动推导，无需调用本方法。
   */
  updateEmotionTrend(trend: 'positive' | 'negative' | 'neutral'): void {
    this.emotionTrend = trend;
    this.lastEmotionCheck = Date.now();
  }

  /** 记录一次情感采样并重算趋势（强度作为权重，弱情绪不足以扭转趋势） */
  private recordEmotionSample(emotion: string | undefined, intensity: number): void {
    if (!emotion) return;
    let polarity: number;
    if ((NEGATIVE_EMOTIONS as readonly string[]).includes(emotion)) polarity = -1;
    else if ((POSITIVE_EMOTIONS as readonly string[]).includes(emotion)) polarity = 1;
    else return; // 中性情绪（idle/thinking/talking/...）不入样，避免稀释趋势

    const now = Date.now();
    // 强度作为权重：0.3 的轻微难过不该和 1.0 的崩溃等价
    this.emotionSamples.push({ t: now, score: polarity * Math.max(0.1, Math.min(1, intensity)) });
    if (this.emotionSamples.length > 50) {
      this.emotionSamples = this.emotionSamples.slice(-50);
    }
    this.recomputeEmotionTrend(now);
  }

  /** 依据窗口内加权均值推导趋势 */
  private recomputeEmotionTrend(now: number = Date.now()): void {
    this.emotionSamples = this.emotionSamples.filter((s) => now - s.t <= EMOTION_TREND_WINDOW);
    this.lastEmotionCheck = now;
    if (this.emotionSamples.length === 0) {
      this.emotionTrend = 'neutral';
      return;
    }
    const avg =
      this.emotionSamples.reduce((sum, s) => sum + s.score, 0) / this.emotionSamples.length;
    this.emotionTrend = avg > 0.25 ? 'positive' : avg < -0.25 ? 'negative' : 'neutral';
  }

  /** 获取上下文感知的额外提示 */
  getContextHints(): string[] {
    this.recomputeEmotionTrend();
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

  /** 每日状态简报所需的真实数据（本地统计，供注入 prompt） */
  getDailyStats(): { turns: number; emotionTrend: 'positive' | 'negative' | 'neutral' } {
    this.recomputeEmotionTrend();
    return { turns: this.todayTurns, emotionTrend: this.emotionTrend };
  }

  /** 定时检查逻辑 */
  private tick(): void {
    // 忙碌（语音通话/语音助手/回复流式）时暂停一切主动触发，避免打断对话
    if (this.busy) return;

    // 裁决进行中：不再提案，避免同一轮冷却窗口内并发裁决
    if (this.judging) return;

    const today = this.todayKey();
    if (today !== this.dailyResetDate) {
      this.dailyResetDate = today;
      this.dailyCount = 0;
      this.morningGreeted = false;
      this.dailyBriefed = false;
      this.todayTurns = 0;
      this.judgeCallsToday = 0;
    }

    // 免打扰时段硬闸：优先于一切场景（含深夜提醒本身）
    if (this.isQuietHours()) return;

    if (this.dailyCount >= this.config.dailyLimit) return;

    const now = Date.now();
    if (now - this.lastProactiveTime < this.config.messageCooldown) return;

    const idleDuration = now - this.lastInteractionTime;
    const hour = new Date().getHours();
    const minute = new Date().getMinutes();

    // 情绪驱动：高优先级，但限制频率 + 需闲置超过短空闲阈值（对话期间不抢话）
    if (
      now - this.lastEmotionTrigger > this.emotionTriggerCooldown &&
      idleDuration > IDLE_THRESHOLDS.short &&
      this.shouldTriggerEmotionScene()
    ) {
      this.lastEmotionTrigger = now;
      this.tryTrigger('mood_change', '检测到情绪变化');
      return;
    }

    // 随机性：小概率主动发起非时间场景，避免机械节律。
    // 概率乘以昼夜节律主动系数：深夜（0.3）时桌宠明显更克制，白天（1.0）正常。
    if (
      Math.random() < 0.15 * this.circadianMultiplier &&
      idleDuration > this.config.longIdleThreshold
    ) {
      this.tryTrigger('idle_long', `已闲置 ${Math.round(idleDuration / 60000)} 分钟`);
      return;
    }

    // 早安问候（同样要求闲置超过短空闲阈值，避免对话中被问候打断）
    if (!this.morningGreeted && hour >= 7 && hour < 9 && idleDuration > IDLE_THRESHOLDS.short) {
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

    // 午餐提醒（需闲置超过短空闲阈值，对话中到点不打扰）
    if (hour === 12 && minute < 30 && idleDuration > IDLE_THRESHOLDS.short) {
      this.tryTrigger('lunch_time', '午餐时间');
      return;
    }

    // 晚餐提醒
    if ((hour === 18 || (hour === 19 && minute < 30)) && idleDuration > IDLE_THRESHOLDS.short) {
      this.tryTrigger('dinner_time', '晚餐时间');
      return;
    }

    // 深夜提醒
    if ((hour >= 23 || hour < 2) && idleDuration > IDLE_THRESHOLDS.short) {
      this.tryTrigger('late_night', '深夜提醒');
      return;
    }

    // 每日状态简报（21:00 当天一次，本地生成，无外部写）
    if (!this.dailyBriefed && hour === 21 && idleDuration > IDLE_THRESHOLDS.short) {
      this.dailyBriefed = true;
      this.tryTrigger('daily_brief', '每日状态简报');
      return;
    }
  }

  /**
   * 是否应触发情绪安慰场景。
   *
   * 历史上本方法硬返回 false，导致 tick() 里的情绪驱动分支是死代码。
   * 现在依据窗口内的负面采样证据判断：趋势为负 + 至少 2 次负面采样，
   * 避免单次情绪抖动就触发"你怎么了"式误报。
   */
  private shouldTriggerEmotionScene(): boolean {
    this.recomputeEmotionTrend();
    if (this.emotionTrend !== 'negative') return false;
    const negatives = this.emotionSamples.filter((s) => s.score < 0).length;
    return negatives >= 2;
  }

  /**
   * 场景化触发：给回调注入当前情绪/最近消息/场景提示。
   *
   * 闸门顺序（任一不过即静默）：
   * 1. 场景存在 → 2. 每日上限 → 3. 免打扰时段（硬闸，事件驱动路径也必须过）
   * → 4. 裁决并发保护 → 5. 廉价模型裁决（可选）→ 发出
   */
  private tryTrigger(sceneId: string, reason: string): void {
    const scene = PROACTIVE_SCENES.find((s) => s.id === sceneId);
    if (!scene) return;
    if (this.dailyCount >= this.config.dailyLimit) return;

    // 免打扰二次防护：mood_change 走的是事件回调路径，不经过 tick() 的闸
    if (this.isQuietHours()) {
      log.info('Proactive suppressed by quiet hours', { scene: sceneId, reason });
      return;
    }

    if (this.judging) return;

    const hints = this.getContextHints();
    const trigger: ProactiveTrigger = { scene, reason, hints };

    const useJudge =
      this.config.judgeEnabled &&
      this.judge !== null &&
      // 裁决成本封顶：最多 dailyLimit 的 3 倍次调用，防止反复否决烧钱
      this.judgeCallsToday < this.config.dailyLimit * 3;

    if (!useJudge) {
      this.commitTrigger(trigger);
      return;
    }

    // 先占用冷却窗口：无论裁决结果如何都降温，避免被否决后每个 tick 都重新裁决
    this.lastProactiveTime = Date.now();
    this.judging = true;
    this.judgeCallsToday++;

    const ctx: ProactiveJudgeContext = {
      scene,
      reason,
      hints,
      idleMinutes: Math.round((Date.now() - this.lastInteractionTime) / 60000),
      hour: new Date().getHours(),
      emotionTrend: this.emotionTrend,
      todayCount: this.dailyCount,
      todayTurns: this.todayTurns,
      initiativeMultiplier: this.circadianMultiplier,
    };

    void this.judge!(ctx)
      .then((approved) => {
        if (!approved) {
          log.info('Proactive vetoed by judge', { scene: sceneId, reason });
          return;
        }
        this.commitTrigger(trigger, /* cooldownAlreadyApplied */ true);
      })
      .catch((err) => {
        // 裁决器不可用：降级放行。硬规则已判定该说，不该因裁决挂掉而彻底沉默
        log.warn('Proactive judge failed, falling through to allow', err);
        this.commitTrigger(trigger, true);
      })
      .finally(() => {
        this.judging = false;
      });
  }

  /** 计入配额并派发给回调 */
  private commitTrigger(trigger: ProactiveTrigger, cooldownAlreadyApplied = false): void {
    // 二次校验：裁决是异步的，期间可能已跨日重置或触达上限
    if (this.dailyCount >= this.config.dailyLimit) return;

    if (!cooldownAlreadyApplied) {
      this.lastProactiveTime = Date.now();
    }
    this.dailyCount++;

    log.info('Proactive trigger', {
      scene: trigger.scene.id,
      reason: trigger.reason,
      dailyCount: this.dailyCount,
      hints: trigger.hints,
    });

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
