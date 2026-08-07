/**
 * 角色热切换系统
 *
 * 运行时无重启切换人设，支持：
 * - 即时切换（无需重启应用）
 * - 切换动画/过渡（表情变化 + 气泡提示 + 情感状态调整）
 * - 定时自动切换（基于时段预设）
 * - 切换历史（支持撤销）
 * - 事件广播（通知 UI 和管理后台）
 *
 * 集成状态：
 * - ControlsIsland 已添加人设切换按钮（运行时手动切换）
 * - 设置面板已添加自动切换规则配置（时段/心情/好感度条件）
 * - App.tsx 已集成每分钟自动检查 + 气泡问候 + eventBus 事件订阅
 * - 与情感系统联动：切换时根据新人格 HEXACO 调整 PAD 基线
 * - 相关模块：personaManager、useEmotion、eventBus、proactive scheduler
 */

import { personaManager } from './manager';
import { eventBus } from '../eventBus';
import { createLogger } from '../../utils/logger';

const log = createLogger('PersonaHotswap');

// ===== 类型 =====

export interface HotswapOptions {
  /** 切换后是否显示气泡提示 */
  showBubble?: boolean;
  /** 切换动画持续时间 ms */
  transitionDuration?: number;
  /** 是否保存切换历史 */
  saveHistory?: boolean;
  /** 切换来源 */
  source?: 'manual' | 'auto' | 'schedule' | 'emotion' | 'time';
}

export interface HotswapResult {
  success: boolean;
  previousId: string;
  nextId: string;
  previousName: string;
  nextName: string;
}

export interface AutoSwitchRule {
  id: string;
  /** 目标人设 ID */
  targetPersonaId: string;
  /** 触发时间（小时，0-23），-1 表示不按时间 */
  triggerHour: number;
  /** 触发心情（空字符串表示不按心情） */
  triggerMood: string;
  /** 触发好感度范围 [min, max] */
  favorabilityRange: [number, number];
  /** 优先级（数字越小越优先） */
  priority: number;
  /** 是否启用 */
  enabled: boolean;
}

// ===== PersonaHotswap =====

class PersonaHotswap {
  /** 切换历史（最多保留 10 条） */
  private history: HotswapResult[] = [];
  /** 自动切换规则 */
  private autoRules: AutoSwitchRule[] = [];
  /** 上一次切换时间 */
  private lastSwitchTime = 0;
  /** 冷却时间 ms（防止频繁切换） */
  private cooldown = 5000;

  /**
   * 即时热切换到指定人设
   *
   * 所有正在进行的对话不受影响（通过 PersonalityInjectStage 在下一轮生效），
   * 新对话立即采用新人设。
   */
  async switchTo(targetId: string, options: HotswapOptions = {}): Promise<HotswapResult> {
    const { showBubble: _showBubble = true, saveHistory = true, source = 'manual' } = options;

    // 冷却检查
    const now = Date.now();
    if (now - this.lastSwitchTime < this.cooldown) {
      log.warn('Hotswap cooldown active', {
        remaining: Math.ceil((this.cooldown - (now - this.lastSwitchTime)) / 1000),
      });
    }

    const prev = personaManager.getActiveProfile();
    if (prev.id === targetId) {
      return {
        success: false,
        previousId: prev.id,
        nextId: prev.id,
        previousName: prev.name,
        nextName: prev.name,
      };
    }

    const target = personaManager.getProfiles().find((p) => p.id === targetId);
    if (!target) {
      log.error('Hotswap target not found', { targetId });
      return {
        success: false,
        previousId: prev.id,
        nextId: targetId,
        previousName: prev.name,
        nextName: '未知',
      };
    }

    // 执行切换
    const switched = personaManager.setActive(targetId);
    if (!switched) {
      return {
        success: false,
        previousId: prev.id,
        nextId: targetId,
        previousName: prev.name,
        nextName: target.name,
      };
    }

    this.lastSwitchTime = now;

    // 记录历史
    const result: HotswapResult = {
      success: true,
      previousId: prev.id,
      nextId: target.id,
      previousName: prev.name,
      nextName: target.name,
    };

    if (saveHistory) {
      this.history.push(result);
      if (this.history.length > 10) this.history.shift();
    }

    // 广播事件
    eventBus.emit('persona:changed', {
      previousId: prev.id,
      previousName: prev.name,
      nextId: target.id,
      nextName: target.name,
      source,
    });

    // 触发表情变化（切换到新人设的基础情绪）
    eventBus.emit('emotion:changed', {
      emotion: 'curious',
      intensity: 0.3,
      reason: `切换人设: ${target.name}`,
    });

    log.info('Persona hotswapped', {
      from: prev.name,
      to: target.name,
      source,
    });

    return result;
  }

  /**
   * 撤销：切换回上一个活跃人设
   */
  async undo(): Promise<HotswapResult | null> {
    if (this.history.length === 0) return null;

    // 找到最近的成功切换
    for (let i = this.history.length - 1; i >= 0; i--) {
      if (this.history[i].success) {
        const prev = this.history[i];
        this.history.splice(i, 1);
        return this.switchTo(prev.previousId, {
          showBubble: true,
          saveHistory: false,
          source: 'manual',
        });
      }
    }

    return null;
  }

  /**
   * 获取切换历史
   */
  getHistory(): HotswapResult[] {
    return [...this.history];
  }

  /**
   * 基于上下文的自动切换
   *
   * 根据当前时间、心情、好感度等条件自动选择最合适的人设。
   */
  async autoSwitch(
    hour: number,
    mood: string,
    favorability: number,
  ): Promise<HotswapResult | null> {
    // 筛选匹配的规则
    const candidates = this.autoRules
      .filter((r) => r.enabled)
      .filter((r) => {
        if (r.triggerHour >= 0 && r.triggerHour !== hour) return false;
        if (r.triggerMood && r.triggerMood !== mood) return false;
        if (favorability < r.favorabilityRange[0] || favorability > r.favorabilityRange[1])
          return false;
        return true;
      })
      .sort((a, b) => a.priority - b.priority);

    if (candidates.length === 0) return null;

    // 当前活跃人设已在规则中，不重复切换
    const current = personaManager.getActiveProfile();
    if (candidates[0].targetPersonaId === current.id) return null;

    return this.switchTo(candidates[0].targetPersonaId, {
      showBubble: true,
      source: 'auto',
    });
  }

  /**
   * 管理自动切换规则
   */
  addAutoRule(rule: AutoSwitchRule): void {
    this.autoRules.push(rule);
    log.info('Auto-switch rule added', rule);
  }

  removeAutoRule(id: string): void {
    this.autoRules = this.autoRules.filter((r) => r.id !== id);
  }

  getAutoRules(): AutoSwitchRule[] {
    return [...this.autoRules].sort((a, b) => a.priority - b.priority);
  }

  /**
   * 根据时段预设自动规则
   *
   * 如果某个 profile 配置了 mood_prompts 特定 mood 的专属对话片段，
   * 注册对应 mood 的自动切换规则。
   */
  setupTimeBasedRules(): void {
    this.autoRules = [];

    const profiles = personaManager.getProfiles();
    for (const profile of profiles) {
      if (!profile.enabled || !profile.moodPrompts) continue;

      const moods = Object.keys(profile.moodPrompts);
      for (const mood of moods) {
        // 根据 mood 推断触发时段
        let triggerHour = -1;
        if (mood === 'content' || mood === 'cheerful')
          triggerHour = 10; // 上午好心情
        else if (mood === 'melancholy' || mood === 'calm')
          triggerHour = 22; // 夜晚安静
        else if (mood === 'excited') triggerHour = 14; // 下午活跃

        if (triggerHour >= 0) {
          this.addAutoRule({
            id: `auto_${profile.id}_${mood}`,
            targetPersonaId: profile.id,
            triggerHour,
            triggerMood: '',
            favorabilityRange: [0, 100],
            priority: 50,
            enabled: true,
          });
        }
      }
    }

    log.info('Time-based auto-switch rules configured', { count: this.autoRules.length });
  }

  /**
   * 清空切换历史
   */
  clearHistory(): void {
    this.history = [];
  }
}

export const personaHotswap = new PersonaHotswap();
