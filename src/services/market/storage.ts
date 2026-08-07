/**
 * 已安装记录存储 - 持久化插件安装信息
 */

import { createStorage } from '../storage';
import type { InstalledRecord, InstallSource } from './types';

const storage = createStorage<{ installed: InstalledRecord[] }>(
  'market-installed',
  { installed: [] },
  { location: 'project' },
);

/**
 * 获取所有已安装记录
 */
export function getInstalled(): InstalledRecord[] {
  const data = storage.get();
  return data.installed;
}

/**
 * 检查插件是否已安装
 */
export function isInstalled(pluginId: string): boolean {
  return getInstalled().some((r) => r.id === pluginId);
}

/**
 * 获取单个已安装记录
 */
export function getInstalledRecord(pluginId: string): InstalledRecord | undefined {
  return getInstalled().find((r) => r.id === pluginId);
}

/**
 * 记录插件安装
 */
export function recordInstall(
  pluginId: string,
  version: string,
  source: InstallSource = 'market',
  registryIssueNumber?: number,
): InstalledRecord {
  const record: InstalledRecord = {
    id: pluginId,
    version,
    source,
    installedAt: new Date().toISOString(),
    registryIssueNumber,
  };
  const data = storage.get();
  const existingIndex = data.installed.findIndex((r) => r.id === pluginId);
  if (existingIndex >= 0) {
    data.installed[existingIndex] = record;
  } else {
    data.installed.push(record);
  }
  storage.set(data);
  return record;
}

/**
 * 记录插件更新
 */
export function recordUpdate(pluginId: string, newVersion: string): void {
  const data = storage.get();
  const record = data.installed.find((r) => r.id === pluginId);
  if (record) {
    record.version = newVersion;
    record.lastUpdatedCheck = new Date().toISOString();
    storage.set(data);
  }
}

/**
 * 移除安装记录
 */
export function removeInstalled(pluginId: string): void {
  const data = storage.get();
  data.installed = data.installed.filter((r) => r.id !== pluginId);
  storage.set(data);
}

/**
 * 检查更新时更新时间戳
 */
export function updateCheckTimestamp(): void {
  const data = storage.get();
  const now = new Date().toISOString();
  data.installed.forEach((r) => {
    r.lastUpdatedCheck = now;
  });
  storage.set(data);
}
