// LSP 真实进程包装 —— 使用 child_process.spawn 启动语言服务器。
//
// 实现 LSPProcess 接口，包装 Node.js child_process，供 LSPClient 使用。
// 测试时可以使用 MockLSPProcess 替代。

import { spawn, type ChildProcess } from "node:child_process";

// ── 进程抽象与客户端配置 ─────────────────────────────────────
// （原定义于 lsp-client.ts；该模块为死代码已删除，类型迁移至此）

/**
 * LSP 进程抽象接口。
 *
 * 真实实现会包装 child_process.spawn，测试时可以用 mock 实现。
 */
export interface LSPProcess {
  /** 向进程 stdin 写入数据 */
  write(data: string): void;
  /** 注册 stdout 数据回调 */
  onStdout(callback: (data: string) => void): void;
  /** 注册 stderr 数据回调 */
  onStderr(callback: (data: string) => void): void;
  /** 注册进程退出回调 */
  onExit(callback: (code: number | null) => void): void;
  /** 终止进程 */
  kill(): void;
  /** 进程是否已退出 */
  isExited(): boolean;
}

export interface LSPClientConfig {
  /** 语言服务器命令（如 "typescript-language-server"） */
  command: string;
  /** 命令参数（如 ["--stdio"]） */
  args?: string[];
  /** 工作区根目录 */
  workspaceRoot: string;
  /** 初始化超时（毫秒，默认 30000） */
  initializeTimeout?: number;
  /** 请求超时（毫秒，默认 10000） */
  requestTimeout?: number;
}

/**
 * 创建真实的 LSP 进程。
 *
 * 使用 child_process.spawn 启动语言服务器，设置 stdio 为 pipe，
 * 并包装为 LSPProcess 接口供 LSPClient 使用。
 *
 * @param config LSP 客户端配置（包含 command、args、workspaceRoot）
 * @returns LSPProcess 实例
 *
 * @example
 * ```typescript
 * const client = new LSPClient({
 *   command: "typescript-language-server",
 *   args: ["--stdio"],
 *   workspaceRoot: "/path/to/project",
 * });
 * await client.connect(createLSPProcess);
 * ```
 */
export function createLSPProcess(config: LSPClientConfig): LSPProcess {
  const { command, args = [], workspaceRoot } = config;

  // 启动语言服务器进程
  // stdio: ['pipe', 'pipe', 'pipe'] —— stdin/stdout/stderr 都通过管道通信
  // shell 仅对 .cmd/.bat 启用：cmd.exe 会把含括号等特殊字符的参数（如 node -e 脚本）
  // 拆解成多条命令并产生副作用（生成垃圾文件、注入风险，见 Node DEP0190）。
  // 普通可执行文件直接 spawn，参数原样传递，无 cmd 解析问题。
  const needsShell = process.platform === "win32" && /\.(cmd|bat)$/i.test(command);
  const child: ChildProcess = spawn(command, args, {
    cwd: workspaceRoot,
    stdio: ["pipe", "pipe", "pipe"],
    // 让子进程在父进程退出时也退出
    detached: false,
    ...(needsShell ? { shell: true } : {}),
  });

  let exited = false;
  const stdoutCallbacks: ((data: string) => void)[] = [];
  const stderrCallbacks: ((data: string) => void)[] = [];
  const exitCallbacks: ((code: number | null) => void)[] = [];

  // 监听 stdout 数据
  if (child.stdout) {
    child.stdout.on("data", (chunk: Buffer | string) => {
      const data = typeof chunk === "string" ? chunk : chunk.toString("utf-8");
      for (const cb of stdoutCallbacks) {
        try {
          cb(data);
        } catch {
          // 忽略回调异常，不影响其他回调
        }
      }
    });
  }

  // 监听 stderr 数据
  if (child.stderr) {
    child.stderr.on("data", (chunk: Buffer | string) => {
      const data = typeof chunk === "string" ? chunk : chunk.toString("utf-8");
      for (const cb of stderrCallbacks) {
        try {
          cb(data);
        } catch {
          // 忽略回调异常
        }
      }
    });
  }

  // 监听进程退出
  child.on("exit", (code: number | null) => {
    exited = true;
    for (const cb of exitCallbacks) {
      try {
        cb(code);
      } catch {
        // 忽略回调异常
      }
    }
  });

  // 监听进程错误（如启动失败）
  child.on("error", () => {
    exited = true;
    for (const cb of exitCallbacks) {
      try {
        cb(null);
      } catch {
        // 忽略回调异常
      }
    }
  });

  return {
    /**
     * 向进程 stdin 写入数据。
     * LSP 协议使用 Content-Length header + JSON body 格式。
     */
    write(data: string): void {
      if (exited || !child.stdin) {
        throw new Error("Cannot write to exited process");
      }
      child.stdin.write(data);
    },

    /**
     * 注册 stdout 数据回调。
     * 语言服务器通过 stdout 发送 LSP 响应和通知。
     */
    onStdout(callback: (data: string) => void): void {
      stdoutCallbacks.push(callback);
    },

    /**
     * 注册 stderr 数据回调。
     * 语言服务器通常通过 stderr 输出日志。
     */
    onStderr(callback: (data: string) => void): void {
      stderrCallbacks.push(callback);
    },

    /**
     * 注册进程退出回调。
     */
    onExit(callback: (code: number | null) => void): void {
      exitCallbacks.push(callback);
      // 如果进程已经退出，立即调用回调
      if (exited) {
        try {
          callback(child.exitCode);
        } catch {
          // 忽略回调异常
        }
      }
    },

    /**
     * 终止进程。
     * 先尝试优雅终止（SIGTERM），如果进程未退出则强制终止（SIGKILL）。
     */
    kill(): void {
      if (exited) return;

      try {
        // 先关闭 stdin，告诉进程没有更多输入
        if (child.stdin) {
          child.stdin.end();
        }
      } catch {
        // 忽略关闭 stdin 的错误
      }

      try {
        // 发送 SIGTERM 优雅终止
        child.kill("SIGTERM");
      } catch {
        // 忽略 kill 错误
      }

      // 标记为已退出（实际退出会触发 exit 事件）
      // 这里不立即设置 exited = true，因为 exit 事件可能还没触发
      // 但 isExited() 会检查 child.killed
    },

    /**
     * 检查进程是否已退出。
     */
    isExited(): boolean {
      return exited || child.killed || child.exitCode !== null;
    },
  };
}

/**
 * 检查语言服务器命令是否可用。
 *
 * 尝试启动命令并立即终止，用于在连接前检查语言服务器是否已安装。
 * 在 Windows 下使用 where 命令检查，在其他系统下使用 command -v。
 *
 * @param command 语言服务器命令
 * @returns Promise<boolean> 命令是否可用
 */
export async function isLSPCommandAvailable(command: string): Promise<boolean> {
  if (!command || command.trim().length === 0) {
    return false;
  }

  return new Promise((resolve) => {
    try {
      // 使用系统命令检查命令是否存在
      // Windows: where command
      // 其他: command -v command
      const checkCommand = process.platform === "win32" ? "where" : "command";
      const checkArgs = process.platform === "win32" ? [command] : ["-v", command];

      const child = spawn(checkCommand, checkArgs, {
        stdio: "ignore",
        ...(process.platform === "win32" ? { shell: true } : {}),
      });

      const timer = setTimeout(() => {
        try {
          child.kill();
        } catch {
          // 忽略
        }
        resolve(false);
      }, 5000);

      child.on("error", () => {
        clearTimeout(timer);
        resolve(false);
      });

      child.on("exit", (code) => {
        clearTimeout(timer);
        // 退出码为 0 表示命令存在
        resolve(code === 0);
      });
    } catch {
      resolve(false);
    }
  });
}
