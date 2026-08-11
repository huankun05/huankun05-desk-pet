import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Icon } from '@iconify/react';
import { Section, Modal, useToast } from '../../components';
import {
  fetchRegistry,
  filterPlugins,
  filterMcpPresets,
  isInstalled,
  getInstalledRecord,
  fetchAllStats,
  type RegistryPlugin,
  type RegistryMcpPreset,
  type PluginCategory,
  type PluginStats,
} from '../../../services/market';
import { installPlugin, installMcpPreset, updatePlugin } from '../../../services/market/installer';
import { setPendingPluginTab, emitPluginTabSwitch } from '../extensions/pluginNav';

type TabType = 'plugins' | 'mcp-presets';

/**
 * 插件市场页面（作为「扩展 → 插件」面板的「市场」分页挂载）
 * 路由：/settings/extensions/plugins（market 分页）
 */
export function PluginMarketPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [registry, setRegistry] = useState<Awaited<ReturnType<typeof fetchRegistry>> | null>(null);
  const [stats, setStats] = useState<Map<string, PluginStats>>(new Map());
  const [query, setQuery] = useState('');
  const [activeTab, setActiveTab] = useState<TabType>('plugins');
  const [activeCategory, setActiveCategory] = useState<PluginCategory | 'all'>('all');
  /** 待填写参数的 MCP 预设：当其 argsTemplate 含无默认值的占位符时需要用户填写 */
  const [mcpForm, setMcpForm] = useState<{
    preset: RegistryMcpPreset;
    values: Record<string, string>;
  } | null>(null);
  /** 网络不可达 / 加载失败的错误信息 */
  const [networkError, setNetworkError] = useState<string | null>(null);

  const loadRegistry = useCallback(async () => {
    setLoading(true);
    setNetworkError(null);
    try {
      const data = await fetchRegistry();
      setRegistry(data);
      // 并行获取统计数据（失败时静默降级，不阻塞主流程）
      try {
        const pluginStats = await fetchAllStats(data.plugins);
        setStats(pluginStats);
      } catch {
        /* stats 降级为空，不影响插件列表展示 */
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isAbort = err instanceof DOMException && err.name === 'AbortError';
      const userMsg = isAbort
        ? t('settings.market.network_error', {
            defaultValue: '网络连接超时或不可达，无法加载插件市场',
          })
        : t('settings.market.load_failed', { error: msg });
      setNetworkError(userMsg);
      // 仅在非 AbortError 时弹 toast（超时不刷屏）
      if (!isAbort) {
        showToast(userMsg, 'error');
      }
    } finally {
      setLoading(false);
    }
  }, [showToast, t]);

  useEffect(() => {
    loadRegistry();
  }, [loadRegistry]);

  const [_installingId, setInstallingId] = useState<string | null>(null);
  const handleInstall = async (plugin: RegistryPlugin) => {
    setInstallingId(plugin.id);
    showToast(t('settings.market.installing', { name: plugin.name }), 'info');
    try {
      const result = await installPlugin(plugin);
      if (result.success) {
        showToast(t('settings.market.install_success', { name: plugin.name }), 'success');
      } else if (result.requiresApproval) {
        showToast(
          result.message ?? t('settings.market.install_failed', { error: 'approval required' }),
          'warning',
        );
      } else {
        showToast(
          result.message ?? t('settings.market.install_failed', { error: 'unknown' }),
          'error',
        );
      }
    } catch (err) {
      showToast(
        t('settings.market.install_failed', {
          error: err instanceof Error ? err.message : String(err),
        }),
        'error',
      );
    } finally {
      setInstallingId(null);
    }
  };

  const handleInstallMcp = (preset: RegistryMcpPreset) => {
    // 含无默认值的占位符时，先弹出参数表单收集取值，再安装
    const needArgs = (preset.argsTemplate ?? []).filter((tpl) => tpl.default === undefined);
    if (needArgs.length > 0) {
      setMcpForm({ preset, values: {} });
      return;
    }
    void doInstallMcp(preset);
  };

  const doInstallMcp = async (
    preset: RegistryMcpPreset,
    argsValues?: Record<string, string | number | boolean>,
  ) => {
    setInstallingId(preset.id);
    showToast(t('settings.market.installing_mcp', { name: preset.name }), 'info');
    try {
      const result = await installMcpPreset(preset, argsValues);
      if (result.success) {
        showToast(t('settings.market.install_mcp_success', { name: preset.name }), 'success');
      } else if (result.requiresApproval) {
        showToast(
          result.message ?? t('settings.market.install_failed', { error: 'approval required' }),
          'warning',
        );
      } else {
        showToast(
          result.message ?? t('settings.market.install_failed', { error: 'unknown' }),
          'error',
        );
      }
    } catch (err) {
      showToast(
        t('settings.market.install_failed', {
          error: err instanceof Error ? err.message : String(err),
        }),
        'error',
      );
    } finally {
      setInstallingId(null);
    }
  };

  const handleConfirmMcpForm = () => {
    if (!mcpForm) return;
    const { preset, values } = mcpForm;
    setMcpForm(null);
    void doInstallMcp(preset, values);
  };

  const handleRefresh = () => {
    loadRegistry();
    showToast(t('settings.market.refreshed'), 'success');
  };

  const handleUpdate = async (plugin: RegistryPlugin) => {
    setInstallingId(plugin.id);
    showToast(t('settings.market.installing', { name: plugin.name }), 'info');
    try {
      const result = await updatePlugin(plugin.id);
      if (result.success) {
        showToast(t('settings.market.install_success', { name: plugin.name }), 'success');
      } else if (result.requiresApproval) {
        showToast(
          result.message ?? t('settings.market.install_failed', { error: 'approval required' }),
          'warning',
        );
      } else {
        showToast(
          result.message ?? t('settings.market.install_failed', { error: 'unknown' }),
          'error',
        );
      }
    } catch (err) {
      showToast(
        t('settings.market.install_failed', {
          error: err instanceof Error ? err.message : String(err),
        }),
        'error',
      );
    } finally {
      setInstallingId(null);
      await loadRegistry(); // 刷新版本展示
    }
  };

  const categories: Array<{ key: PluginCategory | 'all'; label: string; icon: string }> = [
    { key: 'all', label: t('settings.market.cat_all'), icon: 'solar:three-squares-bold-duotone' },
    { key: 'feature', label: t('settings.market.cat_feature'), icon: 'solar:star-bold-duotone' },
    {
      key: 'behavior',
      label: t('settings.market.cat_behavior'),
      icon: 'solar:user-heart-bold-duotone',
    },
    { key: 'tool', label: t('settings.market.cat_tool'), icon: 'solar:sledgehammer-bold-duotone' },
  ];

  const filteredPlugins = registry
    ? filterPlugins(registry, query, activeCategory === 'all' ? undefined : activeCategory)
    : [];

  const filteredPresets = registry ? filterMcpPresets(registry, query) : [];

  return (
    <div className="p-4 animate-[fade-in-up_0.3s_ease-out]">
      {/* 搜索栏 */}
      <div className="mb-4 flex items-center gap-3">
        <div className="relative flex-1">
          <Icon
            icon="solar:magnifer-bold-duotone"
            className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400"
          />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('settings.market.search_placeholder')}
            className="w-full rounded-lg border border-neutral-200 bg-white py-2 pl-9 pr-3 text-sm text-neutral-900 transition-colors placeholder:text-neutral-400 focus:border-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-200"
          />
        </div>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={loading}
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-neutral-200 bg-white text-neutral-600 transition-colors hover:bg-neutral-50 disabled:opacity-50"
          title={t('settings.market.refresh')}
        >
          <Icon
            icon="solar:refresh-bold-duotone"
            className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`}
          />
        </button>
        <button
          type="button"
          onClick={() => {
            setPendingPluginTab('builder');
            emitPluginTabSwitch('builder');
            navigate('/settings/extensions/plugins', { replace: true });
          }}
          className="flex h-9 items-center gap-1 rounded-lg border border-neutral-200 bg-white px-3 text-sm text-neutral-600 transition-colors hover:bg-neutral-50"
          title={t('settings.market.build_plugin')}
        >
          <Icon icon="solar:code-bold-duotone" className="h-4 w-4" />
          {t('settings.market.build_plugin')}
        </button>
      </div>

      {/* Tab 切换 */}
      <div className="mb-4 flex gap-1 rounded-lg bg-neutral-100 p-1">
        <button
          type="button"
          onClick={() => setActiveTab('plugins')}
          className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            activeTab === 'plugins'
              ? 'bg-white text-neutral-900 shadow-sm'
              : 'text-neutral-500 hover:text-neutral-700'
          }`}
        >
          {t('settings.market.tab_plugins')}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('mcp-presets')}
          className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            activeTab === 'mcp-presets'
              ? 'bg-white text-neutral-900 shadow-sm'
              : 'text-neutral-500 hover:text-neutral-700'
          }`}
        >
          {t('settings.market.tab_mcp')}
        </button>
      </div>

      {activeTab === 'plugins' && (
        <>
          {/* 分类筛选 */}
          <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
            {categories.map((cat) => (
              <button
                key={cat.key}
                type="button"
                onClick={() => setActiveCategory(cat.key)}
                className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  activeCategory === cat.key
                    ? 'border-neutral-800 bg-neutral-800 text-white'
                    : 'border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50'
                }`}
              >
                <Icon icon={cat.icon} className="h-3 w-3" />
                {cat.label}
              </button>
            ))}
          </div>

          {/* 插件列表 */}
          {loading ? (
            <div className="flex flex-col items-center justify-center py-12 text-neutral-400">
              <Icon icon="solar:refresh-circle-bold-duotone" className="h-8 w-8 animate-spin" />
              <span className="mt-2 text-sm">{t('settings.market.loading')}</span>
            </div>
          ) : networkError ? (
            <div className="flex flex-col items-center justify-center py-12 text-neutral-400">
              <Icon
                icon="solar:home-wifi-bold-duotone"
                className="mb-3 h-10 w-10 text-neutral-300"
              />
              <span className="text-sm font-medium text-neutral-600">{networkError}</span>
              <p className="mt-1 text-xs text-neutral-400">
                {t('settings.market.network_hint', { defaultValue: '请检查网络连接后点击重试' })}
              </p>
              <button
                type="button"
                onClick={handleRefresh}
                className="mt-4 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-neutral-800"
              >
                {t('settings.market.retry', { defaultValue: '重新加载' })}
              </button>
            </div>
          ) : filteredPlugins.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-neutral-400">
              <Icon icon="solar:box-bold-duotone" className="mb-2 h-10 w-10" />
              <span className="text-sm">{t('settings.market.no_plugins')}</span>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {filteredPlugins.map((plugin) => {
                const installed = isInstalled(plugin.id);
                const record = getInstalledRecord(plugin.id);
                const isSameVersion = record?.version === plugin.version;
                return (
                  <div
                    key={plugin.id}
                    className="rounded-xl border border-neutral-200 bg-white p-4 transition-shadow hover:shadow-md"
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-neutral-50 text-xl">
                        {plugin.icon}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <h3 className="truncate text-sm font-semibold text-neutral-900">
                            {plugin.name}
                          </h3>
                          <span className="shrink-0 rounded-full bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-500">
                            v{plugin.version}
                          </span>
                        </div>
                        <p className="mt-0.5 line-clamp-2 text-xs text-neutral-500">
                          {plugin.description}
                        </p>
                        <div className="mt-2 flex items-center gap-3 text-[11px] text-neutral-400">
                          <span className="flex items-center gap-0.5">
                            <Icon icon="solar:user-bold-duotone" className="h-3 w-3" />
                            {plugin.author}
                          </span>
                          <span className="flex items-center gap-0.5">
                            <Icon icon="solar:download-bold-duotone" className="h-3 w-3" />
                            {plugin.downloads}
                          </span>
                          {plugin.rating > 0 && (
                            <span className="flex items-center gap-0.5">
                              <Icon
                                icon="solar:star-bold-duotone"
                                className="h-3 w-3 text-yellow-500"
                              />
                              {plugin.rating.toFixed(1)}
                            </span>
                          )}
                          {/* 动态统计（来自 GitHub Reactions） */}
                          {(() => {
                            const s = stats.get(plugin.id);
                            if (!s) return null;
                            return (
                              <>
                                {s.stars > 0 && (
                                  <span
                                    className="flex items-center gap-0.5"
                                    title={t('settings.market.likes')}
                                  >
                                    <Icon
                                      icon="solar:like-bold-duotone"
                                      className="h-3 w-3 text-blue-500"
                                    />
                                    {s.stars}
                                  </span>
                                )}
                                {s.favorites > 0 && (
                                  <span
                                    className="flex items-center gap-0.5"
                                    title={t('settings.market.favorites')}
                                  >
                                    <Icon
                                      icon="solar:heart-bold-duotone"
                                      className="h-3 w-3 text-red-500"
                                    />
                                    {s.favorites}
                                  </span>
                                )}
                              </>
                            );
                          })()}
                        </div>
                      </div>
                    </div>
                    <div className="mt-3 flex items-center justify-between">
                      <div className="flex flex-wrap gap-1">
                        {plugin.permissions.slice(0, 2).map((perm) => (
                          <span
                            key={perm}
                            className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-500"
                          >
                            {perm}
                          </span>
                        ))}
                        {plugin.permissions.length > 2 && (
                          <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-400">
                            +{plugin.permissions.length - 2}
                          </span>
                        )}
                      </div>
                      {installed ? (
                        <button
                          type="button"
                          onClick={() => handleUpdate(plugin)}
                          disabled={isSameVersion}
                          className="rounded-lg border border-neutral-200 px-3 py-1 text-xs font-medium text-neutral-600 transition-colors hover:bg-neutral-50 disabled:opacity-50"
                        >
                          {isSameVersion
                            ? t('settings.market.installed')
                            : t('settings.market.update')}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleInstall(plugin)}
                          className="rounded-lg bg-neutral-900 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-neutral-800"
                        >
                          {t('settings.market.install')}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {activeTab === 'mcp-presets' && (
        <Section
          title={t('settings.market.mcp_section_title')}
          description={t('settings.market.mcp_section_desc')}
        >
          {loading ? (
            <div className="flex flex-col items-center justify-center py-12 text-neutral-400">
              <Icon icon="solar:refresh-circle-bold-duotone" className="h-8 w-8 animate-spin" />
              <span className="mt-2 text-sm">{t('settings.market.loading')}</span>
            </div>
          ) : networkError ? (
            <div className="flex flex-col items-center justify-center py-12 text-neutral-400">
              <Icon
                icon="solar:home-wifi-bold-duotone"
                className="mb-3 h-10 w-10 text-neutral-300"
              />
              <span className="text-sm font-medium text-neutral-600">{networkError}</span>
              <button
                type="button"
                onClick={handleRefresh}
                className="mt-4 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-neutral-800"
              >
                {t('settings.market.retry', { defaultValue: '重新加载' })}
              </button>
            </div>
          ) : filteredPresets.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-neutral-400">
              <Icon icon="solar:server-square-bold-duotone" className="mb-2 h-10 w-10" />
              <span className="text-sm">{t('settings.market.no_mcp_presets')}</span>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {filteredPresets.map((preset) => (
                <div
                  key={preset.id}
                  className="rounded-xl border border-neutral-200 bg-white p-4 transition-shadow hover:shadow-md"
                >
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-neutral-50 text-xl">
                      {preset.icon}
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate text-sm font-semibold text-neutral-900">
                        {preset.name}
                      </h3>
                      <p className="mt-0.5 text-xs text-neutral-500">{preset.description}</p>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {preset.envRequired?.map((env) => (
                          <span
                            key={env}
                            className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700"
                          >
                            {env}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleInstallMcp(preset)}
                    className="mt-3 w-full rounded-lg bg-neutral-900 py-1.5 text-xs font-medium text-white transition-colors hover:bg-neutral-800"
                  >
                    {t('settings.market.add_mcp')}
                  </button>
                </div>
              ))}
            </div>
          )}
        </Section>
      )}

      <Modal
        isOpen={mcpForm !== null}
        onClose={() => setMcpForm(null)}
        title={t('settings.market.mcp_args_title')}
        maxWidth="max-w-lg"
        footer={
          <>
            <button
              type="button"
              onClick={() => setMcpForm(null)}
              className="rounded-lg border border-neutral-200 bg-white px-4 py-2 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50"
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              onClick={handleConfirmMcpForm}
              className="rounded-lg bg-[var(--primary-500)] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--primary-600)]"
            >
              {t('settings.market.add_mcp')}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-xs text-neutral-500">{t('settings.market.mcp_args_desc')}</p>
          {mcpForm?.preset.argsTemplate
            ?.filter((tpl) => tpl.default === undefined)
            .map((tpl) =>
              tpl.type === 'boolean' ? (
                <label key={tpl.key} className="flex items-center gap-2 text-sm text-neutral-700">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-neutral-300 text-[var(--primary-500)] focus:ring-[var(--primary-100)]"
                    checked={mcpForm.values[tpl.key] === 'true'}
                    onChange={(e) =>
                      setMcpForm((prev) =>
                        prev
                          ? {
                              ...prev,
                              values: { ...prev.values, [tpl.key]: String(e.target.checked) },
                            }
                          : prev,
                      )
                    }
                  />
                  <span>{tpl.label}</span>
                </label>
              ) : (
                <div key={tpl.key}>
                  <label className="mb-1.5 block text-sm font-medium text-neutral-800">
                    {tpl.label}
                  </label>
                  <input
                    type={tpl.type === 'number' ? 'number' : 'text'}
                    className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 transition-colors placeholder:text-neutral-400 focus:border-[var(--primary-500)] focus:outline-none focus:ring-2 focus:ring-[var(--primary-100)]"
                    value={mcpForm.values[tpl.key] ?? ''}
                    onChange={(e) =>
                      setMcpForm((prev) =>
                        prev
                          ? { ...prev, values: { ...prev.values, [tpl.key]: e.target.value } }
                          : prev,
                      )
                    }
                    placeholder={tpl.default !== undefined ? String(tpl.default) : ''}
                  />
                </div>
              ),
            )}
        </div>
      </Modal>
    </div>
  );
}

export default PluginMarketPage;
