/**
 * DeskPetBehavior 基类 + 自注册机制
 *
 * 借鉴 AstrBot 插件系统设计：
 * - 子类继承 DeskPetBehavior 后通过 queueMicrotask 自动注册到 BehaviorRegistry
 * - 生命周期钩子：onLoad → Initialize → Activate → Deactivate/enabled=false → Terminate
 * - 每个 Behavior 可绑定多个 EventType → Handler
 */

import type { PetContext } from './context';
import { getBehaviorRegistry } from './registry';
import type { BehaviorHandler, HandlerFilter } from './types';
import { EventType } from './types';
import { createLogger } from '../../utils/logger';

const log = createLogger('BehaviorBase');

// ===== 生命周期 =====

export enum BehaviorLifecycle {
  Initializing = 'initializing',
  Active = 'active',
  Inactive = 'inactive',
  Error = 'error',
  Terminated = 'terminated',
}

// ===== 基类 =====

export abstract class DeskPetBehavior {
  /** 行为唯一标识 */
  abstract readonly id: string;
  /** 行为名称 */
  abstract readonly name: string;
  /** 版本号 */
  abstract readonly version: string;
  /** 描述 */
  abstract readonly description: string;

  /** 当前生命周期状态 */
  lifecycle: BehaviorLifecycle = BehaviorLifecycle.Initializing;

  /** 事件处理器列表 */
  protected handlers: BehaviorHandler[] = [];

  /** 依赖注入的上下文 */
  protected ctx: PetContext | null = null;

  constructor() {
    // 自动注册到全局 Registry（下一个微任务，确保子类构造函数先执行完）
    queueMicrotask(() => {
      try {
        const registry = getBehaviorRegistry();
        registry.register(this);
        log.debug('Auto-registered behavior', { id: this.id, name: this.name });
      } catch (err) {
        log.error('Failed to auto-register behavior', { id: this.id, error: err });
      }
    });
  }

  // ===== 生命周期钩子 =====

  /** 模块加载时调用一次 */
  async onLoad(_ctx: PetContext): Promise<void> {}

  /** 初始化（注册 Handlers、连接外部资源） */
  async initialize(ctx: PetContext): Promise<void> {
    this.ctx = ctx;
    this.lifecycle = BehaviorLifecycle.Active;
  }

  /** 激活（enabled = true 时） */
  async onActivate(): Promise<void> {
    this.lifecycle = BehaviorLifecycle.Active;
  }

  /** 停用（enabled = false 时） */
  async onDeactivate(): Promise<void> {
    this.lifecycle = BehaviorLifecycle.Inactive;
  }

  /** 销毁（注销所有 Handler、断开外部连接） */
  async onTerminate(): Promise<void> {
    this.lifecycle = BehaviorLifecycle.Terminated;
  }

  /** 错误处理 */
  async onError(error: Error): Promise<void> {
    log.error('Behavior error', { id: this.id, error: error.message });
    this.lifecycle = BehaviorLifecycle.Error;
  }

  // ===== Handler 管理 =====

  /** 注册事件处理器 */
  protected addHandler(
    eventType: EventType,
    handler: (payload: unknown) => void | Promise<void>,
    priority = 50,
    filters?: HandlerFilter[],
  ): void {
    this.handlers.push({ eventType, handler, priority, filters });
  }

  /** 获取所有 Handlers */
  getHandlers(): BehaviorHandler[] {
    return [...this.handlers];
  }
}
