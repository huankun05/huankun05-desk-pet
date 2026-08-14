import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '@iconify/react';
import { useToast } from '../../components';
import {
  fetchRegistry,
  filterPlugins,
  filterMcpPresets,
  isInstalled,
  getInstalledRecord,
  fetchAllStats,
  installPlugin,
  installMcpPreset,
  updatePlugin,
  type RegistryPlugin,
  type RegistryMcpPreset,
  type PluginCategory,
  type PluginStats,
} from '../../../services/market';

type MarketTab = 'plugins' | 'mcp' | 'skills';

const TABS: { key: MarketTab; labelKey: string; icon: string }[] = [
  {
    key: 'plugins',
    labelKey: 'settings.marketplace.tab_plugins',
    icon: 'solar:plug-circle-bold-duotone',
  },
  {
    key: 'mcp',
    labelKey: 'settings.marketplace.tab_mcp',
    icon: 'solar:server-square-bold-duotone',
  },
  {
    key: 'skills',
    labelKey: 'settings.marketplace.tab_skills',
    icon: 'solar:magic-stick-3-bold-duotone',
  },
];

/**
 * 市场页面（位于「扩展」板块内）
 *
 * 三个顶级 tab 各自独立渲染内容，无嵌套子 tab：
 * - 插件：搜索 + 分类筛选 + 插件卡片网格
 * - MCP 预设：搜索 + 预设卡片网格
 * - 技能：建设中
 *
 * 路由：/settings/marketplace
 */
export function MarketplaceIndex() {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const [activeTab, setActiveTab] = useState<MarketTab>('plugins');

  // ---- 共享数据（插件 + MCP 共用 registry） ----
  const [loading, setLoading] = useState(true);
  const [registry, setRegistry] = useState<Awaited<ReturnType<typeof fetchRegistry>> | null>(null);
  const [stats, setStats] = useState<Map<string, PluginStats>>(new Map());
  const [query, setQuery] = useState('');
  const [networkError, setNetworkError] = useState<string | null>(null);

  // ---- 插件专属状态 ----
  const [activeCategory, setActiveCategory] = useState<PluginCategory | 'all'>('all');
  const [installingId, setInstallingId] = useState<string | null>(null);

  // ---- MCP 专属状态 ----
  const [mcpForm, setMcpForm] = useState<{
    preset: RegistryMcpPreset;
    values: Record<string, string>;
  } | null>(null);

  const loadRegistry = useCallback(async () => {
    setLoading(true);
    setNetworkError(null);
    try {
      const data = await fetchRegistry();
      setRegistry(data);
      try {
        const pluginStats = await fetchAllStats(data.plugins);
        setStats(pluginStats);
      } catch {
        /* stats 降级 */
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isAbort = err instanceof DOMException && err.name === 'AbortError';
      setNetworkError(
        isAbort
          ? t('settings.market.network_error', { defaultValue: '网络连接超时或不可达' })
          : t('settings.market.load_failed', { error: msg }),
      );
      if (!isAbort) {
        showToast(networkError ?? msg, 'error');
      }
    } finally {
      setLoading(false);
    }
  }, [showToast, t]);

  useEffect(() => {
    loadRegistry();
  }, [loadRegistry]);

  // ---- 插件操作 ----
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
      await loadRegistry();
    }
  };

  // ---- MCP 操作 ----
  const handleInstallMcp = (preset: RegistryMcpPreset) => {
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

  // ---- 分类（仅插件 tab 用） ----
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

  // ====== 渲染 ======
  return (
    <div className="p-4 animate-[fade-in-up_0.3s_ease-out]">
      {/* 页面标题 */}
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-neutral-800">
          {t('settings.marketplace.title')}
        </h1>
        <p className="text-sm text-neutral-400 mt-1">{t('settings.marketplace.description')}</p>
      </div>

      {/* 分类 Tab —— 三个顶级 tab，点击后下方直接显示对应内容，无嵌套 */}
      <div className="mb-6 flex gap-1 rounded-lg bg-neutral-100 p-1">
        {TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setActiveTab(item.key)}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
              activeTab === item.key
                ? 'bg-white text-neutral-900 shadow-sm'
                : 'text-neutral-500 hover:text-neutral-700'
            }`}
          >
            <Icon icon={item.icon} className="text-base" />
            {t(item.labelKey)}
          </button>
        ))}
      </div>

      {/* ========== 插件 Tab 内容 ========== */}
      {activeTab === 'plugins' && (
        <div>
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
              onClick={() => {
                loadRegistry();
                showToast(t('settings.market.refreshed'), 'success');
              }}
              disabled={loading}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-neutral-200 bg-white text-neutral-600 transition-colors hover:bg-neutral-50 disabled:opacity-50"
              title={t('settings.market.refresh')}
            >
              <Icon
                icon="solar:refresh-bold-duotone"
                className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`}
              />
            </button>
          </div>

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
                onClick={() => {
                  loadRegistry();
                }}
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
                        {plugin.icon?.includes(':') ? (
                          <Icon icon={plugin.icon} className="text-xl" />
                        ) : (
                          plugin.icon || '\u{1F4E6}'
                        )}
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
                          disabled={isSameVersion || installingId === plugin.id}
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
                          disabled={installingId === plugin.id}
                          className="rounded-lg bg-neutral-900 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-neutral-800 disabled:opacity-50"
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
        </div>
      )}

      {/* ========== MCP 预设 Tab 内容 ========== */}
      {activeTab === 'mcp' && (
        <div>
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
              onClick={() => {
                loadRegistry();
                showToast(t('settings.market.refreshed'), 'success');
              }}
              disabled={loading}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-neutral-200 bg-white text-neutral-600 transition-colors hover:bg-neutral-50 disabled:opacity-50"
              title={t('settings.market.refresh')}
            >
              <Icon
                icon="solar:refresh-bold-duotone"
                className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`}
              />
            </button>
          </div>

          {/* MCP 预设列表 */}
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
                onClick={() => {
                  loadRegistry();
                }}
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
                      {preset.icon?.includes(':') ? (
                        <Icon icon={preset.icon} className="text-xl" />
                      ) : (
                        preset.icon || '\u{1F5A5}'
                      )}
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
                    disabled={installingId === preset.id}
                    className="mt-3 w-full rounded-lg bg-neutral-900 py-1.5 text-xs font-medium text-white transition-colors hover:bg-neutral-800 disabled:opacity-50"
                  >
                    {t('settings.market.add_mcp')}
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* MCP 参数填写弹窗 */}
          {mcpForm !== null && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
              <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
                <h3 className="text-base font-semibold text-neutral-900">
                  {t('settings.market.mcp_args_title')}
                </h3>
                <p className="mt-1 text-xs text-neutral-500">
                  {t('settings.market.mcp_args_desc')}
                </p>
                <div className="mt-4 space-y-4">
                  {mcpForm.preset.argsTemplate
                    ?.filter((tpl) => tpl.default === undefined)
                    .map((tpl) =>
                      tpl.type === 'boolean' ? (
                        <label
                          key={tpl.key}
                          className="flex items-center gap-2 text-sm text-neutral-700"
                        >
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-neutral-300 accent-[var(--primary-500)] focus:ring-[var(--primary-100)]"
                            checked={mcpForm.values[tpl.key] === 'true'}
                            onChange={(e) =>
                              setMcpForm((prev) =>
                                prev
                                  ? {
                                      ...prev,
                                      values: {
                                        ...prev.values,
                                        [tpl.key]: String(e.target.checked),
                                      },
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
                                  ? {
                                      ...prev,
                                      values: { ...prev.values, [tpl.key]: e.target.value },
                                    }
                                  : prev,
                              )
                            }
                            placeholder={tpl.default !== undefined ? String(tpl.default) : ''}
                          />
                        </div>
                      ),
                    )}
                </div>
                <div className="mt-6 flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setMcpForm(null)}
                    className="rounded-lg border border-neutral-200 bg-white px-4 py-2 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50"
                  >
                    {t('common.cancel')}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (!mcpForm) return;
                      const { preset, values } = mcpForm;
                      setMcpForm(null);
                      void doInstallMcp(preset, values);
                    }}
                    className="rounded-lg bg-[var(--primary-500)] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--primary-600)]"
                  >
                    {t('settings.market.add_mcp')}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ========== 技能 Tab 内容 ========== */}
      {activeTab === 'skills' && (
        <div className="flex flex-col items-center justify-center py-16 text-neutral-400">
          <Icon icon="solar:construction-bold-duotone" className="text-5xl mb-4 opacity-40" />
          <p className="text-sm font-medium">{t('settings.marketplace.coming_soon')}</p>
          <p className="text-xs mt-1">{t('settings.marketplace.coming_soon_desc')}</p>
        </div>
      )}
    </div>
  );
}

export default MarketplaceIndex;
