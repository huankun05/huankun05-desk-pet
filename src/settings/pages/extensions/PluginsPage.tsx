import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { PluginMarketPage } from '../services/PluginMarketPage';
import { PluginBuilderPage } from '../services/PluginBuilderPage';
import { PluginsPage as InstalledPlugins } from '../system/PluginsPage';
import { takePendingPluginTab, onPluginTabSwitch, type PluginTab } from './pluginNav';
import { SettingsJumpButton } from '../../components/SettingsJumpButton';

const TABS: { key: PluginTab; labelKey: string }[] = [
  { key: 'market', labelKey: 'settings.market.tab_plugins' },
  { key: 'installed', labelKey: 'settings.plugins_section.title' },
  { key: 'builder', labelKey: 'settings.market.build_plugin' },
];

/**
 * 扩展 → 插件：合并「市场 / 已安装 / 自写」三个入口为单一面板。
 * 路由：/settings/extensions/plugins
 */
export function PluginsPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<PluginTab>(() => takePendingPluginTab());

  // 同一插件页内：监听来自市场页 / MCP 页的切换请求
  useEffect(() => onPluginTabSwitch(setTab), []);

  return (
    <div className="p-4 animate-[fade-in-up_0.3s_ease-out]">
      <div className="mb-4 flex gap-1 rounded-lg bg-neutral-100 p-1">
        {TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setTab(item.key)}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              tab === item.key
                ? 'bg-white text-neutral-900 shadow-sm'
                : 'text-neutral-500 hover:text-neutral-700'
            }`}
          >
            {t(item.labelKey)}
          </button>
        ))}
      </div>

      {tab === 'market' && <PluginMarketPage />}
      {tab === 'installed' && <InstalledPlugins />}
      {tab === 'builder' && <PluginBuilderPage />}

      <div className="mt-6">
        <SettingsJumpButton
          to="/settings/extensions/mcp"
          label={t('settings.services_section.mcp')}
          icon="solar:server-square-bold-duotone"
          hint={t('settings.plugins_section.related_mcp_hint')}
        />
      </div>
    </div>
  );
}

export default PluginsPage;
