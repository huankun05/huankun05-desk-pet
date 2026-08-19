import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '@iconify/react';
import { Section, SettingRow } from '../../components';
import { useToast } from '../../components';
import { toolRegistry } from '../../../services/tools/registry';
import { registerBuiltinTools } from '../../../services/tools/builtins';
import { getAllServerStatuses } from '../../../services/mcp/manager';
import { fetchModeTools, type ModeToolsInfo } from '../../../services/gatewayApi';
import { getDisabledTools, setToolDisabled } from '../../../services/tools/toolManagement';

interface ToolView {
  name: string;
  description: string;
  source: 'frontend' | 'backend' | 'mcp';
  chat: boolean;
  work: boolean;
  disabled: boolean;
}

const BACKEND_DESC: Record<string, string> = {
  echo: '回声测试工具',
  get_current_time: '获取当前服务器时间',
};

const SOURCE_LABEL: Record<ToolView['source'], string> = {
  frontend: '前端',
  backend: '后端',
  mcp: 'MCP',
};

export function ToolsPage() {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const [modeTools, setModeTools] = useState<ModeToolsInfo | null>(null);
  const [tools, setTools] = useState<ToolView[]>([]);
  const [disabled, setDisabled] = useState<string[]>([]);

  const refresh = useCallback(() => {
    const m = getDisabledTools();
    setDisabled(m);
    const frontend = toolRegistry.getAll().map((tt) => ({
      name: tt.name,
      description: tt.description,
      source: 'frontend' as const,
    }));
    const backend = (modeTools?.backend ?? []).map((n) => ({
      name: n,
      description: BACKEND_DESC[n] ?? '后端工具',
      source: 'backend' as const,
    }));
    const mcp = getAllServerStatuses()
      .flatMap((s) => s.tools ?? [])
      .map((tt) => ({
        name: tt.name,
        description: tt.description,
        source: 'mcp' as const,
      }));

    const all = [...frontend, ...backend, ...mcp];
    const chatWl = modeTools?.chat ?? null;
    const workWl = modeTools?.work ?? null;
    setTools(
      all.map((x) => ({
        ...x,
        chat: chatWl ? chatWl.includes(x.name) : true,
        work: workWl ? workWl.includes(x.name) : true,
        disabled: m.includes(x.name),
      })),
    );
  }, [modeTools]);

  useEffect(() => {
    // 设置窗口是独立 webview，需要自行注册内置工具（主窗口已在 MainPetApp 里注册过）
    registerBuiltinTools();
  }, []);

  useEffect(() => {
    fetchModeTools()
      .then((r) => {
        setModeTools(r);
      })
      .catch(() => setModeTools(null));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const toggle = (name: string) => {
    const next = !disabled.includes(name);
    setToolDisabled(name, next);
    setDisabled((prev) => (next ? [...prev, name] : prev.filter((n) => n !== name)));
    showToast(
      next
        ? t('settings.tools.disabled_toast', {
            defaultValue: `已禁用工具：${name}`,
            name,
          })
        : t('settings.tools.enabled_toast', {
            defaultValue: `已启用工具：${name}`,
            name,
          }),
      'success',
    );
  };

  const grouped: Record<ToolView['source'], ToolView[]> = {
    frontend: tools.filter((x) => x.source === 'frontend'),
    backend: tools.filter((x) => x.source === 'backend'),
    mcp: tools.filter((x) => x.source === 'mcp'),
  };

  return (
    <div className="p-5 animate-[fade-in-up_0.3s_ease-out]">
      <Section
        title={t('settings.tools.title', { defaultValue: '工具管理' })}
        description={t('settings.tools.desc', {
          defaultValue: '查看、启用或禁用可供模型调用的工具；禁用后将在下次对话生效。',
        })}
      >
        <p className="px-4 pb-3 text-xs text-neutral-500 leading-relaxed">
          {t('settings.tools.hint', {
            defaultValue:
              '前端工具在桌面侧执行（截图/文件等），后端工具在 Gateway 进程内执行，MCP 工具来自外部服务器。',
          })}
        </p>

        {(['frontend', 'backend', 'mcp'] as const).map((src) => (
          <div key={src} className="px-4 pb-4">
            <p className="mb-2 text-sm font-semibold text-neutral-700">
              {SOURCE_LABEL[src]}
              <span className="ml-1.5 text-neutral-400">（{grouped[src].length}）</span>
            </p>
            <div className="space-y-2.5">
              {grouped[src].length === 0 && (
                <div className="flex items-center gap-2 rounded-lg bg-neutral-50 px-3 py-2.5 text-xs text-neutral-400">
                  <Icon
                    icon="solar:close-circle-bold-duotone"
                    className="h-4 w-4 text-neutral-300"
                  />
                  {src === 'mcp'
                    ? t('settings.tools.mcp_empty', {
                        defaultValue: '暂无 MCP 工具，可在「MCP」中连接服务器',
                      })
                    : t('settings.tools.none', { defaultValue: '暂无工具' })}
                </div>
              )}
              {grouped[src].map((tool) => (
                <div
                  key={`${src}-${tool.name}`}
                  className="flex items-center justify-between rounded-xl border border-neutral-200 bg-white px-4 py-3 shadow-sm transition-shadow hover:shadow-md"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-neutral-800">{tool.name}</span>
                      <span
                        className={`rounded-md px-2 py-0.5 text-[11px] font-medium ${
                          tool.disabled
                            ? 'bg-neutral-100 text-neutral-500'
                            : 'bg-emerald-50 text-emerald-600 border border-emerald-200'
                        }`}
                      >
                        {tool.disabled
                          ? t('settings.tools.off', { defaultValue: '已禁用' })
                          : t('settings.tools.on', { defaultValue: '启用' })}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-neutral-500">
                      {tool.description}
                    </p>
                    <div className="mt-1.5 flex gap-1.5">
                      <span
                        className={`rounded-md px-2 py-0.5 text-[11px] ${
                          tool.chat
                            ? 'bg-pink-50 text-pink-600 border border-pink-200'
                            : 'bg-neutral-50 text-neutral-400 line-through'
                        }`}
                      >
                        聊天
                      </span>
                      <span
                        className={`rounded-md px-2 py-0.5 text-[11px] ${
                          tool.work
                            ? 'bg-blue-50 text-blue-600 border border-blue-200'
                            : 'bg-neutral-50 text-neutral-400 line-through'
                        }`}
                      >
                        工作
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => toggle(tool.name)}
                    className={`ml-4 shrink-0 rounded-lg px-3.5 py-2 text-sm font-medium transition-all ${
                      tool.disabled
                        ? 'border border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50 hover:text-neutral-800'
                        : 'bg-[var(--primary-500)] text-white hover:opacity-90'
                    }`}
                  >
                    {tool.disabled
                      ? t('settings.tools.enable', { defaultValue: '启用' })
                      : t('settings.tools.disable', { defaultValue: '禁用' })}
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))}
      </Section>

      {/* 技能 / 扩展管理入口 */}
      <Section
        title={t('settings.tools.skills_title', { defaultValue: '技能与扩展' })}
        description={t('settings.tools.skills_desc', {
          defaultValue: 'MCP 与插件是可扩展的能力来源，点击前往管理。',
        })}
      >
        <SettingRow
          title={t('settings.tools.mcp_title', { defaultValue: 'MCP 服务器' })}
          description={t('settings.tools.mcp_desc', {
            defaultValue: '连接外部 MCP 服务器，自动获得其工具',
          })}
          to="/settings/extensions/mcp"
        />
        <SettingRow
          title={t('settings.tools.plugins_title', { defaultValue: '插件（技能）' })}
          description={t('settings.tools.plugins_desc', {
            defaultValue: '内置与自定义插件技能的市场与已安装列表',
          })}
          to="/settings/extensions/plugins"
        />
      </Section>
    </div>
  );
}

export default ToolsPage;
