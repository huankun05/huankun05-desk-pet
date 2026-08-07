export type ToastKind = 'info' | 'success' | 'error' | 'warning';

const KIND_BG: Record<ToastKind, string> = {
  info: 'rgba(30, 41, 59, 0.92)',
  success: 'rgba(22, 163, 74, 0.95)',
  error: 'rgba(220, 38, 38, 0.95)',
  warning: 'rgba(217, 119, 6, 0.95)',
};

let container: HTMLDivElement | null = null;

function getContainer(): HTMLDivElement | null {
  if (typeof document === 'undefined') return null;
  if (!container) {
    container = document.createElement('div');
    container.setAttribute('data-toast-root', '');
    container.style.cssText =
      'position:fixed;top:16px;left:50%;transform:translateX(-50%);display:flex;flex-direction:column;gap:8px;z-index:10000;pointer-events:none;';
    document.body.appendChild(container);
  }
  return container;
}

/**
 * 轻量全局 Toast：默认顶部居中、自动消失。
 * 用于复制提示、发送失败等轻量反馈，避免每个组件自己拼 DOM。
 */
export function showToast(message: string, kind: ToastKind = 'info', duration = 2200): void {
  const root = getContainer();
  if (!root) return;
  try {
    const el = document.createElement('div');
    el.textContent = message;
    el.style.cssText = `pointer-events:auto;max-width:80vw;padding:8px 16px;border-radius:8px;color:#fff;font-size:13px;line-height:1.4;box-shadow:0 6px 20px rgba(0,0,0,0.25);background:${KIND_BG[kind]};animation:toastIn 180ms ease;`;
    root.appendChild(el);
    const remove = () => {
      el.style.opacity = '0';
      el.style.transition = 'opacity 200ms';
      setTimeout(() => el.remove(), 220);
    };
    setTimeout(remove, duration);
  } catch {
    // ignore
  }
}
