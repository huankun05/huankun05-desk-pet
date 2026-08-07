/**
 * 插件市场相关类型定义
 */

import type { McpServerConfig } from '../mcp/types';

export type PluginCategory = 'feature' | 'behavior' | 'tool' | 'mcp-preset';

export type PluginRuntime = 'js' | 'js+mcp' | 'mcp-only';

export type InstallSource = 'market' | 'local' | 'builtin';

/** 注册表中的插件条目 */
export interface RegistryPlugin {
  id: string;
  name: string;
  version: string;
  description: string;
  icon: string;
  author: string;
  homepage?: string;
  category: PluginCategory;
  permissions: string[];
  runtime: PluginRuntime;
  downloadUrl?: string;
  size?: number;
  minAppVersion?: string;
  /** 插件附带的 MCP 服务器（安装时一并注册，卸载时一并移除） */
  mcpServers?: McpServerConfig[];
  downloads: number;
  rating: number;
  ratingCount: number;
  metadata?: {
    issueNumber?: number;
    [key: string]: unknown;
  };
}

/** 注册表中的 MCP 预设条目 */
export interface RegistryMcpPreset {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: PluginCategory;
  command: string;
  args: string[];
  argsTemplate?: Array<{
    key: string;
    label: string;
    type: 'string' | 'number' | 'boolean';
    default?: string | number | boolean;
  }>;
  envRequired?: string[];
  homepage?: string;
}

/** 注册表索引 */
export interface RegistryIndex {
  version: number;
  updated: string;
  plugins: RegistryPlugin[];
  mcpPresets: RegistryMcpPreset[];
}

/** 已安装记录 */
export interface InstalledRecord {
  id: string;
  version: string;
  source: InstallSource;
  installedAt: string;
  registryIssueNumber?: number;
  lastUpdatedCheck?: string;
}

/** 安装结果 */
export interface InstallResult {
  success: boolean;
  pluginId?: string;
  message?: string;
  requiresApproval?: boolean;
  newPermissions?: string[];
}

/** 更新信息 */
export interface UpdateInfo {
  pluginId: string;
  currentVersion: string;
  latestVersion: string;
  changelog?: string;
}

/** GitHub Issue Reaction 统计 */
export interface GithubIssueStats {
  issueNumber: number;
  favorites: number;
  recommendations: number;
  feedbackCount: number;
}

/** 插件动态统计（来自 GitHub Reactions） */
export interface PluginStats {
  pluginId: string;
  stars: number;
  favorites: number;
  comments: number;
  updatedAt: string;
}
