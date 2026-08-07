import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock Tauri invoke before importing backupEngine
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(() => Promise.resolve()),
}));

import { collectBackupData, applyData, isBackupDue } from './backupEngine';
import type { BackupConfig } from './types';

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('backupEngine 数据收集', () => {
  it('收集全部 SOURCES 键到备份数据', async () => {
    localStorage.setItem('deskpet_chat_sessions', JSON.stringify({ sessions: [] }));
    localStorage.setItem('deskpet_settings', JSON.stringify({ lang: 'zh' }));
    localStorage.setItem('deskpet_providers', JSON.stringify({ list: [] }));
    localStorage.setItem('deskpet_rag_docs_v1', JSON.stringify([{ id: 'm1' }]));

    const { data, entries } = await collectBackupData();
    expect(data.chat_sessions).toEqual({ sessions: [] });
    expect(data.settings).toEqual({ lang: 'zh' });
    expect(data.providers).toEqual({ list: [] });
    expect(data.rag_docs).toEqual([{ id: 'm1' }]);
    // 未写入的键不出现
    expect(data.persona_store).toBeUndefined();
    expect(entries.length).toBeGreaterThanOrEqual(4);
    // 每项都带 size
    for (const e of entries) expect(e.size).toBeGreaterThan(0);
  });

  it('收集按角色隔离的 desk_pet_memory_* 键到 memories', async () => {
    localStorage.setItem('desk_pet_memory_nahida', JSON.stringify({ facts: ['A'] }));
    localStorage.setItem('desk_pet_memory_other', JSON.stringify({ facts: ['B'] }));
    // 无关键不收集
    localStorage.setItem('deskpet_unrelated', 'x');

    const { data } = await collectBackupData();
    expect(data.memories).toEqual({
      desk_pet_memory_nahida: { facts: ['A'] },
      desk_pet_memory_other: { facts: ['B'] },
    });
  });

  it('无任何数据时返回空收集', async () => {
    const { data, entries, totalSize } = await collectBackupData();
    expect(Object.keys(data)).toHaveLength(0);
    expect(entries).toHaveLength(0);
    expect(totalSize).toBe(0);
  });
});

describe('backupEngine 还原写回', () => {
  it('applyData 按 logical 映射写回对应 localStorage 键', () => {
    applyData({
      chat_sessions: { sessions: [{ id: 's1' }] },
      settings: { lang: 'en' },
    });
    expect(JSON.parse(localStorage.getItem('deskpet_chat_sessions')!)).toEqual({
      sessions: [{ id: 's1' }],
    });
    expect(JSON.parse(localStorage.getItem('deskpet_settings')!)).toEqual({ lang: 'en' });
  });

  it('applyData 展开 memories 对象写回每个角色键', () => {
    applyData({
      memories: {
        desk_pet_memory_nahida: { facts: ['A'] },
        desk_pet_memory_other: { facts: ['B'] },
      },
    });
    expect(JSON.parse(localStorage.getItem('desk_pet_memory_nahida')!)).toEqual({
      facts: ['A'],
    });
    expect(JSON.parse(localStorage.getItem('desk_pet_memory_other')!)).toEqual({
      facts: ['B'],
    });
  });

  it('applyData 不写未提供的数据源（不覆盖现有键）', () => {
    localStorage.setItem('deskpet_settings', JSON.stringify({ lang: 'zh' }));
    applyData({ chat_sessions: { sessions: [] } });
    // settings 键未被触碰
    expect(JSON.parse(localStorage.getItem('deskpet_settings')!)).toEqual({ lang: 'zh' });
  });
});

describe('backupEngine 自动备份触发判断', () => {
  const base: BackupConfig = {
    enabled: true,
    frequency: 'daily',
    dir: '',
    keepCount: 5,
    lastBackup: 0,
  };

  it('disabled 时永不触发', () => {
    expect(isBackupDue({ ...base, enabled: false, frequency: 'startup' })).toBe(false);
  });

  it('startup 频率始终触发', () => {
    expect(isBackupDue({ ...base, frequency: 'startup' })).toBe(true);
  });

  it('daily：距上次备份不足 24h 不触发', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-07T12:00:00Z'));
    const cfg = {
      ...base,
      frequency: 'daily' as const,
      lastBackup: new Date('2026-08-06T13:00:00Z').getTime(),
    };
    expect(isBackupDue(cfg)).toBe(false);
  });

  it('daily：超过 24h 触发', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-07T12:00:00Z'));
    const cfg = {
      ...base,
      frequency: 'daily' as const,
      lastBackup: new Date('2026-08-06T11:00:00Z').getTime(),
    };
    expect(isBackupDue(cfg)).toBe(true);
  });

  it('weekly：7 天内不触发，超过触发', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-07T12:00:00Z'));
    expect(
      isBackupDue({
        ...base,
        frequency: 'weekly',
        lastBackup: new Date('2026-08-03T00:00:00Z').getTime(),
      }),
    ).toBe(false);
    expect(
      isBackupDue({
        ...base,
        frequency: 'weekly',
        lastBackup: new Date('2026-07-30T00:00:00Z').getTime(),
      }),
    ).toBe(true);
  });

  it('从未备份过（lastBackup=0）时 daily/weekly 立即触发', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-07T12:00:00Z'));
    expect(isBackupDue({ ...base, frequency: 'daily' })).toBe(true);
    expect(isBackupDue({ ...base, frequency: 'weekly' })).toBe(true);
  });
});
