/**
 * BehaviorRegistry — 行为注册表
 *
 * 全局单例，管理所有 DeskPetBehavior 实例的生命周期和事件分发。
 * 借鉴 AstrBot plugin_manager.py 设计。
 */

import type { DeskPetBehavior } from './base';
import { BehaviorLifecycle } from './base';
import type { PetContext } from './context';
import type { EventType, BehaviorHandler } from './types';
import { FilterAction } from './types';
import { createLogger } from '../../utils/logger';

const log = createLogger('BehaviorRegistry');

export class BehaviorRegistry {
  /** 已注册的行为 */
  private behaviors = new Map<string, DeskPetBehavior>();
  /** 行为是否启用（持久化到 localStorage） */
  private enabled = new Map<string, boolean>();
  /** 事件 → Handler 索引（加速分发） */
  private eventIndex = new Map<
    EventType,
    { behavior: DeskPetBehavior; handler: BehaviorHandler }[]
  >();
  /** PetContext 引用 */
  private context: PetContext | null = null;
  /** 是否已初始化 */
  private initialized = false;

  private static readonly ENABLED_KEY = 'deskpet_behaviorEnabled';

  // ===== 注册/注销 =====

  /** 注册一个 Behavior */
  register(behavior: DeskPetBehavior): void {
    if (this.behaviors.has(behavior.id)) {
      log.warn('Duplicate behavior registration', { id: behavior.id });
      return;
    }
    this.behaviors.set(behavior.id, behavior);

    // 默认启用（首次注册时持久化）
    if (!this.enabled.has(behavior.id)) {
      const stored = this.readEnabledFromStorage();
      const def = stored[behavior.id] ?? true;
      this.enabled.set(behavior.id, def);
    }

    // 如果已经初始化过，立即初始化新 Behavior
    if (this.initialized && this.context) {
      this.initBehavior(behavior, this.context).catch((err) => {
        log.error('Failed to init late-registered behavior', { id: behavior.id, error: err });
      });
    }
  }

  /** 注销一个 Behavior */
  async unregister(id: string): Promise<void> {
    const behavior = this.behaviors.get(id);
    if (!behavior) return;

    await behavior.onDeactivate().catch(() => {});
    await behavior.onTerminate().catch(() => {});
    this.behaviors.delete(id);

    // 清理事件索引
    this.rebuildEventIndex();
    log.info('Behavior unregistered', { id });
  }

  // ===== 生命周期协调 =====

  /** 初始化所有 Behavior */
  async initializeAll(ctx: PetContext): Promise<void> {
    this.context = ctx;
    this.initialized = true;

    const initPromises: Promise<void>[] = [];
    for (const behavior of this.behaviors.values()) {
      initPromises.push(this.initBehavior(behavior, ctx));
    }

    await Promise.allSettled(initPromises);
    this.rebuildEventIndex();
    log.info('All behaviors initialized', { count: this.behaviors.size });
  }

  private async initBehavior(behavior: DeskPetBehavior, ctx: PetContext): Promise<void> {
    try {
      await behavior.initialize(ctx);
    } catch (err) {
      await behavior.onError(err as Error).catch(() => {});
    }
  }

  /** 终止所有 Behavior */
  async terminateAll(): Promise<void> {
    const termPromises: Promise<void>[] = [];
    for (const behavior of this.behaviors.values()) {
      termPromises.push(
        (async () => {
          await behavior.onDeactivate().catch(() => {});
          await behavior.onTerminate().catch(() => {});
        })(),
      );
    }
    await Promise.allSettled(termPromises);
    this.behaviors.clear();
    this.eventIndex.clear();
    this.initialized = false;
    log.info('All behaviors terminated');
  }

  // ===== 事件分发 =====

  /** 分派事件到所有匹配的 Handler */
  async dispatch(eventType: EventType, payload: unknown): Promise<void> {
    const entries = this.eventIndex.get(eventType);
    if (!entries || entries.length === 0) return;

    // 按优先级排序
    const sorted = [...entries].sort((a, b) => a.handler.priority - b.handler.priority);

    for (const { behavior, handler } of sorted) {
      if (behavior.lifecycle !== BehaviorLifecycle.Active) continue;
      if (!this.enabled.get(behavior.id)) continue;

      // 执行过滤器链
      let action = FilterAction.Pass;
      if (handler.filters) {
        for (const filter of [...handler.filters].sort((a, b) => a.priority - b.priority)) {
          action = await filter.check(eventType, payload);
          if (action !== FilterAction.Pass) break;
        }
      }

      if (action === FilterAction.Block) break;
      if (action === FilterAction.Skip) continue;

      // 执行 Handler
      try {
        await handler.handler(payload);
      } catch (err) {
        log.error('Handler error', {
          behaviorId: behavior.id,
          eventType,
          error: (err as Error).message,
        });
        await behavior.onError(err as Error).catch(() => {});
      }
    }
  }

  // ===== 查询 =====

  /** 获取所有已注册的 Behavior */
  getAll(): DeskPetBehavior[] {
    return [...this.behaviors.values()];
  }

  /** 按 ID 查找 */
  getById(id: string): DeskPetBehavior | undefined {
    return this.behaviors.get(id);
  }

  /** 获取注册数量 */
  get count(): number {
    return this.behaviors.size;
  }

  // ===== 启用/禁用 =====

  isEnabled(id: string): boolean {
    return this.enabled.get(id) ?? true;
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    const prev = this.enabled.get(id) ?? true;
    if (prev === enabled) return;
    this.enabled.set(id, enabled);
    this.writeEnabledToStorage();

    const behavior = this.behaviors.get(id);
    if (behavior) {
      try {
        if (enabled) await behavior.onActivate();
        else await behavior.onDeactivate();
      } catch (err) {
        log.warn('Behavior lifecycle transition error', { id, enabled, err: String(err) });
      }
    }
    log.info('Behavior ' + (enabled ? 'enabled' : 'disabled'), { id });
  }

  getAllWithState(): Array<{
    id: string;
    name: string;
    description: string;
    version: string;
    enabled: boolean;
  }> {
    return this.getAll().map((b) => ({
      id: b.id,
      name: b.name,
      description: b.description,
      version: b.version,
      enabled: this.isEnabled(b.id),
    }));
  }

  // ===== 内部 =====

  private readEnabledFromStorage(): Record<string, boolean> {
    try {
      const raw = localStorage.getItem(BehaviorRegistry.ENABLED_KEY);
      return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
    } catch {
      return {};
    }
  }

  private writeEnabledToStorage(): void {
    try {
      const obj: Record<string, boolean> = {};
      for (const [k, v] of this.enabled) obj[k] = v;
      localStorage.setItem(BehaviorRegistry.ENABLED_KEY, JSON.stringify(obj));
    } catch {
      /* ignore */
    }
  }

  private rebuildEventIndex(): void {
    this.eventIndex.clear();
    for (const behavior of this.behaviors.values()) {
      for (const handler of behavior.getHandlers()) {
        if (!this.eventIndex.has(handler.eventType)) {
          this.eventIndex.set(handler.eventType, []);
        }
        this.eventIndex.get(handler.eventType)!.push({ behavior, handler });
      }
    }
  }
}

/** 全局单例 */
let _globalRegistry: BehaviorRegistry | null = null;

export function getBehaviorRegistry(): BehaviorRegistry {
  if (!_globalRegistry) {
    _globalRegistry = new BehaviorRegistry();
  }
  return _globalRegistry;
}

export function resetBehaviorRegistry(): void {
  _globalRegistry = null;
}
