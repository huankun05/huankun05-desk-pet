import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Section, SettingRow } from '../../components';

export function ChatVoicePage() {
  const { t } = useTranslation();
  const [ttsEnabled, setTtsEnabled] = useState(() => {
    try {
      return localStorage.getItem('deskpet_tts_enabled') !== 'false';
    } catch {
      return true;
    }
  });
  const [sttAvailable, setSttAvailable] = useState(() => {
    try {
      return localStorage.getItem('deskpet_sttAvailable') === 'true';
    } catch {
      return false;
    }
  });

  const updateTts = (value: boolean) => {
    setTtsEnabled(value);
    try {
      localStorage.setItem('deskpet_tts_enabled', value ? 'true' : 'false');
    } catch {
      /* ignore */
    }
  };

  const updateStt = (value: boolean) => {
    setSttAvailable(value);
    try {
      localStorage.setItem('deskpet_sttAvailable', value ? 'true' : 'false');
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="p-4 animate-[fade-in-up_0.3s_ease-out]">
      <Section
        title={t('settings.chat.voice_title', { defaultValue: '语音' })}
        description={t('settings.chat.voice_desc', { defaultValue: 'TTS、STT、唤醒词' })}
      >
        <div className="space-y-3 p-4">
          <SettingRow
            title={t('settings.chat.tts', { defaultValue: '语音合成' })}
            description={t('settings.chat.tts_desc', { defaultValue: '助手回复后自动朗读' })}
          >
            <button
              type="button"
              onClick={() => updateTts(!ttsEnabled)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                ttsEnabled ? 'bg-[var(--primary-500)]' : 'bg-neutral-200'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${
                  ttsEnabled ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </SettingRow>

          <SettingRow
            title={t('settings.chat.stt', { defaultValue: '语音识别' })}
            description={t('settings.chat.stt_desc', { defaultValue: '允许面板内直接语音输入' })}
          >
            <button
              type="button"
              onClick={() => updateStt(!sttAvailable)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                sttAvailable ? 'bg-[var(--primary-500)]' : 'bg-neutral-200'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${
                  sttAvailable ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </SettingRow>
        </div>
      </Section>

      <Section
        title={t('settings.chat.voice_model_title', { defaultValue: '模型与服务' })}
        description={t('settings.chat.voice_model_desc', {
          defaultValue: 'TTS/STT 提供方与模型配置',
        })}
      >
        <SettingRow
          title={t('settings.chat.voice_models', { defaultValue: '模型设置' })}
          description={t('settings.chat.voice_models_desc', {
            defaultValue: '前往模型设置页选择或测试 TTS/STT 模型',
          })}
          to="/settings/models"
        />
      </Section>
    </div>
  );
}

export default ChatVoicePage;
