/**
 * StrictMode 安全的跨窗事件监听工具。
 *
 * 背景：Tauri 的 listen() 返回 Promise，unlisten 在其 resolve 后才可用。React
 * StrictMode（本项目 main.tsx 全局开启）在开发模式下会让 effect 经历
 * mount → unmount → remount：
 *   - 首次 mount 调用 listen()（Promise pending）
 *   - 立即 unmount 时，cleanup 里的 unlisten 还是 undefined → 本次注册的
 *     listener 没有被取消
 *   - remount 再次 listen() → 同一事件出现两个活着的 listener
 * 后果：同一个事件被处理两次。toggle 类操作（隐藏角色/锁/变形/淡入等）处理两次
 * = 回到原位，表现为「点了没反应」；打开类操作可能重复触发。
 *
 * 本函数保证 cleanup 一定取消：Promise 尚未 resolve 时，在其 resolve 后立即取消。
 * 返回 cleanup 函数，可直接作为 useEffect 的返回值。
 */

import { listen, type EventCallback, type EventName, type UnlistenFn } from '@tauri-apps/api/event';

export function listenStrictSafe<T>(event: EventName, handler: EventCallback<T>): () => void {
  let unlisten: UnlistenFn | null = null;
  const pending = listen<T>(event, handler);
  pending.then((u) => {
    unlisten = u;
  });
  return () => {
    if (unlisten) {
      unlisten();
    } else {
      // Promise 未 resolve（StrictMode 首轮 unmount）：resolve 后立即取消
      pending
        .then((u) => u())
        .catch(() => {
          /* ignore */
        });
    }
  };
}
