import { isTauriEnv } from './tauriEnv';

/**
 * 打开操作系统原生文件夹选择器，返回用户选定的绝对路径。
 *
 * 为什么需要插件：Tauri 的 webview 是沙箱环境，网页无法调用系统原生
 * 文件夹对话框，且 <input type="file" webkitdirectory> 只返回相对路径、
 * 拿不到后端需要的绝对路径。tauri-plugin-dialog 底层是 Rust 的 rfd 库，
 * 调的就是 OS 原生对话框——这是从 webview 内拿到可用绝对路径的唯一 sanctioned 方式。
 *
 * @param defaultPath 初始目录（相对应用根或绝对路径）
 * @returns 选中的文件夹绝对路径；用户取消则返回 null
 */
export async function pickFolder(defaultPath?: string): Promise<string | null> {
  if (!isTauriEnv()) return null;
  try {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const selected = await open({
      directory: true,
      multiple: false,
      defaultPath,
    });
    if (Array.isArray(selected)) return selected[0] ?? null;
    return selected ?? null;
  } catch (err) {
    console.error('[pickFolder] failed:', err);
    return null;
  }
}
