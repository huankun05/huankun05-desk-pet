/**
 * 插件页跨组件 Tab 导航帮助
 *
 * 合并「市场 / 已安装 / 自写」为一个插件面板后，
 * 从市场页、MCP 页等跳转过来时需要定位到正确的分页。
 * - `pending` 机制：跨路由跳转（组件重新挂载）时携带目标 Tab。
 * - `event` 机制：同一插件页内直接切换（组件未卸载）时实时通知。
 */

export type PluginTab = 'market' | 'installed' | 'builder';

let pending: PluginTab = 'market';
const tabListeners = new Set<(tab: PluginTab) => void>();

/** 设置下次插件页挂载时的初始 Tab（跨路由跳转用） */
export const setPendingPluginTab = (tab: PluginTab): void => {
  pending = tab;
};

/** 读取并清空 pending Tab */
export const takePendingPluginTab = (): PluginTab => {
  const tab = pending;
  pending = 'market';
  return tab;
};

/** 订阅 Tab 切换事件（同一插件页内直接切换用） */
export const onPluginTabSwitch = (cb: (tab: PluginTab) => void): (() => void) => {
  tabListeners.add(cb);
  return () => {
    tabListeners.delete(cb);
  };
};

/** 触发 Tab 切换事件 */
export const emitPluginTabSwitch = (tab: PluginTab): void => {
  tabListeners.forEach((cb) => cb(tab));
};
