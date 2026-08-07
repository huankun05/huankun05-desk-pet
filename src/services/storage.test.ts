import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock Tauri invoke before importing storage
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(() => Promise.resolve()),
}));

import { invoke } from '@tauri-apps/api/core';
import { createStorage } from './storage';

const mockInvoke = vi.mocked(invoke);

beforeEach(() => {
  localStorage.clear();
  mockInvoke.mockClear();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createStorage', () => {
  it('creates a storage with default value', () => {
    const store = createStorage('test', { val: 42 });
    expect(store.get()).toEqual({ val: 42 });
  });

  it('set merges objects', () => {
    const store = createStorage<{ a: number; b?: number }>('test', { a: 1 });
    store.set({ b: 2 });
    expect(store.get()).toEqual({ a: 1, b: 2 });
  });

  it('set replaces non-object values', () => {
    const store = createStorage<string | number>('test', 'hello');
    store.set(42);
    expect(store.get()).toBe(42);
  });

  it('set replaces arrays', () => {
    const store = createStorage<number[]>('test', [1, 2]);
    store.set([3, 4, 5]);
    expect(store.get()).toEqual([3, 4, 5]);
  });

  it('reset restores default value', () => {
    const store = createStorage('test', { val: 0 });
    store.set({ val: 99 });
    store.reset();
    expect(store.get()).toEqual({ val: 0 });
  });

  it('set writes to localStorage immediately', () => {
    const store = createStorage('test', { val: 0 });
    store.set({ val: 42 });
    const stored = JSON.parse(localStorage.getItem('deskpet_test')!);
    expect(stored).toEqual({ val: 42 });
  });

  // 注意：这里刻意不做防抖。原先的 1s 防抖会在应用退出 / 设置窗销毁时
  // 丢掉未落盘的写入（LLM/TTS provider 配置重启后消失），已改为每次 set 立即写文件。
  it('writes to file on every set (no debounce)', () => {
    const store = createStorage('test', { val: 0 });
    store.set({ val: 1 });
    store.set({ val: 2 });

    expect(mockInvoke).toHaveBeenCalledTimes(2);
    expect(mockInvoke).toHaveBeenLastCalledWith(
      'save_data',
      expect.objectContaining({
        key: 'test',
        data: JSON.stringify({ val: 2 }),
      }),
    );

    // 推进计时器不应产生额外的延迟写入
    vi.advanceTimersByTime(2000);
    expect(mockInvoke).toHaveBeenCalledTimes(2);
  });

  it('flush writes immediately without debounce', async () => {
    const store = createStorage('test', { val: 0 });
    store.set({ val: 42 });

    // Don't wait, flush immediately
    await store.flush();

    expect(mockInvoke).toHaveBeenCalledWith(
      'save_data',
      expect.objectContaining({
        key: 'test',
        data: JSON.stringify({ val: 42 }),
      }),
    );
  });

  it('init loads from file if localStorage is empty', async () => {
    const fileData = { val: 99 };
    mockInvoke.mockResolvedValueOnce(JSON.stringify(fileData));

    const store = createStorage('test', { val: 0 });
    await store.init();

    expect(store.get()).toEqual({ val: 99 });
    // Should have written file data to localStorage
    expect(localStorage.getItem('deskpet_test')).toBe(JSON.stringify(fileData));
  });

  it('init skips file load if localStorage has data', async () => {
    localStorage.setItem('deskpet_test', JSON.stringify({ val: 42 }));

    const store = createStorage('test', { val: 0 });
    await store.init();

    expect(store.get()).toEqual({ val: 42 });
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});
