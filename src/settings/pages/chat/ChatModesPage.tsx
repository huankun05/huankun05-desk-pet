import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Section, SettingRow } from '../../components';
import { useToast } from '../../components';

export function ChatModesPage() {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const [mode, setMode] = useState<'work' | 'chat'>(() => {
    try {
      const m = localStorage.getItem('deskpet_mode');
      return m === 'work' ? 'work' : 'chat';
    } catch {
      return 'chat';
    }
  });

  const updateMode = (next: 'work' | 'chat') => {
    if (next === mode) return;
    setMode(next);
    try {
      localStorage.setItem('deskpet_mode', next);
    } catch {
      /* ignore */
    }
    // 注意：文案随模式变化，必须用两个独立 key。
    // 若共用一个 key + 动态 defaultValue，一旦 locale 里定义了该 key，
    // defaultValue 就会失效，导致两种切换都显示同一句话。
    showToast(
      next === 'work'
        ? t('settings.chat.switch_to_work', { defaultValue: '已切换到工作模式' })
        : t('settings.chat.switch_to_chat', { defaultValue: '已切换到聊天模式' }),
      'success',
    );
  };

  return (
    <div className="p-4 animate-[fade-in-up_0.3s_ease-out]">
      <Section
        title={t('settings.chat.modes_title', { defaultValue: '模式' })}
        description={t('settings.chat.modes_desc', { defaultValue: '工作模式/聊天模式切换' })}
      >
        <div className="space-y-3 p-4">
          <SettingRow
            title={t('settings.chat.mode_chat', { defaultValue: '聊天模式' })}
            description={t('settings.chat.mode_chat_desc', {
              defaultValue: '简化对话，无工具，上下文更短',
            })}
          >
            <button
              type="button"
              onClick={() => updateMode('chat')}
              className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
                mode === 'chat'
                  ? 'bg-[var(--primary-500)] text-white'
                  : 'border border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50'
              }`}
            >
              {t('settings.chat.mode_chat', { defaultValue: '聊天模式' })}
            </button>
          </SettingRow>

          <SettingRow
            title={t('settings.chat.mode_work', { defaultValue: '工作模式' })}
            description={t('settings.chat.mode_work_desc', {
              defaultValue: '完整能力，允许工具调用，上下文更长',
            })}
          >
            <button
              type="button"
              onClick={() => updateMode('work')}
              className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
                mode === 'work'
                  ? 'bg-[var(--primary-500)] text-white'
                  : 'border border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50'
              }`}
            >
              {t('settings.chat.mode_work', { defaultValue: '工作模式' })}
            </button>
          </SettingRow>
        </div>
      </Section>

      <Section
        title={t('settings.chat.mode_related_title', { defaultValue: '相关设置' })}
        description={t('settings.chat.mode_related_desc', {
          defaultValue: '模式会影响模型与工具权限，可在此快速跳转',
        })}
      >
        <SettingRow
          title={t('settings.chat.mode_related_models', { defaultValue: '模型设置' })}
          description={t('settings.chat.mode_related_models_desc', {
            defaultValue: '选择当前模式使用的模型',
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
