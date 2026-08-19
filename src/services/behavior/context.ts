/**
 * PetContext — 依赖注入上下文
 *
 * 为 Behavior 提供桌面宠物能力的安全抽象：
 * - 发声（TTS + 气泡）
 * - 播放动画
 * - 读取当前状态
 * - 触发反馈
 *
 * 通过接口解耦，Behavior 不直接依赖 Tauri/React/Live2D。
 */

import type { Personality } from '../../hooks/useEmotion';

// ===== 依赖接口（由 App.tsx 实现注入） =====

export interface PetContextDependencies {
  /** TTS 朗读文本 + 气泡显示 */
  say: (text: string) => Promise<void>;
  /** 仅显示气泡（不朗读） */
  showBubble: (text: string, duration?: number) => void;
  /** 播放 Live2D 动画 */
  playAnimation: (name: string, duration?: number) => void;
  /** 切换 Live2D 表情 */
  setExpression: (expression: string) => void;
  /** 获取当前心情 */
  getMood: () => string;
  /** 获取当前情绪 */
  getEmotion: () => string;
  /** 获取好感度 */
  getFavorability: () => number;
  /** 获取当前时间上下文 */
  getTimeContext: () => { hour: number; dayOfWeek: number; isWeekend: boolean };
  /** 获取性格参数 */
  getPersonality: () => Personality;
  /** 锁定/解锁宠物 */
  setLocked: (locked: boolean) => void;
  /** 发送消息到管道 */
  sendMessage: (text: string) => Promise<string>;
}

// ===== PetContext 实现 =====

export class PetContextImpl implements PetContext {
  private deps: PetContextDependencies;

  constructor(deps: PetContextDependencies) {
    this.deps = deps;
  }

  async say(text: string): Promise<void> {
    await this.deps.say(text);
  }

  showBubble(text: string, duration?: number): void {
    this.deps.showBubble(text, duration);
  }

  playAnimation(name: string, duration?: number): void {
    this.deps.playAnimation(name, duration);
  }

  setExpression(expression: string): void {
    this.deps.setExpression(expression);
  }

  getMood(): string {
    return this.deps.getMood();
  }

  getEmotion(): string {
    return this.deps.getEmotion();
  }

  getFavorability(): number {
    return this.deps.getFavorability();
  }

  getTimeContext(): { hour: number; dayOfWeek: number; isWeekend: boolean } {
    return this.deps.getTimeContext();
  }

  getPersonality(): Personality {
    return this.deps.getPersonality();
  }

  setLocked(locked: boolean): void {
    this.deps.setLocked(locked);
  }

  async sendMessage(text: string): Promise<string> {
    try {
      localStorage.setItem(
        'deskpet_chat_unread',
        String((parseInt(localStorage.getItem('deskpet_chat_unread') || '0', 10) || 0) + 1),
      );
    } catch {
      /* ignore */
    }
    return this.deps.sendMessage(text);
  }

  /** 建造新 Context（更换依赖注入） */
  rebind(deps: Partial<PetContextDependencies>): PetContextImpl {
    this.deps = { ...this.deps, ...deps };
    return this;
  }
}

// ===== PetContext 接口 =====

/**
 * PetContext 接口（对外暴露给 Behavior）
 */
export interface PetContext {
  say(text: string): Promise<void>;
  showBubble(text: string, duration?: number): void;
  playAnimation(name: string, duration?: number): void;
  setExpression(expression: string): void;
  getMood(): string;
  getEmotion(): string;
  getFavorability(): number;
  getTimeContext(): { hour: number; dayOfWeek: number; isWeekend: boolean };
  getPersonality(): Personality;
  setLocked(locked: boolean): void;
  sendMessage(text: string): Promise<string>;
}
