/**
 * 插件安装器 - 下载、安装、卸载插件
 */

import { invoke } from '@tauri-apps/api/core';
import type { RegistryPlugin, RegistryMcpPreset, InstallResult, UpdateInfo } from './types';
import { recordInstall, recordUpdate, removeInstalled, getInstalled } from './storage';
import { fetchRegistry, invalidateCache } from './client';
import { addMcpServer, connectServer, removeMcpServer } from '../mcp/manager';
import { pluginRegistry } from '../skills/registry';
import type { McpServerConfig } from '../mcp/types';

/**
 * 下载并安装插件
 */
export async function installPlugin(plugin: RegistryPlugin): Promise<InstallResult> {
  try {
    // 1. 检查是否已安装
    const installed = getInstalled().find((r) => r.id === plugin.id);
    if (installed && installed.version === plugin.version) {
      return {
        success: true,
        pluginId: plugin.id,
        message: '插件已是最新版本',
      };
    }

    // 2. 检查权限变更
    if (installed) {
      const newPermissions = plugin.permissions.filter(
        (p) => !getInstalledPermissions(plugin.id).includes(p),
      );
      if (newPermissions.length > 0) {
        return {
          success: false,
          pluginId: plugin.id,
          message: '插件新增了权限，需要重新审批',
          requiresApproval: true,
          newPermissions,
        };
      }
    }

    // 3. 下载插件包
    if (plugin.downloadUrl) {
      await downloadAndExtract(plugin.downloadUrl, plugin.id);
    }

    // 4. 注册到 PluginRegistry
    await pluginRegistry.loadPlugin(plugin.id);

    // 5. 注册插件附带的 MCP 服务器（如有），并记录以便卸载时精确移除
    if (plugin.mcpServers && plugin.mcpServers.length > 0) {
      const registeredIds: string[] = [];
      for (const srv of plugin.mcpServers) {
        try {
          addMcpServer(srv);
          registeredIds.push(srv.id);
        } catch (e) {
          console.warn(`[Market] 注册插件 ${plugin.id} 的 MCP 服务器 ${srv.id} 失败:`, e);
        }
      }
      if (registeredIds.length > 0) {
        savePluginMcpServers(plugin.id, registeredIds);
      }
    }

    // 6. 记录安装
    recordInstall(plugin.id, plugin.version, 'market');
    saveInstalledPermissions(plugin.id, plugin.permissions);

    // 7. 刷新注册表缓存
    invalidateCache();

    return {
      success: true,
      pluginId: plugin.id,
      message: `${plugin.name} 安装成功`,
    };
  } catch (err) {
    return {
      success: false,
      pluginId: plugin.id,
      message: `安装失败: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * 卸载插件
 */
export async function uninstallPlugin(pluginId: string): Promise<void> {
  try {
    // 1. 从 PluginRegistry 注销
    await pluginRegistry.unloadPlugin(pluginId);

    // 2. 从 MCP 配置移除（精确移除安装时注册的服务器）
    const mcpIds = getPluginMcpServers(pluginId);
    for (const id of mcpIds) {
      try {
        removeMcpServer(id);
      } catch {
        // 服务器可能已被手动删除，忽略
      }
    }
    clearPluginMcpServers(pluginId);

    // 3. 删除插件目录
    try {
      await invoke('remove_plugin_dir', { pluginId });
    } catch {
      // 目录可能不存在，忽略
    }

    // 4. 移除安装记录
    removeInstalled(pluginId);
  } catch (err) {
    console.error(`[Market] Failed to uninstall ${pluginId}:`, err);
    throw err;
  }
}

/**
 * 用 argsTemplate 提供的取值（或默认值）替换 args 中的 {{key}} 占位符。
 * 返回替换后的 args，以及缺失必填项（模板项无默认值且未提供取值）的 key 列表。
 */
function resolveMcpArgs(
  args: string[],
  template: RegistryMcpPreset['argsTemplate'],
  values?: Record<string, string | number | boolean>,
): { args: string[]; missing: string[] } {
  const missing: string[] = [];
  const filled = (args ?? []).map((arg) =>
    arg.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
      const entry = template?.find((t) => t.key === key);
      const raw = values?.[key] ?? entry?.default;
      if (raw === undefined || raw === '') {
        missing.push(key);
        return '';
      }
      return String(raw);
    }),
  );
  return { args: filled, missing };
}

/**
 * 添加 MCP 预设
 *
 * @param argsValues 当预设含 argsTemplate 时，由调用方传入各占位符的取值；
 *                   缺省时回退到模板中定义的 default。仅当某占位符既无取值也无
 *                   default 时才要求用户配置（requiresApproval）。
 */
export async function installMcpPreset(
  preset: RegistryMcpPreset,
  argsValues?: Record<string, string | number | boolean>,
): Promise<InstallResult> {
  try {
    // 构建 MCP 服务器配置
    const serverConfig: McpServerConfig = {
      id: preset.id,
      name: preset.name,
      command: preset.command,
      args: preset.args,
      enabled: true,
    };

    // 如果有 argsTemplate，用取值/默认值填充 {{key}} 占位符
    if (preset.argsTemplate && preset.argsTemplate.length > 0) {
      const { args: resolvedArgs, missing } = resolveMcpArgs(
        preset.args,
        preset.argsTemplate,
        argsValues,
      );
      if (missing.length > 0) {
        return {
          success: false,
          message: `请填写必填参数: ${missing.join(', ')}`,
          requiresApproval: true,
          newPermissions: missing,
        };
      }
      serverConfig.args = resolvedArgs;
    }

    // 检查必填环境变量（浏览器环境通过 localStorage 存储）
    if (preset.envRequired && preset.envRequired.length > 0) {
      const missing = preset.envRequired.filter((env) => !localStorage.getItem(`mcp_env_${env}`));
      if (missing.length > 0) {
        return {
          success: false,
          message: `缺少必填环境变量: ${missing.join(', ')}`,
          requiresApproval: true,
          newPermissions: missing,
        };
      }
    }

    // 添加到 MCP 配置
    addMcpServer(serverConfig);
    await connectServer(serverConfig);

    return {
      success: true,
      pluginId: preset.id,
      message: `${preset.name} 已添加到 MCP 配置`,
    };
  } catch (err) {
    return {
      success: false,
      pluginId: preset.id,
      message: `添加失败: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * 检查更新
 */
export async function checkUpdates(): Promise<UpdateInfo[]> {
  const updates: UpdateInfo[] = [];
  try {
    const registry = await fetchRegistry(true);
    const installed = getInstalled();

    for (const record of installed) {
      const plugin = registry.plugins.find((p) => p.id === record.id);
      if (plugin && plugin.version !== record.version) {
        updates.push({
          pluginId: record.id,
          currentVersion: record.version,
          latestVersion: plugin.version,
        });
      }
    }
  } catch {
    // 忽略错误
  }
  return updates;
}

/**
 * 更新插件
 */
export async function updatePlugin(pluginId: string): Promise<InstallResult> {
  try {
    const registry = await fetchRegistry();
    const plugin = registry.plugins.find((p) => p.id === pluginId);
    if (!plugin) {
      return { success: false, pluginId, message: '插件不存在' };
    }

    const result = await installPlugin(plugin);
    if (result.success) {
      recordUpdate(pluginId, plugin.version);
    }
    return result;
  } catch (err) {
    return {
      success: false,
      pluginId,
      message: `更新失败: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * 下载并解压插件包
 * 通过 Tauri 后端下载 zip 并解压到 data/plugins/{pluginId}/
 */
async function downloadAndExtract(url: string, pluginId: string): Promise<void> {
  try {
    await invoke('download_and_extract_plugin', { url, pluginId });
  } catch (err) {
    throw new Error(`下载或解压失败: ${err instanceof Error ? err.message : String(err)}`, {
      cause: err,
    });
  }
}

/**
 * 获取插件已授权的权限（从 localStorage 读取）
 */
function getInstalledPermissions(pluginId: string): string[] {
  try {
    const stored = localStorage.getItem(`plugin_permissions_${pluginId}`);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

/** 保存插件已授权的权限 */
function saveInstalledPermissions(pluginId: string, permissions: string[]): void {
  try {
    localStorage.setItem(`plugin_permissions_${pluginId}`, JSON.stringify(permissions));
  } catch {
    // ignore
  }
}

/** 记录插件安装时注册的 MCP 服务器 id（供卸载时精确移除） */
function savePluginMcpServers(pluginId: string, ids: string[]): void {
  try {
    localStorage.setItem(`plugin_mcp_servers_${pluginId}`, JSON.stringify(ids));
  } catch {
    // ignore
  }
}

/** 读取插件安装时注册的 MCP 服务器 id 列表 */
function getPluginMcpServers(pluginId: string): string[] {
  try {
    const stored = localStorage.getItem(`plugin_mcp_servers_${pluginId}`);
    return stored ? (JSON.parse(stored) as string[]) : [];
  } catch {
    return [];
  }
}

/** 清除插件记录的 MCP 服务器 id 列表 */
function clearPluginMcpServers(pluginId: string): void {
  try {
    localStorage.removeItem(`plugin_mcp_servers_${pluginId}`);
  } catch {
    // ignore
  }
}
