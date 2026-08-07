import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { ThemeProvider } from '../theme';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { ToastProvider, ConfirmProvider } from './components';
import i18n from '../i18n';
import { routes } from './routes';
import { consumePendingSettingsPath } from '../utils/openSettings';
import '../iconify';
import './settings.css';

// 拦截窗口关闭：改为隐藏，避免重新创建导致闪白
const w = window as unknown as Record<string, unknown>;
if (w.__TAURI_INTERNALS__ || w.__TAURI__) {
  const win = getCurrentWindow();
  win.onCloseRequested((event) => {
    event.preventDefault();
    win.hide();
  });
}

// 消费来自主窗口的跨页跳转深链（写入 localStorage 的待跳转路由）
try {
  const pending = consumePendingSettingsPath();
  if (pending) {
    routes.navigate(pending);
  }
} catch {
  /* ignore */
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary pageLevel>
      <ToastProvider>
        <I18nextProvider i18n={i18n}>
          <ThemeProvider scope="admin">
            <ConfirmProvider>
              <RouterProvider router={routes} />
            </ConfirmProvider>
          </ThemeProvider>
        </I18nextProvider>
      </ToastProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
