import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Section, SettingRow } from '../../components';
import { useToast } from '../../components';
import { useMode, type AppMode } from '../../../hooks/useMode';
import { toolRegistry } from '../../../services/tools/registry';
import { registerBuiltinTools } from '../../../services/tools';
import { getAllServerStatuses } from '../../../services/mcp/manager';
import { fetchModeTools, type ModeToolsInfo } from '../../../services/gatewayApi';
// 确保内置工具在设置 webview 中注册
import '../../../services/tools/builtins';

/** 后端工具的中文描述（兜底，网关未返回 description 时使用） */
const BACKEND_DESC: Record<string, string> = {
  echo: '回声测试工具',
  get_current_time: '获取当前服务器时间',
};

/** 模式元数据（静态描述） */
const MODE_META: Record<AppMode, { icon: string; features: string[] }> = {
  auto: {
    icon: 'solar:magic-stick-3-bold',
    features: [
      '自动识别意图，无需手动切换',
      '闲聊时零工具、最快最省',
      '需要查资料/操作文件时自动调用对应工具',
      '中途从聊天切到工作也完全无感',
    ],
  },
  chat: {
    icon: 'fluent:chat-24-regular',
    features: [
      '轻量级对话，回复简短自然',
      '上下文窗口 20 条消息',
      '仅启用轻量工具（联网 / 时间）',
      '适合日常陪伴、快速问答',
    ],
  },
  work: {
    icon: 'fluent:code-24-regular',
    features: [
      '完整能力，回答详细有条理',
      '上下文窗口 40 条消息',
      '支持全部工具调用（文件 / 代码 / 搜索 / MCP）',
      '适合编程、分析、写作等任务',
    ],
  },
};

interface ToolView {
  name: string;
  description: string;
  source: 'frontend' | 'backend' | 'mcp';
}

export function ChatModesPage() {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const { mode, isWorkMode } = useMode();

  const [modeTools, setModeTools] = useState<ModeToolsInfo | null>(null);

  useEffect(() => {
    // 设置窗口是独立 webview，需要手动注册内置工具
    registerBuiltinTools();
    fetchModeTools()
      .then(setModeTools)
      .catch(() => setModeTools(null));
  }, []);

  const currentMeta = MODE_META[mode];

  // 组装「当前模式可用工具」清单
  const availableTools: ToolView[] = (() => {
    const frontend = toolRegistry.getAll().map<ToolView>((tt) => ({
      name: tt.name,
      description: tt.description,
      source: 'frontend',
    }));
    const backend = (modeTools?.backend ?? []).map<ToolView>((n) => ({
      name: n,
      description: BACKEND_DESC[n] ?? '后端工具',
      source: 'backend',
    }));
    const mcp = getAllServerStatuses()
      .flatMap((s) => s.tools ?? [])
      .map<ToolView>((tt) => ({
        name: tt.name,
        description: tt.description,
        source: 'mcp',
      }));

    const all = [...frontend, ...backend, ...mcp];
    // auto / work = 全部工具；chat = 仅轻量子集
    const whitelist = mode === 'chat' ? modeTools?.chat : null;
    if (!whitelist) return all;
    const set = new Set(whitelist);
    return all.filter((x) => set.has(x.name));
  })();

  const sourceLabel: Record<ToolView['source'], string> = {
    frontend: '前端',
    backend: '后端',
    mcp: 'MCP',
  };

  return (
    <div className="p-4 animate-[fade-in-up_0.3s_ease-out]">
      {/* 智能模式说明 */}
      <Section
        title={t('settings.chat.modes_title', { defaultValue: '智能模式' })}
        description={t('settings.chat.modes_desc', {
          defaultValue: '自动识别你的意图，无需手动切换聊天/工作',
        })}
      >
        <div className="space-y-3 p-4">
          <div className="rounded-xl border border-primary-200 bg-primary-50/50 p-4">
            <p className="text-sm font-semibold text-neutral-800">
              {t('settings.chat.auto_mode_badge', { defaultValue: '● 已启用智能模式' })}
            </p>
            <p className="mt-2 text-xs leading-relaxed text-neutral-600">
              {t('settings.chat.auto_mode_desc', {
                defaultValue:
                  '角色会根据你每条消息自动判断：不仅是调用什么工具，连说话方式与人设也会随意图切换——闲聊时用亲切活泼的聊天人设、保留更少历史、零工具最快回复；写代码/分析/查资料等任务时自动切到工作人设、保留更多上下文、按需调用对应工具。中途从聊天切到工作完全无感，无需手动切换。',
              })}
            </p>
          </div>
          <div className="rounded-lg border border-neutral-200 bg-white p-3 text-xs text-neutral-500">
            {t('settings.chat.auto_mode_fallback', {
              defaultValue:
                '仍可在代码中显式指定 chat / work 作为固定模式兜底；默认即为智能模式。',
            })}
          </div>
        </div>
      </Section>

      {/* 当前模式详情卡片 */}
      <Section
        title={t('settings.chat.mode_current_title', { defaultValue: '当前模式详情' })}
        description={t('settings.chat.mode_current_desc', {
          defaultValue: `当前激活：${isWorkMode ? '工作模式' : '聊天模式'}`,
        })}
      >
        <div
          className={`mx-4 mb-4 rounded-xl border p-4 transition-all duration-300 ${
            mode === 'work' ? 'border-blue-200 bg-blue-50/50' : 'border-pink-200 bg-pink-50/50'
          }`}
        >
          <div className="flex items-center gap-3">
            {/* 模式图标 + 名称 */}
            <div
              className={`flex h-10 w-10 items-center justify-center rounded-lg ${
                mode === 'work' ? 'bg-blue-100 text-blue-600' : 'bg-pink-100 text-pink-600'
              }`}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                {mode === 'work' ? (
                  <>
                    <polyline points="16 18 22 12 16 6" />
                    <polyline points="8 6 2 12 8 18" />
                  </>
                ) : (
                  <>
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </>
                )}
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold text-neutral-800">
                {mode === 'work'
                  ? t('settings.chat.mode_work', { defaultValue: '工作模式' })
                  : t('settings.chat.mode_chat', { defaultValue: '聊天模式' })}
              </p>
              <p className={`text-xs ${mode === 'work' ? 'text-blue-600' : 'text-pink-600'}`}>
                {mode === 'work'
                  ? t('settings.chat.mode_badge_work', { defaultValue: '● 完整能力已启用' })
                  : t('settings.chat.mode_badge_chat', { defaultValue: '● 轻量对话中' })}
              </p>
            </div>
          </div>

          {/* 特性列表 */}
          <ul className="mt-3 space-y-1.5">
            {currentMeta.features.map((f) => (
              <li key={f} className="flex items-start gap-2 text-xs text-neutral-600">
                <span className={`mt-0.5 ${mode === 'work' ? 'text-blue-500' : 'text-pink-500'}`}>
                  •
                </span>
                {f}
              </li>
            ))}
          </ul>

          {/* 本模式可用工具清单 */}
          <div className="mt-4 border-t border-neutral-200/70 pt-3">
            <p className="mb-2 text-xs font-medium text-neutral-700">
              {t('settings.chat.mode_tools_title', { defaultValue: '全部可用工具' })}
              <span className="ml-1 text-neutral-400">（{availableTools.length}）</span>
            </p>
            {availableTools.length === 0 ? (
              <p className="text-xs text-neutral-400">
                {t('settings.chat.mode_tools_empty', { defaultValue: '暂无可用的工具' })}
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {availableTools.map((tool) => (
                  <span
                    key={`${tool.source}-${tool.name}`}
                    title={tool.description}
                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] ${
                      mode === 'work' ? 'bg-blue-100 text-blue-700' : 'bg-pink-100 text-pink-700'
                    }`}
                  >
                    {tool.name}
                    <span className="opacity-60">·{sourceLabel[tool.source]}</span>
                  </span>
                ))}
              </div>
            )}
            <p className="mt-2 text-[11px] text-neutral-400">
              {t('settings.chat.mode_tools_hint', {
                defaultValue: '在「扩展 → 工具」中可查看全部工具并启用/禁用',
              })}
            </p>
          </div>
        </div>
      </Section>

      {/* 相关设置 */}
      <Section
        title={t('settings.chat.mode_related_title', { defaultValue: '相关设置' })}
        description={t('settings.chat.mode_related_desc_honest', {
          defaultValue: '模型与服务为全局设置，对所有模式生效。可在此快速跳转配置。',
        })}
      >
        <SettingRow
          title={t('settings.chat.mode_related_models', { defaultValue: '模型设置' })}
          description={t('settings.chat.mode_related_models_desc_honest', {
            defaultValue: '选择 LLM 模型与参数（所有模式共用）',
          })}
          to="/settings/models"
        />
        <SettingRow
          title={t('settings.chat.mode_related_services', { defaultValue: '服务设置' })}
          description={t('settings.chat.mode_related_services_desc', {
            defaultValue: '管理 LLM / TTS / STT 等提供方',
          })}
          to="/settings/services"
        />
        <SettingRow
          title={t('settings.chat.mode_related_tools', { defaultValue: '工具管理' })}
          description={t('settings.chat.mode_related_tools_desc', {
            defaultValue: '查看并管理可用的工具与技能',
          })}
          to="/settings/extensions/tools"
        />
      </Section>
    </div>
  );
}

export default ChatModesPage;
