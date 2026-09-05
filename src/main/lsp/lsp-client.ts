// LSP 客户端框架 —— 管理语言服务器连接、发送请求、接收响应、存储诊断。
//
// 设计原则：
// - 使用依赖注入的进程抽象（LSPProcess），便于单元测试
// - 支持请求/响应匹配（通过 id）
// - 支持诊断存储（push diagnostics）
// - 支持文本文档同步（didOpen/didChange/didClose）
// - 优雅关闭（shutdown + exit）

import {
  encodeRequest,
  encodeNotification,
  decodeAllLSPMessages,
  isResponse,
  isNotification,
  LSP_METHODS,
  type LSPMessage,
  type LSPResponse,
  type Diagnostic,
  type PublishDiagnosticsParams,
} from "./lsp-protocol";

// ── 进程抽象 ─────────────────────────────────────────────────

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

// ── 客户端配置 ───────────────────────────────────────────────

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

// ── 客户端状态 ───────────────────────────────────────────────

export type LSPClientState = "idle" | "initializing" | "initialized" | "shutdown" | "exited" | "error";

// ── 请求回调 ─────────────────────────────────────────────────

interface PendingRequest {
  resolve: (response: LSPResponse) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

// ── LSP 客户端 ───────────────────────────────────────────────

export class LSPClient {
  private config: LSPClientConfig;
  private process: LSPProcess | null = null;
  private state: LSPClientState = "idle";
  private requestId = 0;
  private pendingRequests = new Map<number | string, PendingRequest>();
  private stdoutBuffer = "";
  private diagnostics = new Map<string, Diagnostic[]>();
  private initializeTimeout: number;
  private requestTimeout: number;

  constructor(config: LSPClientConfig) {
    this.config = config;
    this.initializeTimeout = config.initializeTimeout ?? 30000;
    this.requestTimeout = config.requestTimeout ?? 10000;
  }

  /** 获取当前状态 */
  getState(): LSPClientState {
    return this.state;
  }

  /**
   * 连接到语言服务器。
   *
   * @param processFactory 进程工厂函数（用于创建 LSPProcess，便于测试注入）
   */
  async connect(processFactory: (config: LSPClientConfig) => LSPProcess): Promise<void> {
    if (this.state !== "idle") {
      throw new Error(`Cannot connect in state: ${this.state}`);
    }

    this.state = "initializing";
    this.process = processFactory(this.config);

    // 注册 stdout 回调
    this.process.onStdout((data) => {
      this.stdoutBuffer += data;
      this.processStdoutBuffer();
    });

    // 注册 stderr 回调（暂时忽略，后续可添加日志）
    this.process.onStderr(() => {
      // 暂时忽略 stderr
    });

    // 注册退出回调
    this.process.onExit((code) => {
      this.state = "exited";
      // 拒绝所有 pending 请求
      for (const [, pending] of this.pendingRequests) {
        clearTimeout(pending.timer);
        pending.reject(new Error(`Language server exited with code ${code}`));
      }
      this.pendingRequests.clear();
    });

    // 发送 initialize 请求
    const initializeParams = {
      processId: null,
      rootUri: `file://${this.config.workspaceRoot}`,
      capabilities: {},
      workspaceFolders: null,
    };

    try {
      const response = await this.sendRequest(LSP_METHODS.Initialize, initializeParams, this.initializeTimeout);
      if (response.error) {
        throw new Error(`Initialize failed: ${response.error.message}`);
      }
      this.state = "initialized";

      // 发送 initialized 通知
      this.sendNotification(LSP_METHODS.Initialized, {});
    } catch (error) {
      this.state = "error";
      // 终止进程，避免进程泄漏
      if (this.process && !this.process.isExited()) {
        this.process.kill();
      }
      throw error;
    }
  }

  /**
   * 发送请求并等待响应。
   */
  sendRequest(method: string, params?: unknown, timeout?: number): Promise<LSPResponse> {
    if (!this.process || this.process.isExited()) {
      return Promise.reject(new Error("Language server is not connected"));
    }

    const id = ++this.requestId;
    const requestTimeout = timeout ?? this.requestTimeout;

    return new Promise<LSPResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request timeout: ${method}`));
      }, requestTimeout);

      this.pendingRequests.set(id, { resolve, reject, timer });

      try {
        const encoded = encodeRequest(id, method, params);
        this.process!.write(encoded);
      } catch (error) {
        clearTimeout(timer);
        this.pendingRequests.delete(id);
        reject(error as Error);
      }
    });
  }

  /**
   * 发送通知（不需要响应）。
   */
  sendNotification(method: string, params?: unknown): void {
    if (!this.process || this.process.isExited()) {
      throw new Error("Language server is not connected");
    }
    const encoded = encodeNotification(method, params);
    this.process.write(encoded);
  }

  /**
   * 打开文本文档。
   */
  openDocument(uri: string, languageId: string, version: number, text: string): void {
    this.sendNotification(LSP_METHODS.TextDocumentDidOpen, {
      textDocument: { uri, languageId, version, text },
    });
  }

  /**
   * 更改文本文档（全量替换）。
   */
  changeDocument(uri: string, version: number, text: string): void {
    this.sendNotification(LSP_METHODS.TextDocumentDidChange, {
      textDocument: { uri, version },
      contentChanges: [{ text }],
    });
  }

  /**
   * 关闭文本文档。
   */
  closeDocument(uri: string): void {
    this.sendNotification(LSP_METHODS.TextDocumentDidClose, {
      textDocument: { uri },
    });
  }

  /**
   * 获取文件的诊断信息。
   */
  getDiagnostics(uri: string): Diagnostic[] {
    return this.diagnostics.get(uri) ?? [];
  }

  /**
   * 获取所有诊断信息。
   */
  getAllDiagnostics(): Map<string, Diagnostic[]> {
    return new Map(this.diagnostics);
  }

  /**
   * 清除文件的诊断信息。
   */
  clearDiagnostics(uri: string): void {
    this.diagnostics.delete(uri);
  }

  /**
   * 优雅关闭语言服务器。
   */
  async shutdown(): Promise<void> {
    if (this.state !== "initialized") {
      // 已经关闭或未初始化，直接返回
      return;
    }

    try {
      await this.sendRequest(LSP_METHODS.Shutdown, undefined, 5000);
    } catch {
      // 忽略 shutdown 错误
    }

    this.state = "shutdown";

    // 发送 exit 通知
    try {
      this.sendNotification(LSP_METHODS.Exit);
    } catch {
      // 忽略 exit 错误
    }

    // 终止进程
    if (this.process && !this.process.isExited()) {
      this.process.kill();
    }
  }

  // ── 内部方法 ──────────────────────────────────────────────

  /**
   * 处理 stdout 缓冲区中的数据。
   */
  private processStdoutBuffer(): void {
    const { messages, remaining } = decodeAllLSPMessages(this.stdoutBuffer);
    this.stdoutBuffer = remaining;

    for (const message of messages) {
      this.handleMessage(message);
    }
  }

  /**
   * 处理单条 LSP 消息。
   */
  private handleMessage(message: LSPMessage): void {
    if (isResponse(message)) {
      this.handleResponse(message);
    } else if (isNotification(message)) {
      this.handleNotification(message);
    }
  }

  /**
   * 处理响应消息。
   */
  private handleResponse(response: LSPResponse): void {
    if (response.id === null) return;
    const pending = this.pendingRequests.get(response.id);
    if (!pending) return;

    clearTimeout(pending.timer);
    this.pendingRequests.delete(response.id);
    pending.resolve(response);
  }

  /**
   * 处理通知消息。
   */
  private handleNotification(notification: LSPMessage): void {
    if (!isNotification(notification)) return;

    if (notification.method === LSP_METHODS.TextDocumentPublishDiagnostics) {
      const params = notification.params as PublishDiagnosticsParams;
      if (params && params.uri) {
        this.diagnostics.set(params.uri, params.diagnostics ?? []);
      }
    }
    // 其他通知暂时忽略
  }
}
