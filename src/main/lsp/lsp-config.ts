/**
 * LSP 配置类型定义
 *
 * 定义 LSP 语言服务器的配置结构，用于设置面板存储和读取。
 */

/** LSP 语言服务器配置 */
export interface LspServerConfig {
  /** 是否启用 */
  enabled: boolean;
  /** 语言服务器启动命令（如 typescript-language-server --stdio） */
  command: string;
  /** 命令参数（可选，从 command 中解析） */
  args?: string[];
  /** 工作区根目录（可选，默认为当前项目目录） */
  workspaceRoot?: string;
  /** 语言服务器名称（仅用于展示） */
  name?: string;
}

/** LSP 配置 */
export interface LspConfig {
  /** 是否全局启用 LSP */
  enabled: boolean;
  /** 语言服务器配置列表 */
  servers: LspServerConfig[];
}

/** LSP 连接状态 */
export interface LspConnectionStatus {
  /** 是否连接成功 */
  connected: boolean;
  /** 语言服务器名称 */
  serverName: string;
  /** 错误信息（连接失败时） */
  error?: string;
  /** 服务器版本（如果 initialize 返回） */
  serverVersion?: string;
  /** 测试时间戳 */
  testedAt: number;
}

/** 默认 LSP 配置 */
export const DEFAULT_LSP_CONFIG: LspConfig = {
  enabled: false,
  servers: [
    {
      enabled: false,
      command: "typescript-language-server --stdio",
      name: "TypeScript",
    },
  ],
};

/**
 * 解析命令行为命令和参数。
 *
 * @param commandLine 命令行字符串
 * @returns { command: string; args: string[] }
 */
export function parseCommandLine(commandLine: string): { command: string; args: string[] } {
  const trimmed = commandLine.trim();
  if (!trimmed) {
    return { command: "", args: [] };
  }

  // 简单的命令行解析：按空格分割，支持引号
  const args: string[] = [];
  let current = "";
  let inQuotes = false;
  let quoteChar = "";

  for (let i = 0; i < trimmed.length; i++) {
    const char = trimmed[i];
    if (inQuotes) {
      if (char === quoteChar) {
        inQuotes = false;
      } else {
        current += char;
      }
    } else if (char === '"' || char === "'") {
      inQuotes = true;
      quoteChar = char;
    } else if (char === " " || char === "\t") {
      if (current) {
        args.push(current);
        current = "";
      }
    } else {
      current += char;
    }
  }

  if (current) {
    args.push(current);
  }

  if (args.length === 0) {
    return { command: "", args: [] };
  }

  return {
    command: args[0],
    args: args.slice(1),
  };
}
