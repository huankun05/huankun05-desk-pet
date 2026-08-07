import { useStorageEvent } from './useStorageEvent';
import { setLogLevel as setGlobalLogLevel } from '../utils/logger';

interface UseAppStorageSyncOptions {
  showBubble: (text: string, duration?: number) => void;
}

/**
 * 封装跨窗口 storage 同步逻辑：
 * - 调试模式 & 日志级别同步
 * - 定时任务触发监听
 *
 * 注意：FPS 显示与淡出透明度已并入 appearanceConfig，由 App 统一监听；
 * 角色模型置顶已迁移到 settingsStorage + Rust set_always_on_top 命令。
 */
export function useAppStorageSync({ showBubble }: UseAppStorageSyncOptions): void {
  // 调试模式 & 日志级别跨窗口同步
  useStorageEvent(
    'desk-pet-log-level',
    (newValue) => {
      const debugMode = localStorage.getItem('desk-pet-debug-mode') === 'true';
      setGlobalLogLevel(debugMode ? 'debug' : (newValue as 'debug' | 'info' | 'warn' | 'error'));
    },
    [],
  );

  useStorageEvent(
    'desk-pet-debug-mode',
    (newValue) => {
      const debugMode = newValue === 'true';
      if (debugMode) {
        setGlobalLogLevel('debug');
      } else {
        const logLevel =
          (localStorage.getItem('desk-pet-log-level') as
            'debug' | 'info' | 'warn' | 'error' | null) || 'info';
        setGlobalLogLevel(logLevel);
      }
    },
    [],
  );

  // 监听定时任务触发（cronJobManager 通过 localStorage 事件通知）
  useStorageEvent(
    'deskpet_cron_trigger',
    (newValue) => {
      if (!newValue) return;
      try {
        const trigger = JSON.parse(newValue);
        if (trigger.name) {
          showBubble(`⏰ ${trigger.name}`, 5000);
        }
      } catch {
        /* ignore */
      }
    },
    [showBubble],
  );
}
