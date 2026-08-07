import { useEffect, useRef } from 'react';

/**
 * 监听 localStorage 的 storage 事件，实现跨窗口同步。
 * 仅当数据变化时触发，替代轮询。
 *
 * @param key localStorage key
 * @param handler 数据变化时的回调
 * @param deps 依赖项（影响 handler 重建）
 */
export function useStorageEvent(
  key: string,
  handler: (newValue: string | null, oldValue: string | null) => void,
  deps: React.DependencyList = [],
) {
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  });

  useEffect(() => {
    const listener = (e: StorageEvent) => {
      if (e.key === key) {
        handlerRef.current(e.newValue, e.oldValue);
      }
    };
    window.addEventListener('storage', listener);
    return () => window.removeEventListener('storage', listener);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ...deps]);
}

/**
 * 监听多个 localStorage key 的变化。
 */
export function useStorageEvents(
  keys: string[],
  handler: (key: string, newValue: string | null, oldValue: string | null) => void,
  deps: React.DependencyList = [],
) {
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  });

  useEffect(() => {
    const listener = (e: StorageEvent) => {
      if (keys.includes(e.key ?? '')) {
        handlerRef.current(e.key ?? '', e.newValue, e.oldValue);
      }
    };
    window.addEventListener('storage', listener);
    return () => window.removeEventListener('storage', listener);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keys.join(','), ...deps]);
}

/**
 * 读取 localStorage，支持类型安全和异常处理。
 */
export function readStorage<T>(key: string, fallback: T): T {
  try {
    const saved = localStorage.getItem(key);
    return (saved as T) ?? fallback;
  } catch {
    return fallback;
  }
}

/**
 * 写入 localStorage 并触发同窗口的回调。
 * 注意：storage 事件只在其他窗口触发，同窗口需要手动处理。
 */
export function writeStorage(key: string, value: string) {
  const oldValue = localStorage.getItem(key);
  localStorage.setItem(key, value);
  window.dispatchEvent(new StorageEvent('storage', { key, newValue: value, oldValue }));
}
