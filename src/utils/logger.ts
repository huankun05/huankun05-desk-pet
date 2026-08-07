/**
 * Logger：统一日志工具
 *
 * 提供带命名前缀、时间戳、分级控制的日志输出。
 * 用法：
 *   const log = createLogger('TTS');
 *   log.info('synthesis started', { text: '...' });
 *   log.warn('fallback to CPU');
 *   log.error('failed', err);
 *
 * 全局控制：
 *   setLogLevel('verbose') — 显示所有日志 + info 级转发后端
 *   setLogLevel('debug')  — 显示所有日志
 *   setLogLevel('info')   — 默认
 *   setLogLevel('warn')   — 仅 warn/error
 *   setLogLevel('error')  — 仅 error
 *   setLogLevel('silent') — 关闭所有
 */

import { fetchWithTimeout } from './fetch';

type LogLevel = 'verbose' | 'debug' | 'info' | 'warn' | 'error' | 'silent';

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  verbose: -1,
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4,
};

let globalLevel: LogLevel = 'info';

export function setLogLevel(level: LogLevel): void {
  globalLevel = level;
}

export function getLogLevel(): LogLevel {
  return globalLevel;
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[globalLevel];
}

function timestamp(): string {
  const now = new Date();
  const h = String(now.getHours()).padStart(2, '0');
  const m = String(now.getMinutes()).padStart(2, '0');
  const s = String(now.getSeconds()).padStart(2, '0');
  const ms = String(now.getMilliseconds()).padStart(3, '0');
  return `${h}:${m}:${s}.${ms}`;
}

function formatArgs(args: unknown[]): string {
  return args
    .map((a) => {
      if (typeof a === 'string') return a;
      if (a instanceof Error) return `${a.message}\n${a.stack ?? ''}`;
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(' ');
}

/**
 * 将 error 级别日志转发到后端日志系统
 * 确保关键错误即使在 webview 控制台中也能被 Logs 页面查看
 * 仅在 Tauri 环境中发送（dev server 无 /api/log 端点会触发 ERR_ABORTED）
 */
async function sendToBackendLog(level: string, name: string, message: string): Promise<void> {
  if (!(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__) return;
  try {
    await fetchWithTimeout(
      '/api/log',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ level, source: name, message }),
      },
      3000,
    );
  } catch {
    // 静默失败，不阻塞主流程
  }
}

export interface Logger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

export function createLogger(name: string): Logger {
  const prefix = `[${name}]`;

  return {
    debug(...args: unknown[]) {
      if (!shouldLog('debug')) return;
      console.debug(`${timestamp()} ${prefix}`, ...args);
    },
    info(...args: unknown[]) {
      if (!shouldLog('info')) return;
      const msg = formatArgs(args);
      console.info(`${timestamp()} ${prefix}`, ...args);
      // verbose 模式下 info 级日志也转发到后端
      if (globalLevel === 'verbose') {
        sendToBackendLog('info', name, msg);
      }
    },
    warn(...args: unknown[]) {
      if (!shouldLog('warn')) return;
      const msg = formatArgs(args);
      console.warn(`${timestamp()} ${prefix}`, ...args);
      // 关键警告也转发到后端
      sendToBackendLog('warn', name, msg);
    },
    error(...args: unknown[]) {
      if (!shouldLog('error')) return;
      const msg = formatArgs(args);
      console.error(`${timestamp()} ${prefix}`, ...args);
      // 所有错误转发到后端
      sendToBackendLog('error', name, msg);
    },
  };
}
