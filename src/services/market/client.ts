/**
 * 注册表客户端 - 从 GitHub 获取插件市场数据
 */

import type {
  RegistryIndex,
  RegistryPlugin,
  RegistryMcpPreset,
  GithubIssueStats,
  PluginCategory,
} from './types';
import { fetchWithTimeout } from '../../utils/fetch';

const REGISTRY_RAW_URL =
  'https://raw.githubusercontent.com/huankun05/desk-pet-registry/main/registry.json';
const GITHUB_API_BASE = 'https://api.github.com/repos/huankun05/desk-pet-registry';

/** 缓存注册表数据，避免频繁请求 */
let cachedRegistry: RegistryIndex | null = null;
let lastFetchTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 分钟缓存

/**
 * 获取注册表索引（带缓存）
 */
export async function fetchRegistry(force = false): Promise<RegistryIndex> {
  const now = Date.now();
  if (!force && cachedRegistry && now - lastFetchTime < CACHE_TTL) {
    return cachedRegistry;
  }

  try {
    const response = await fetchWithTimeout(
      REGISTRY_RAW_URL,
      { headers: { Accept: 'application/vnd.github.v3.raw' } },
      15000,
    );
    if (!response.ok) {
      throw new Error(`Failed to fetch registry: ${response.status}`);
    }
    const data = (await response.json()) as RegistryIndex;
    cachedRegistry = data;
    lastFetchTime = now;
    return data;
  } catch (err) {
    // 如果缓存可用，返回过期缓存
    if (cachedRegistry) {
      console.warn('[Market] Using cached registry:', err);
      return cachedRegistry;
    }
    throw err;
  }
}

/**
 * 强制刷新注册表
 */
export function invalidateCache(): void {
  cachedRegistry = null;
  lastFetchTime = 0;
}

/**
 * 搜索/过滤插件
 */
export function filterPlugins(
  registry: RegistryIndex,
  query: string,
  category?: PluginCategory,
): RegistryPlugin[] {
  const q = query.trim().toLowerCase();
  return registry.plugins.filter((p) => {
    if (category && p.category !== category) return false;
    if (!q) return true;
    return (
      p.name.toLowerCase().includes(q) ||
      p.description.toLowerCase().includes(q) ||
      p.author.toLowerCase().includes(q)
    );
  });
}

/**
 * 获取 MCP 预设列表
 */
export function filterMcpPresets(registry: RegistryIndex, query?: string): RegistryMcpPreset[] {
  const q = query?.trim().toLowerCase();
  return registry.mcpPresets.filter((p) => {
    if (!q) return true;
    return p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q);
  });
}

/**
 * 获取 GitHub Issue 统计（收藏数等）
 */
export async function fetchIssueStats(issueNumber: number): Promise<GithubIssueStats> {
  try {
    const response = await fetchWithTimeout(
      `${GITHUB_API_BASE}/issues/${issueNumber}`,
      { headers: { Accept: 'application/vnd.github.v3+json' } },
      15000,
    );
    if (!response.ok) {
      throw new Error(`Failed to fetch issue #${issueNumber}: ${response.status}`);
    }
    const data = (await response.json()) as {
      reactions: { '+1': number; heart: number; hooray: number };
      comments: number;
      number: number;
    };
    return {
      issueNumber: data.number,
      favorites: data.reactions.heart || 0,
      recommendations: data.reactions.hooray || 0,
      feedbackCount: data.comments || 0,
    };
  } catch {
    return { issueNumber, favorites: 0, recommendations: 0, feedbackCount: 0 };
  }
}

/**
 * 为插件创建 Issue（用于统计）
 */
export async function createPluginIssue(
  pluginId: string,
  title: string,
  description: string,
): Promise<number | null> {
  try {
    const response = await fetchWithTimeout(
      `${GITHUB_API_BASE}/issues`,
      {
        method: 'POST',
        headers: {
          Accept: 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: pluginId,
          body: `## ${title}\n\n${description}\n\n---\n\n:heart: 收藏 | :tada: 推荐 | 评论反馈`,
          labels: ['plugin'],
        }),
      },
      15000,
    );
    if (!response.ok) {
      return null;
    }
    const data = (await response.json()) as { number: number };
    return data.number;
  } catch {
    return null;
  }
}
