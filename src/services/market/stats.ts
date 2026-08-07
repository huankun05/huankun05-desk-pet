/**
 * 插件市场统计评分
 *
 * 基于 GitHub Issues + Reactions 的轻量评分系统：
 * - 每个插件对应一个 GitHub Issue
 * - 用户通过 Reactions 给插件点赞/收藏
 * - 统计 stars(👍)、favorites(❤️)、comments(💬) 数量
 */

import type { RegistryPlugin, PluginStats } from './types';

const REPO_OWNER = 'huankun05';
const REPO_NAME = 'desk-pet-registry';
const STATS_CACHE_KEY = 'market_plugin_stats';
const STATS_CACHE_TTL = 5 * 60 * 1000; // 5 分钟

interface StatsCache {
  data: Record<string, PluginStats>;
  timestamp: number;
}

/**
 * 获取所有插件的统计数据
 */
export async function fetchAllStats(
  plugins: RegistryPlugin[],
  forceRefresh = false,
): Promise<Map<string, PluginStats>> {
  const cached = getCachedStats();
  if (cached && !forceRefresh) {
    return new Map(Object.entries(cached.data));
  }

  const statsMap = new Map<string, PluginStats>();

  try {
    // 批量获取所有 Issue 的 Reactions
    const stats = await fetchStatsFromGitHub(plugins);
    for (const [id, stat] of stats) {
      statsMap.set(id, stat);
    }

    // 更新缓存
    setCachedStats(Object.fromEntries(statsMap));
  } catch {
    // 使用默认值
    for (const plugin of plugins) {
      statsMap.set(plugin.id, getDefaultStats(plugin));
    }
  }

  return statsMap;
}

/**
 * 获取单个插件的统计数据
 */
export async function fetchPluginStats(
  pluginId: string,
  plugins: RegistryPlugin[],
): Promise<PluginStats> {
  const cached = getCachedStats();
  if (cached?.data[pluginId]) {
    return cached.data[pluginId];
  }

  const plugin = plugins.find((p) => p.id === pluginId);
  if (!plugin) {
    return getDefaultStats();
  }

  try {
    const [stats] = await fetchStatsFromGitHub([plugin]);
    return stats[1] || getDefaultStats(plugin);
  } catch {
    return getDefaultStats(plugin);
  }
}

/**
 * 从 GitHub Issues + Reactions 获取统计
 */
async function fetchStatsFromGitHub(
  plugins: RegistryPlugin[],
): Promise<Array<[string, PluginStats]>> {
  const results: Array<[string, PluginStats]> = [];

  for (const plugin of plugins) {
    try {
      const issueNumber = plugin.metadata?.issueNumber;
      if (!issueNumber) {
        results.push([plugin.id, getDefaultStats(plugin)]);
        continue;
      }

      // 使用 GitHub API 获取 Issue 的 Reactions
      const response = await fetch(
        `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/issues/${issueNumber}`,
        {
          headers: {
            Accept: 'application/vnd.github.v3+json',
          },
        },
      );

      if (response.ok) {
        const issue = await response.json();
        const stats = parseIssueStats(issue, plugin);
        results.push([plugin.id, stats]);
      } else {
        results.push([plugin.id, getDefaultStats(plugin)]);
      }
    } catch {
      results.push([plugin.id, getDefaultStats(plugin)]);
    }
  }

  return results;
}

/**
 * 解析 GitHub Issue 统计
 */
function parseIssueStats(issue: GitHubIssue, plugin: RegistryPlugin): PluginStats {
  const reactions = issue.reactions || {};
  return {
    pluginId: plugin.id,
    stars: reactions['+1'] || 0,
    favorites: reactions['heart'] || 0,
    comments: issue.comments || 0,
    updatedAt: new Date(issue.updated_at || Date.now()).toISOString(),
  };
}

/**
 * 默认统计数据
 */
function getDefaultStats(plugin?: RegistryPlugin): PluginStats {
  return {
    pluginId: plugin?.id || 'unknown',
    stars: 0,
    favorites: 0,
    comments: 0,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * 获取缓存
 */
function getCachedStats(): StatsCache | null {
  try {
    const raw = localStorage.getItem(STATS_CACHE_KEY);
    if (!raw) return null;
    const cached: StatsCache = JSON.parse(raw);
    if (Date.now() - cached.timestamp > STATS_CACHE_TTL) {
      return null;
    }
    return cached;
  } catch {
    return null;
  }
}

/**
 * 设置缓存
 */
function setCachedStats(data: Record<string, PluginStats>): void {
  try {
    const cache: StatsCache = {
      data,
      timestamp: Date.now(),
    };
    localStorage.setItem(STATS_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // 忽略存储错误
  }
}

interface GitHubIssue {
  number: number;
  comments: number;
  updated_at: string;
  reactions?: {
    '+1'?: number;
    heart?: number;
  };
}
