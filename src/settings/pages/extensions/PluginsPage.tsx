import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '@iconify/react';
import { useNavigate } from 'react-router-dom';
import { Switch } from '../../components';
import { pluginRegistry } from '../../../services/skills';
import { pluginConfigManager } from '../../../services/skills/config';
import type { PluginMetadata, PluginConfigProperty } from '../../../services/skills/types';
import { PluginsPage as InstalledList } from '../system/PluginsPage';

/**
 * 扩展 → 插件：已安装插件管理页（纯列表）。
 *
 * 市场功能已独立为顶级「市场」板块（/settings/marketplace），
 * 本页只负责管理已安装插件的启用/禁用与参数配置。
 * 路由：/settings/extensions/plugins
 */
export function PluginsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <div className="p-4 animate-[fade-in-up_0.3s_ease-out]">
      {/* 去市场入口 */}
      <div
        className="mb-4 flex items-center gap-3 rounded-lg border border-neutral-200 bg-gradient-to-r from-neutral-50 to-white px-4 py-3 cursor-pointer hover:border-[var(--primary-300)] hover:shadow-sm transition-all"
        onClick={() => navigate('/settings/marketplace')}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && navigate('/settings/marketplace')}
      >
        <Icon icon="solar:shop-bold-duotone" className="text-xl text-[var(--primary-500)]" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-neutral-700">
            {t('settings.plugins_section.go_market')}
          </div>
          <div className="text-xs text-neutral-400">
            {t('settings.plugins_section.go_market_desc')}
          </div>
        </div>
        <Icon icon="solar:alt-arrow-right-linear" className="text-lg text-neutral-300" />
      </div>

      {/* 已安装插件列表（复用 system/PluginsPage） */}
      <InstalledList />
    </div>
  );
}

export default PluginsPage;
