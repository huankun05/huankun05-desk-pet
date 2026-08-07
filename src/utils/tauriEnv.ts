/**
 * Tauri 环境守卫
 * =============
 * 在浏览器（非 Tauri WebView）中运行时，Tauri IPC 桥（window.__TAURI_INTERNALS__）
 * 不可用，调用 getCurrentWindow()/listen()/invoke() 会抛出
 * "Cannot read properties of undefined (reading 'metadata' / 'transformCallback')"。
 *
 * 通过 isTauriEnv() 在调用前判断，避免应用崩溃。
 */

let _cached: boolean | null = null;

/**
 * 判断当前是否运行在 Tauri WebView 中。
 * 缓存结果以避免重复检查。
 */
export function isTauriEnv(): boolean {
  if (_cached !== null) return _cached;
  if (typeof window === 'undefined') {
    _cached = false;
    return false;
  }
  // Tauri 2.0 注入的 IPC 桥
  _cached =
    '__TAURI_INTERNALS__' in window ||
    '__TAURI__' in window ||
    // 兜底：UA 包含 Tauri
    (typeof navigator !== 'undefined' && /Tauri/i.test(navigator.userAgent));
  return _cached;
}

/**
 * 安全调用 Tauri 窗口 API 的辅助函数。
 * 非Tauri环境或调用失败时返回 undefined，不抛错。
 */
export async function safeTauriCall<T>(fn: () => Promise<T> | T): Promise<T | undefined> {
  if (!isTauriEnv()) return undefined;
  try {
    return await fn();
  } catch {
    return undefined;
  }
}
