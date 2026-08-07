import { Outlet, useMatches } from 'react-router-dom';
import { Icon } from '@iconify/react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from './PageHeader';
import { SettingsSearch } from './SettingsSearch';

export function SettingsLayout() {
  const { t } = useTranslation();
  const matches = useMatches();
  const currentMatch = matches[matches.length - 1];
  const meta = (currentMatch?.handle as unknown as { meta?: Record<string, string> })?.meta || {};

  const isSettingsRoot = matches.length === 2 && matches[1].pathname === '/settings';

  let title = meta.title || '设置';
  if (currentMatch?.pathname?.startsWith('/settings/chat')) {
    title = t('settings.nav.chat', { defaultValue: '聊天' });
  }

  return (
    <div className="h-full w-full flex flex-col bg-white">
      {/* Layer 1: 窗口标题栏（Tauri 拖拽区） */}
      <div
        data-tauri-drag-region
        className="h-11 fixed top-0 left-0 right-0 z-100 flex items-center gap-2 px-4 bg-white select-none"
      >
        <div className="flex items-center gap-2 rounded-md px-1.5 py-0.5 transition-colors hover:bg-neutral-100 cursor-pointer">
          <Icon
            icon="solar:settings-bold"
            className="text-base text-neutral-400 whitespace-nowrap"
          />
          <span className="text-sm text-neutral-700 whitespace-nowrap select-none">{title}</span>
        </div>
        <div className="flex-1" data-tauri-drag-region />
        <div className="flex items-center gap-2 rounded-md px-1.5 py-0.5 transition-colors hover:bg-neutral-100 cursor-pointer">
          <Icon
            icon="solar:info-circle-bold"
            className="text-base text-neutral-400 whitespace-nowrap"
          />
        </div>
      </div>

      {/* Layer 2: 主内容区（顶部留 44px 给窗口标题栏） */}
      <div className="flex-1 flex flex-col overflow-hidden pt-11">
        <div className="mx-auto h-full w-full max-w-screen-xl flex flex-col">
          <PageHeader
            title={title}
            subtitle={meta.subtitle}
            disableBackButton={isSettingsRoot}
            actions={<SettingsSearch />}
          />
          <div className="flex-1 overflow-y-auto scrollbar-none px-4 pb-12">
            <Outlet />
          </div>
        </div>
      </div>
    </div>
  );
}
