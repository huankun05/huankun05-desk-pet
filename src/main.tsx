import React from 'react';
import ReactDOM from 'react-dom/client';
import { I18nextProvider } from 'react-i18next';
import i18n from './i18n';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ThemeProvider } from './theme';
import './iconify';
import './index.css';
import { interactTTS } from './services/audio/interact-tts';
import { collectAllPresetTexts } from './data/idleMessages';

// ═══════════════════════════════════════════════════════════════
// Live2D 模型文件预加载 — 在 React 渲染前提前发起请求
// 浏览器在解析 HTML/JS 时就开始下载模型资源
// ═══════════════════════════════════════════════════════════════
performance.mark('app-start');

const MODEL_BASE = '/models/nahida/';
const preloadFetch = (href: string) => {
  const link = document.createElement('link');
  link.rel = 'preload';
  link.as = 'fetch';
  link.href = href;
  link.crossOrigin = 'anonymous';
  document.head.appendChild(link);
};
const preloadImage = (href: string) => {
  const link = document.createElement('link');
  link.rel = 'preload';
  link.as = 'image';
  link.href = href;
  document.head.appendChild(link);
};

// 预加载模型列表（仅主窗需要；面板窗 chat/status 不渲染 Live2D，跳过以节省带宽与启动时间）
if (!location.search.includes('panel=')) {
  preloadFetch('/models/index.json');
  // 默认预加载 nahida 模型（首次启动时使用）
  preloadFetch(MODEL_BASE + 'Nahida_1080.model3.json');
  preloadFetch(MODEL_BASE + 'Nahida_1080.moc3');
  preloadFetch(MODEL_BASE + 'Nahida_1080.physics3.json');
  preloadFetch(MODEL_BASE + 'Nahida_1080.cdi3.json');
  preloadImage(MODEL_BASE + 'Nahida_1080.1024/texture_00.png');
  preloadImage(MODEL_BASE + 'Nahida_1080.1024/texture_01.png');
  preloadImage(MODEL_BASE + 'Nahida_1080.1024/texture_02.png');
  preloadImage(MODEL_BASE + 'Nahida_1080.1024/texture_03.png');
}

console.time('app-to-model');

// 预热预制台词 TTS：仅当启用时生效。首次生成后由 IndexedDB 持久化，
// 之后启动直接从本地恢复，避免重复调用 TTS 服务（节省 API 成本与启动耗时）。
interactTTS.prewarm(collectAllPresetTexts()).catch(() => undefined);

// 主窗去白屏：tauri.conf.json 中主窗 visible:false，待 #app-loading 遮罩此刻已在 DOM 即
// 显示窗口，遮罩瞬间盖住首帧，用户看不到白闪。仅主窗执行（面板窗自行管理可见性）。
// useWindowManager 仍会在模型定位后再 show() 一次（幂等），双保险。
if (!location.search.includes('panel=')) {
  import('@tauri-apps/api/window')
    .then(({ getCurrentWindow }) => getCurrentWindow().show())
    .catch(() => {});
}

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element #root not found in DOM');
ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <ErrorBoundary pageLevel>
      <I18nextProvider i18n={i18n}>
        <ThemeProvider scope="pet">
          <App />
        </ThemeProvider>
      </I18nextProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
