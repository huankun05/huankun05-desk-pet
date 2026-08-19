import { lazy, Suspense } from 'react';

// 按窗口懒加载：主窗 / 各面板窗只加载自己需要的组件 chunk，
// 避免任一 webview 下载并解析全部窗口代码（Live2D / vosk 等重型依赖只随主窗进入）。
// 面板窗口（?panel=chat / ?panel=status / ?panel=controls）在此处直接返回对应面板组件，
// 不加载任何主应用 hook（WebSocket / VAD / 感知 / 行为系统等），
// 从架构上杜绝面板 webview 重复初始化主应用后台资源导致的内存爆炸。
const ChatPanelWindow = lazy(() => import('./components/Chat/ChatPanelWindow'));
const StatusPanelWindow = lazy(() => import('./components/Status/StatusPanelWindow'));
const MainPetApp = lazy(() => import('./MainPetApp'));
const ControlsOrb = lazy(() => import('./components/Pet/ControlsOrb'));

// 模块级初始化：在 React 挂载前设置基础样式（所有窗口模式共享）
if (typeof document !== 'undefined') {
  const isPanel = typeof window !== 'undefined' && window.location.search.includes('panel=');
  if (!isPanel) {
    // 主窗：透明背景（由 Rust 窗口属性 + CSS 共同决定）
    document.body.style.backgroundColor = 'transparent';
  } else if (window.location.search.includes('panel=controls')) {
    // 悬浮球窗口：透明背景，避免闪白且让透明区域穿透到桌面
    document.documentElement.style.backgroundColor = 'transparent';
    document.body.style.backgroundColor = 'transparent';
    const splash = document.getElementById('app-loading');
    if (splash) splash.remove();
  } else {
    // 面板窗：立即设置背景色防止闪白（用聊天主题的浅色底色，避免 React 渲染后变色闪烁）
    const bg = window.location.search.includes('panel=chat') ? '#f2f3f5' : '#ffffff';
    document.documentElement.style.backgroundColor = bg;
    document.body.style.backgroundColor = bg;
    const splash = document.getElementById('app-loading');
    if (splash) splash.remove();
  }
  document.body.style.margin = '0';
  document.body.style.overflow = 'hidden';
}

/**
 * 应用入口组件。
 *
 * 面板窗口（?panel=chat / ?panel=status）在此处直接返回对应的面板组件，
 * 不加载任何主应用 hook（WebSocket / VAD / 感知 / 行为系统等），
 * 从架构上杜绝面板 webview 重复初始化主应用后台资源导致的内存爆炸。
 *
 * 主窗口（无 panel 参数）渲染 <MainPetApp />，所有重型子系统集中在该组件内。
 */
function App() {
  const urlParams = new URLSearchParams(window.location.search);
  const panelMode = urlParams.get('panel');

  // 面板/主窗均按需加载组件 chunk；fallback 保持与模块级背景色一致，避免闪白
  const fallback = null;

  // 面板模式：直接返回，不初始化任何主应用 hook
  if (panelMode === 'status')
    return (
      <Suspense fallback={fallback}>
        <StatusPanelWindow />
      </Suspense>
    );
  if (panelMode === 'chat')
    return (
      <Suspense fallback={fallback}>
        <ChatPanelWindow />
      </Suspense>
    );
  if (panelMode === 'controls')
    return (
      <Suspense fallback={fallback}>
        <ControlsOrb />
      </Suspense>
    );

  // 主窗口：渲染完整桌面宠物应用（含 Live2D、语音、感知、行为系统等）
  return (
    <Suspense fallback={fallback}>
      <MainPetApp />
    </Suspense>
  );
}

export default App;
