/**
 * LSP 配置 IPC 处理器
 *
 * 处理渲染进程的 LSP 配置请求：
 * - 获取/保存 LSP 配置
 * - 测试 LSP 连接
 * - 获取 LSP 状态
 *
 * 配置存储在用户数据目录下的 lsp-config.json 文件中。
 */

import { ipcMain } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import { IPC } from "../../shared/ipc-channels";
import {
  DEFAULT_LSP_CONFIG,
  parseCommandLine,
  type LspConfig,
  type LspConnectionStatus,
} from "./lsp-config";
import { createLSPProcess, isLSPCommandAvailable } from "./lsp-process";
import type { LSPClientConfig } from "./lsp-process";
import {
  encodeRequest,
  decodeAllLSPMessages,
  isResponse,
  LSP_METHODS,
} from "./lsp-protocol";

// ── 配置存储 ─────────────────────────────────────────────────

let configPath: string | null = null;
let cachedConfig: LspConfig | null = null;

/**
 * 初始化配置存储路径。
 *
 * @param userDataDir Electron 用户数据目录
 */
export function initLspConfigStorage(userDataDir: string): void {
  configPath = path.join(userDataDir, "lsp-config.json");
  cachedConfig = null; // 清除缓存，下次读取时重新加载
}

/**
 * 读取 LSP 配置。
 *
 * @returns LspConfig
 */
export function getLspConfig(): LspConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  if (!configPath || !fs.existsSync(configPath)) {
    cachedConfig = { ...DEFAULT_LSP_CONFIG };
    return cachedConfig;
  }

  try {
    const content = fs.readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(content) as Partial<LspConfig>;
    cachedConfig = {
      enabled: parsed.enabled ?? DEFAULT_LSP_CONFIG.enabled,
      servers: parsed.servers ?? DEFAULT_LSP_CONFIG.servers,
    };
    return cachedConfig;
  } catch (error) {
    console.error("[lsp-config] Failed to read config, using default:", error);
    cachedConfig = { ...DEFAULT_LSP_CONFIG };
    return cachedConfig;
  }
}

/**
 * 保存 LSP 配置。
 *
 * @param config 新的配置
 * @returns boolean 是否保存成功
 */
export function saveLspConfig(config: LspConfig): boolean {
  if (!configPath) {
    console.error("[lsp-config] Config path not initialized");
    return false;
  }

  try {
    const dir = path.dirname(configPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
    cachedConfig = config;
    return true;
  } catch (error) {
    console.error("[lsp-config] Failed to save config:", error);
    return false;
  }
}

// ── 连接测试 ─────────────────────────────────────────────────

/**
 * 测试 LSP 连接。
 *
 * 启动语言服务器，发送 initialize 请求，等待响应。
 *
 * @param command 语言服务器启动命令
 * @param timeout 超时时间（毫秒），默认 10000
 * @returns Promise<LspConnectionStatus>
 */
export async function testLspConnection(
  command: string,
  timeout = 10000,
): Promise<LspConnectionStatus> {
  const parsed = parseCommandLine(command);
  if (!parsed.command) {
    return {
      connected: false,
      serverName: command,
      error: "命令为空",
      testedAt: Date.now(),
    };
  }

  // 检查命令是否可用
  const available = await isLSPCommandAvailable(parsed.command);
  if (!available) {
    return {
      connected: false,
      serverName: parsed.command,
      error: `命令 "${parsed.command}" 不可用，请检查是否已安装`,
      testedAt: Date.now(),
    };
  }

  let process: ReturnType<typeof createLSPProcess> | null = null;
  try {
    // 启动语言服务器
    const lspConfig: LSPClientConfig = {
      command: parsed.command,
      args: parsed.args,
      workspaceRoot: "",
    };
    process = createLSPProcess(lspConfig);

    // 发送 initialize 请求
    const requestId = 1;
    const initRequest = encodeRequest(requestId, LSP_METHODS.Initialize, {
      processId: null,
      rootUri: null,
      capabilities: {},
    });
    process.write(initRequest);

    // 等待响应
    const response = await new Promise<string | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), timeout);
      process?.onStdout((data) => {
        // 简单检查是否包含 JSON-RPC 响应
        if (data.includes(`"id":${requestId}`) || data.includes(`"id": ${requestId}`)) {
          clearTimeout(timer);
          resolve(data);
        }
      });
      process?.onExit(() => {
        clearTimeout(timer);
        resolve(null);
      });
    });

    if (!response) {
      return {
        connected: false,
        serverName: parsed.command,
        error: "连接超时，未收到 initialize 响应",
        testedAt: Date.now(),
      };
    }

    // 解析响应
    const { messages } = decodeAllLSPMessages(response);
    const parsedResponse = messages.find((msg) => isResponse(msg) && msg.id === requestId);
    if (!parsedResponse || !isResponse(parsedResponse)) {
      return {
        connected: false,
        serverName: parsed.command,
        error: "无法解析 initialize 响应",
        testedAt: Date.now(),
      };
    }

    if (parsedResponse.error) {
      return {
        connected: false,
        serverName: parsed.command,
        error: `initialize 失败：${parsedResponse.error.message}`,
        testedAt: Date.now(),
      };
    }

    const result = parsedResponse.result as { serverInfo?: { name?: string; version?: string } } | undefined;
    return {
      connected: true,
      serverName: result?.serverInfo?.name || parsed.command,
      serverVersion: result?.serverInfo?.version,
      testedAt: Date.now(),
    };
  } catch (error) {
    return {
      connected: false,
      serverName: parsed.command,
      error: `连接异常：${(error as Error).message}`,
      testedAt: Date.now(),
    };
  } finally {
    // 终止进程
    if (process && !process.isExited()) {
      process.kill();
    }
  }
}

// ── IPC 处理器注册 ───────────────────────────────────────────

/**
 * 注册 LSP 配置的 IPC 处理器。
 *
 * @returns 取消注册函数
 */
export function registerLspConfigIpcHandlers(): () => void {
  // 获取 LSP 配置
  ipcMain.handle(IPC.LSP_GET_CONFIG, () => {
    return getLspConfig();
  });

  // 保存 LSP 配置
  ipcMain.handle(IPC.LSP_SAVE_CONFIG, (_event, config: LspConfig) => {
    const success = saveLspConfig(config);
    return { success };
  });

  // 测试 LSP 连接
  ipcMain.handle(IPC.LSP_TEST_CONNECTION, async (_event, command: string) => {
    return testLspConnection(command);
  });

  // 获取 LSP 状态
  ipcMain.handle(IPC.LSP_GET_STATUS, () => {
    const config = getLspConfig();
    return {
      enabled: config.enabled,
      serverCount: config.servers.length,
      enabledServerCount: config.servers.filter((s) => s.enabled).length,
    };
  });

  return () => {
    ipcMain.removeHandler(IPC.LSP_GET_CONFIG);
    ipcMain.removeHandler(IPC.LSP_SAVE_CONFIG);
    ipcMain.removeHandler(IPC.LSP_TEST_CONNECTION);
    ipcMain.removeHandler(IPC.LSP_GET_STATUS);
  };
}
