/**
 * disposable — 可逆效应（reversible effects）原语
 *
 * 对应 DeepSeek Harness: 所有注册（监听、订阅、状态改动）都返回一个 disposer，
 * 卸载/切换时统一回滚，避免"半切换"残留旧监听（见 PLAN.md Phase 12.5）。
 *
 * 设计要点：
 * - Disposer 是 `() => void`，调用即释放。
 * - DisposableRegistry 收集一组 disposer，disposeAll() 幂等执行并清空。
 * - registerEffect() 为全局便捷入口，stopTrace() 等用统一 registry 演示该模式。
 */

/** 释放函数：调用即撤销某个已注册的副作用 */
export type Disposer = () => void;

/** 一组可统一释放的副作用 */
export class DisposableRegistry {
  private disposers: Disposer[] = [];

  /** 注册一个释放函数，返回该函数本身以便局部使用 */
  register(disposer: Disposer): Disposer {
    if (typeof disposer === 'function') {
      this.disposers.push(disposer);
    }
    return disposer;
  }

  /** 是否还有未释放的副作用 */
  get size(): number {
    return this.disposers.length;
  }

  /** 释放全部（幂等：多次调用安全，已释放即清空） */
  disposeAll(): void {
    const list = this.disposers;
    this.disposers = [];
    for (const dispose of list) {
      try {
        dispose();
      } catch (err) {
        console.error('[DisposableRegistry] disposer threw:', err);
      }
    }
  }
}

/** 全局副作用注册表（供跨模块统一释放，如追踪总线停止时） */
const globalRegistry = new DisposableRegistry();

/** 注册一个全局副作用，返回其 disposer */
export function registerEffect(disposer: Disposer): Disposer {
  return globalRegistry.register(disposer);
}

/** 释放全部全局副作用 */
export function disposeAllEffects(): void {
  globalRegistry.disposeAll();
}
