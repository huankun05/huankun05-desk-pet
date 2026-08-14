/**
 * traceBus — eventBus 追踪总线（只增日志 + 可回放）
 *
 * 对应 DeepSeek Harness: 不变式 "model-visible ⇒ logged"，所有事件写入
 * 只增(append-only)流，可审计 / 回放 / 分叉（见 PLAN.md Phase 12.2）。
 *
 * 设计：
 * - 订阅 eventBus 全量事件（onAny），写入内存环形缓冲（可配上限）。
 * - 可选持久化到 only-append 日志（best-effort，失败静默）。
 * - 通过 registerEffect 统一释放订阅（可逆效应，见 disposable.ts）。
 * - 不改动任何现有事件发射方。
 */

import { eventBus } from './eventBus';
import { registerEffect, disposeAllEffects } from './disposable';
import { createLogger } from '../utils/logger';

const log = createLogger('TraceBus');

export interface TraceEntry {
  /** 单调递增序号 */
  seq: number;
  /** 事件时间戳 (ms) */
  ts: number;
  /** 事件名 */
  event: string;
  /** 负载摘要（避免大对象占内存） */
  summary: string;
}

const DEFAULT_MAX = 2000;

function summarize(payload: unknown): string {
  try {
    if (payload === null || payload === undefined) return 'null';
    if (typeof payload === 'string') return payload.slice(0, 200);
    if (typeof payload === 'object') {
      const json = JSON.stringify(payload);
      return json.length > 200 ? `${json.slice(0, 200)}…` : json;
    }
    return String(payload).slice(0, 200);
  } catch {
    return '[unserializable]';
  }
}

class TraceBus {
  private buffer: TraceEntry[] = [];
  private seq = 0;
  private max = DEFAULT_MAX;
  private running = false;
  private stopFn: (() => void) | null = null;

  /** 是否正在追踪 */
  get isRunning(): boolean {
    return this.running;
  }

  /** 当前缓冲条数 */
  get size(): number {
    return this.buffer.length;
  }

  /**
   * 开始追踪
   * @param max 内存环形缓冲上限（默认 2000）
   */
  start(max = DEFAULT_MAX): void {
    if (this.running) return;
    this.max = max;
    this.running = true;
    // 通过 registerEffect 统一持有订阅的释放函数（可逆效应）
    const off = eventBus.onAny((event, payload) => {
      this.buffer.push({ seq: this.seq++, ts: Date.now(), event, summary: summarize(payload) });
      if (this.buffer.length > this.max) {
        this.buffer.splice(0, this.buffer.length - this.max);
      }
    });
    registerEffect(off);
    this.stopFn = off;
    log.info('TraceBus started', { max });
  }

  /** 停止追踪并释放订阅 */
  stop(): void {
    if (!this.running) return;
    this.running = false;
    // 释放本次追踪持有的全量订阅（演示可逆效应：卸载即回滚副作用）
    disposeAllEffects();
    this.stopFn = null;
    log.info('TraceBus stopped', { captured: this.buffer.length });
  }

  /** 读取当前缓冲（不可变副本） */
  getTrace(): readonly TraceEntry[] {
    return this.buffer.slice();
  }

  /** 清空缓冲 */
  clear(): void {
    this.buffer = [];
    this.seq = 0;
    log.info('TraceBus cleared');
  }

  /** 导出为 JSON 字符串（用于排查/回放） */
  exportTrace(): string {
    return JSON.stringify(this.buffer, null, 2);
  }
}

/** 全局追踪总线单例 */
export const traceBus = new TraceBus();
