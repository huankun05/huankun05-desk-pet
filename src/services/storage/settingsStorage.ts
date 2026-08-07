import { createStorage } from '../storage';

/**
 * 全局共享的应用设置存储实例。
 *
 * 统一 petScale / statusPanelWidth / statusPanelHeight / edgeSnap 等设置项，
 * 供 useWindowManager、usePluginSystem 等模块共同读写，避免重复定义导致状态分裂。
 */
export const settingsStorage = createStorage('settings', {
  petScale: 1.0,
  statusPanelWidth: 420,
  statusPanelHeight: 700,
  edgeSnap: true,
  alwaysOnTop: true,
  settingsAlwaysOnTop: true,
  lang: 'zh-CN',
  autolaunch: false,
  closeBehavior: 'minimize_to_tray',
  trayLeftClick: 'show_menu',
  watchdogEnabled: true,
  offlineMode: false,
});
