import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Section, SettingRow } from '../../components';

export function ChatInputPage() {
  const { t } = useTranslation();
  const [slashEnabled, setSlashEnabled] = useState(() => {
    try {
      return localStorage.getItem('deskpet_slash_enabled') !== 'false';
    } catch {
      return true;
    }
  });
  const [sendOnEnter, setSendOnEnter] = useState(() => {
    try {
      return localStorage.getItem('deskpet_send_on_enter') !== 'false';
    } catch {
      return true;
    }
  });

  const updateSlash = (value: boolean) => {
    setSlashEnabled(value);
    try {
      localStorage.setItem('deskpet_slash_enabled', value ? 'true' : 'false');
    } catch {
      /* ignore */
    }
  };

  const updateSendOnEnter = (value: boolean) => {
    setSendOnEnter(value);
    try {
      localStorage.setItem('deskpet_send_on_enter', value ? 'true' : 'false');
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="p-4 animate-[fade-in-up_0.3s_ease-out]">
      <Section
        title={t('settings.chat.input_title', { defaultValue: '输入与命令' })}
        description={t('settings.chat.input_desc', {
          defaultValue: '发送快捷键、Slash 自动补全、附件行为',
        })}
      >
        <div className="space-y-3 p-4">
          <SettingRow
            title={t('settings.chat.send_on_enter', { defaultValue: '回车发送' })}
            description={t('settings.chat.send_on_enter_desc', {
              defaultValue: '输入消息后按 Enter 直接发送，Shift+Enter 换行',
            })}
          >
            <button
              type="button"
              onClick={() => updateSendOnEnter(!sendOnEnter)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                sendOnEnter ? 'bg-[var(--primary-500)]' : 'bg-neutral-200'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${
                  sendOnEnter ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </SettingRow>

          <SettingRow
            title={t('settings.chat.slash_autocomplete', { defaultValue: 'Slash 自动补全' })}
            description={t('settings.chat.slash_autocomplete_desc', {
              defaultValue: '输入 / 时显示命令自动补全列表',
            })}
          >
            <button
              type="button"
              onClick={() => updateSlash(!slashEnabled)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                slashEnabled ? 'bg-[var(--primary-500)]' : 'bg-neutral-200'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${
                  slashEnabled ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </SettingRow>
        </div>
      </Section>
    </div>
  );
}

export default ChatInputPage;
