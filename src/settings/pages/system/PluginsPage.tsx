import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '@iconify/react';
import { Section, SettingRow, Switch } from '../../components';
import { pluginRegistry, registerBuiltinPlugins } from '../../../services/skills';
import { pluginConfigManager } from '../../../services/skills/config';
import type { PluginMetadata, PluginConfigProperty } from '../../../services/skills/types';

export function PluginsPage() {
  const [plugins, setPlugins] = useState<PluginMetadata[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [configs, setConfigs] = useState<Record<string, Record<string, unknown>>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const { t } = useTranslation();

  const loadPlugins = async () => {
    setIsLoading(true);
    // 确保内置插件已在当前窗口（设置窗是独立 webview，registry 与主窗不共享）注册
    registerBuiltinPlugins();
    const metadatas = pluginRegistry.getAllMetadata();
    setPlugins(metadatas);

    const configMap: Record<string, Record<string, unknown>> = {};
    for (const plugin of metadatas) {
      if (plugin.configSchema) {
        const config = await pluginConfigManager.loadConfig(plugin.id);
        configMap[plugin.id] = { ...config };
      }
    }
    setConfigs(configMap);
    setIsLoading(false);
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadPlugins();
  }, []);

  const handleToggle = async (id: string) => {
    const plugin = plugins.find((p) => p.id === id);
    if (!plugin || plugin.isBuiltin) return;

    await pluginRegistry.togglePlugin(id);
    setPlugins((prev) => prev.map((p) => (p.id === id ? { ...p, enabled: !p.enabled } : p)));
  };

  const handleExpand = async (id: string) => {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }

    if (!configs[id]) {
      const config = await pluginConfigManager.loadConfig(id);
      setConfigs((prev) => ({ ...prev, [id]: config }));
    }
    setExpandedId(id);
  };

  const handleConfigChange = (pluginId: string, key: string, value: unknown) => {
    setConfigs((prev) => ({
      ...prev,
      [pluginId]: {
        ...prev[pluginId],
        [key]: value,
      },
    }));
  };

  const handleSaveConfig = async (pluginId: string) => {
    setSavingId(pluginId);
    try {
      await pluginConfigManager.saveConfig(pluginId, configs[pluginId] || {});
    } finally {
      setTimeout(() => setSavingId(null), 500);
    }
  };

  const renderConfigField = (
    pluginId: string,
    key: string,
    prop: PluginConfigProperty,
    value: unknown,
  ) => {
    const onChange = (newValue: unknown) => handleConfigChange(pluginId, key, newValue);

    if (prop.type === 'boolean') {
      return <Switch checked={!!value} onChange={() => onChange(!value)} />;
    }

    if (prop.type === 'number') {
      return (
        <input
          type="number"
          value={Number(value) || 0}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-24 px-2 py-1 text-sm border border-neutral-200 rounded-md focus:outline-none focus:border-[var(--primary-400)]"
        />
      );
    }

    if (prop.type === 'string' && prop.enum && prop.enum.length > 0) {
      return (
        <select
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          className="px-2 py-1 text-sm border border-neutral-200 rounded-md focus:outline-none focus:border-[var(--primary-400)]"
        >
          {prop.enum.map((opt) => (
            <option key={String(opt)} value={String(opt)}>
              {String(opt)}
            </option>
          ))}
        </select>
      );
    }

    if (prop.type === 'string') {
      return (
        <input
          type="text"
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          className="w-32 px-2 py-1 text-sm border border-neutral-200 rounded-md focus:outline-none focus:border-[var(--primary-400)]"
        />
      );
    }

    return null;
  };

  return (
    <div className="p-4 animate-[fade-in-up_0.3s_ease-out]">
      <Section
        title={t('settings.plugins_section.title')}
        description={t('settings.plugins_section.desc')}
      >
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-neutral-500">
            <Icon icon="solar:restart-bold" className="text-lg animate-spin" />
            <span>{t('common.loading')}</span>
          </div>
        ) : (
          <div className="divide-y divide-neutral-100">
            {plugins.map((plugin, index) => {
              const isExpanded = expandedId === plugin.id;
              const config = configs[plugin.id] || {};
              const hasConfig =
                plugin.configSchema && Object.keys(plugin.configSchema.properties).length > 0;

              return (
                <div key={plugin.id} className="overflow-hidden">
                  <div
                    className="flex items-center justify-between gap-4 px-4 py-3 cursor-pointer hover:bg-neutral-50 transition-colors"
                    onClick={() => hasConfig && handleExpand(plugin.id)}
                    style={{
                      animation: 'fade-in-up 250ms ease forwards',
                      animationDelay: `${index * 30}ms`,
                      opacity: 0,
                    }}
                  >
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      {plugin.icon && plugin.icon.includes(':') ? (
                        <Icon icon={plugin.icon} className="text-2xl shrink-0" />
                      ) : (
                        <div className="text-2xl shrink-0">{plugin.icon || '📦'}</div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-neutral-800">
                            {plugin.name}
                          </span>
                          <span className="text-xs text-neutral-400">v{plugin.version}</span>
                          {plugin.isBuiltin && (
                            <span className="text-xs px-1.5 py-0.5 bg-neutral-100 text-neutral-500 rounded">
                              {t('settings.plugins_section.builtin')}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-neutral-400 mt-0.5 truncate">
                          {plugin.description}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {hasConfig && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleExpand(plugin.id);
                          }}
                          className="p-1.5 rounded-lg hover:bg-neutral-100 transition-colors"
                          aria-label={t('settings.plugins_section.configure')}
                        >
                          <Icon
                            icon="solar:settings-bold-duotone"
                            className="text-lg text-neutral-400"
                          />
                        </button>
                      )}
                      <Switch checked={plugin.enabled} onChange={() => handleToggle(plugin.id)} />
                    </div>
                  </div>

                  {isExpanded && hasConfig && plugin.configSchema && (
                    <div className="bg-neutral-50 border-t border-neutral-100 px-4 py-3">
                      <div className="space-y-2">
                        {Object.entries(plugin.configSchema.properties).map(([key, prop]) => (
                          <SettingRow
                            key={key}
                            title={prop.title || key}
                            description={prop.description}
                          >
                            {renderConfigField(plugin.id, key, prop, config[key])}
                          </SettingRow>
                        ))}
                      </div>
                      <div className="mt-4 flex justify-end">
                        <button
                          type="button"
                          onClick={() => handleSaveConfig(plugin.id)}
                          disabled={savingId === plugin.id}
                          className="px-4 py-1.5 text-sm font-medium text-white bg-[var(--primary-500)] rounded-lg hover:bg-[var(--primary-600)] transition-colors disabled:opacity-50"
                        >
                          {savingId === plugin.id
                            ? t('settings.plugins_section.saved')
                            : t('settings.plugins_section.save_config')}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Section>
    </div>
  );
}

export default PluginsPage;
