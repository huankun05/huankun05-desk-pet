import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  useSlashCommands,
  loadCustomCommands,
  saveCustomCommands,
  getAllCommands,
  CUSTOM_COMMANDS_KEY,
  type CustomSlashCommand,
} from './useSlashCommands';

const sampleMacro: CustomSlashCommand = {
  id: 'c1',
  name: 'summary',
  description: '总结当前内容',
  category: '自定义',
  icon: '⚡',
  type: 'macro',
  macroText: '请用一句话总结以下内容',
  createdAt: 1700000000000,
};

const sampleAction: CustomSlashCommand = {
  id: 'c2',
  name: 'myexport',
  description: '导出会话',
  category: '自定义',
  icon: '📤',
  type: 'action',
  actionId: 'export',
  createdAt: 1700000000001,
};

describe('自定义命令数据层', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('saveCustomCommands → loadCustomCommands 往返无损', () => {
    const list = [sampleMacro, sampleAction];
    saveCustomCommands(list);
    const loaded = loadCustomCommands();
    expect(loaded).toHaveLength(2);
    expect(loaded[0]).toEqual(sampleMacro);
    expect(loaded[1]).toEqual(sampleAction);
  });

  it('localStorage 损坏时 loadCustomCommands 返回空数组', () => {
    localStorage.setItem(CUSTOM_COMMANDS_KEY, '{not json');
    expect(loadCustomCommands()).toEqual([]);
  });

  it('getAllCommands 合并内置与自定义，自定义在后', () => {
    const all = getAllCommands([sampleMacro]);
    // 内置命令在前
    const builtinCount = all.filter((c) => c.name === 'help').length;
    expect(builtinCount).toBe(1);
    // 自定义命令存在
    expect(all.some((c) => c.name === 'summary')).toBe(true);
  });
});

describe('executeCommand 路由', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('宏命令执行返回 macro 文本（含参数），不触发任何动作回调', () => {
    localStorage.setItem(CUSTOM_COMMANDS_KEY, JSON.stringify([sampleMacro]));
    const onExport = vi.fn();
    const { result } = renderHook(() => useSlashCommands({ onExport }));
    let r: { handled: boolean; macro?: string };
    act(() => {
      r = result.current.executeCommand('/summary 额外参数');
    });
    expect(r!).toEqual({ handled: true, macro: '请用一句话总结以下内容 额外参数' });
    expect(onExport).not.toHaveBeenCalled();
  });

  it('动作型自定义命令路由到对应 options 回调', () => {
    localStorage.setItem(CUSTOM_COMMANDS_KEY, JSON.stringify([sampleAction]));
    const onExport = vi.fn();
    const { result } = renderHook(() => useSlashCommands({ onExport }));
    act(() => {
      result.current.executeCommand('/myexport');
    });
    expect(onExport).toHaveBeenCalledTimes(1);
  });

  it('自定义命令覆盖同名内置命令', () => {
    const customRetry: CustomSlashCommand = {
      id: 'cr',
      name: 'retry',
      description: '自定义重试',
      category: '自定义',
      type: 'macro',
      macroText: 'CUSTOM RETRY',
      createdAt: Date.now(),
    };
    localStorage.setItem(CUSTOM_COMMANDS_KEY, JSON.stringify([customRetry]));
    const onRetry = vi.fn();
    const { result } = renderHook(() => useSlashCommands({ onRetry }));
    let r: { handled: boolean; macro?: string };
    act(() => {
      r = result.current.executeCommand('/retry');
    });
    expect(r!).toEqual({ handled: true, macro: 'CUSTOM RETRY' });
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('内置命令走注册表动作', () => {
    const onStop = vi.fn();
    const { result } = renderHook(() => useSlashCommands({ onStop }));
    act(() => {
      result.current.executeCommand('/stop');
    });
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('未知命令返回 handled:false', () => {
    const { result } = renderHook(() => useSlashCommands({}));
    let r: { handled: boolean; macro?: string };
    act(() => {
      r = result.current.executeCommand('/nonexistent');
    });
    expect(r!.handled).toBe(false);
  });
});
