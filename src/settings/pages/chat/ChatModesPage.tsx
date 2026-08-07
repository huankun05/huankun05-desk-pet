import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Section, SettingRow } from '../../components';
import { useToast } from '../../components';
import { useMode, MODE_CHANGED_EVENT, type AppMode } from '../../../hooks/useMode';

/** 模式元数据（静态描述） */
const MODE_META: Record<AppMode, { icon: string; features: string[] }> = {
  chat: {
    icon: 'fluent:chat-24-regular',
    features: [
      '轻量级对话，回复简短自然',
      '上下文窗口 20 条消息',
      '无工具调用，专注闲聊',
      '适合日常陪伴、快速问答',
    ],
  },
  work: {
    icon: 'fluent:code-24-regular',
    features: [
      '完整能力，回答详细有条理',
      '上下文窗口 40 条消息',
      '支持工具调用（文件/代码/搜索）',
      '适合编程、分析、写作等任务',
    ],
  },
};

export function ChatModesPage() {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const { mode, setMode, isWorkMode } = useMode();

  // 用于平滑过渡动画
  const [prevMode, setPrevMode] = useState(mode);
  const [animating, setAnimating] = useState(false);

  const handleSwitch = (next: AppMode) => {
    if (next === mode) return;
    setAnimating(true);
    setPrevMode(mode);
    setMode(next);
    setTimeout(() => setAnimating(false), 300);
    showToast(
      next === 'work'
        ? t('settings.chat.switch_to_work', { defaultValue: '已切换到工作模式' })
        : t('settings.chat.switch_to_chat', { defaultValue: '已切换到聊天模式' }),
      'success',
    );
  };

  const currentMeta = MODE_META[mode];

  return (
    <div className="p-4 animate-[fade-in-up_0.3s_ease-out]">
      {/* 模式选择区 */}
      <Section
        title={t('settings.chat.modes_title', { defaultValue: '模式' })}
        description={t('settings.chat.modes_desc', { defaultValue: '工作模式/聊天模式切换' })}
      >
        <div className="space-y-3 p-4">
          {/* 聊天模式 */}
          <SettingRow
            title={t('settings.chat.mode_chat', { defaultValue: '聊天模式' })}
            description={t('settings.chat.mode_chat_desc', {
              defaultValue: '简化对话，无工具，上下文更短',
            })}
          >
            <button
              type="button"
              onClick={() => handleSwitch('chat')}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-all ${
                mode === 'chat'
                  ? 'bg-[var(--primary-500)] text-white shadow-sm'
                  : 'border border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50'
              }`}
            >
              {t('settings.chat.mode_chat', { defaultValue: '聊天模式' })}
            </button>
          </SettingRow>

          {/* 工作模式 */}
          <SettingRow
            title={t('settings.chat.mode_work', { defaultValue: '工作模式' })}
            description={t('settings.chat.mode_work_desc', {
              defaultValue: '完整能力，允许工具调用，上下文更长',
            })}
          >
            <button
              type="button"
              onClick={() => handleSwitch('work')}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-all ${
                mode === 'work'
                  ? 'bg-[var(--primary-500)] text-white shadow-sm'
                  : 'border border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50'
              }`}
            >
              {t('settings.chat.mode_work', { defaultValue: '工作模式' })}
            </button>
          </SettingRow>
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
            animating ? 'opacity-0 scale-95' : 'opacity-100 scale-100'
          } ${mode === 'work' ? 'border-blue-200 bg-blue-50/50' : 'border-pink-200 bg-pink-50/50'}`}
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
      </Section>
    </div>
  );
}

export default ChatModesPage;
