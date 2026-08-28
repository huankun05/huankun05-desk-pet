import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Section, SettingRow } from '../../components';
import { providerManager } from '../../../services/provider/manager';
import { audioPlayer } from '../../../services/audio/player';
import type { TTSProvider } from '../../../services/provider/types';

/** EdgeTTS 预置中文音色（fallback，优先从引擎动态获取） */
const FALLBACK_VOICES = [
  { id: 'zh-CN-XiaoyiNeural', label: '晓伊（温柔女声）' },
  { id: 'zh-CN-XiaoxiaoNeural', label: '晓晓（活泼女声）' },
  { id: 'zh-CN-XiaochenNeural', label: '晓辰（沉稳男声）' },
  { id: 'zh-CN-XiaohanNeural', label: '晓涵（知性女声）' },
  { id: 'zh-CN-XiaomengNeural', label: '晓梦（甜美女声）' },
  { id: 'zh-CN-XiaomoNeural', label: '晓墨（低沉男声）' },
  { id: 'zh-CN-XiaoqiuNeural', label: '晓秋（清新女声）' },
  { id: 'zh-CN-XiaoruiNeural', label: '晓睿（亲和男声）' },
];

/** rate 百分比 → EdgeTTS 字符串 */
function formatRate(pct: number): string {
  if (pct >= 0) return `+${pct}%`;
  return `${pct}%`;
}

/** EdgeTTS 字符串 → rate 百分比 */
function parseRate(s: string | undefined): number {
  if (!s) return 0;
  const m = s.match(/^([+-]?\d+)%$/);
  return m ? parseInt(m[1], 10) : 0;
}

export function ChatVoicePage() {
  const { t } = useTranslation();

  // ---- TTS 开关 ----
  const [ttsEnabled, setTtsEnabled] = useState(() => {
    try {
      return localStorage.getItem('deskpet_tts_enabled') !== 'false';
    } catch {
      return true;
    }
  });

  // ---- STT 开关 ----
  const [sttAvailable, setSttAvailable] = useState(() => {
    try {
      return localStorage.getItem('deskpet_sttAvailable') === 'true';
    } catch {
      return false;
    }
  });

  // ---- 语音自动聆听（VAD）开关：默认关闭，避免常驻开麦 ----
  const [voiceAutoListen, setVoiceAutoListen] = useState(() => {
    try {
      return localStorage.getItem('deskpet_voice_autolisten') === 'true';
    } catch {
      return false;
    }
  });

  // ---- 手动按键结束开关：默认开启，避免停顿被静音端点误截断 ----
  const [voiceManualStop, setVoiceManualStop] = useState(() => {
    try {
      return localStorage.getItem('deskpet_voice_manual_stop') !== 'false';
    } catch {
      return true;
    }
  });

  // ---- 通话总结开关 ----
  const [callSummaryEnabled, setCallSummaryEnabled] = useState(() => {
    try {
      return localStorage.getItem('deskpet_call_summary_enabled') !== 'false';
    } catch {
      return true;
    }
  });

  // ---- TTS 引擎状态 ----
  const [ttsProvider, setTtsProvider] = useState<TTSProvider | null>(null);
  const [voices, setVoices] = useState(FALLBACK_VOICES);
  const [selectedVoice, setSelectedVoice] = useState<string>('');
  const [ratePct, setRatePct] = useState(0); // -50 ~ +50
  const [volumePct, setVolumePct] = useState(0); // 0 ~ +100

  // ---- STT 引擎状态 ----
  const [sttEngineName, setSttEngineName] = useState<string>('');

  // ---- 播放音量 ----
  const [playbackVol, setPlaybackVol] = useState(80);

  // 初始化：读取 TTS 引擎配置与音色列表
  useEffect(() => {
    void (async () => {
      const tts = providerManager.getActiveTTSProvider();
      setTtsProvider(tts ?? null);

      if (tts) {
        setSttEngineName(tts.getName());
        // 读当前 voice / rate / volume
        const cfg = tts.config as unknown as Record<string, unknown>;
        setSelectedVoice((cfg.voice as string) || '');
        setRatePct(parseRate(cfg.rate as string | undefined));
        setVolumePct(parseRate(cfg.volume as string | undefined));

        // 动态获取音色列表
        tts.getVoices().then((list) => {
          if (list.length > 0) {
            const mapped = list.map((v) => ({
              id: v,
              label: v.replace(/^(zh-[A-Z]+-)(\w+)(Neural)$/, '$1$2$3'),
            }));
            // 补中文友好名
            const friendly = mapped.map((v) => ({
              ...v,
              label:
                FALLBACK_VOICES.find((f) => f.id === v.id)?.label ?? v.id.split('-').pop() ?? v.id,
            }));
            setVoices(friendly);
          }
        });
      }

      // STT 引擎名称
      const stt = providerManager.getActiveSTTProvider();
      if (stt) {
        setSttEngineName(stt.getName());
      }

      // 播放音量
      setPlaybackVol(Math.round(audioPlayer.getVolume() * 100));
    })();
  }, []);

  const updateTts = useCallback((value: boolean) => {
    setTtsEnabled(value);
    try {
      localStorage.setItem('deskpet_tts_enabled', value ? 'true' : 'false');
    } catch {
      /* ignore */
    }
  }, []);

  const updateStt = useCallback((value: boolean) => {
    setSttAvailable(value);
    try {
      localStorage.setItem('deskpet_sttAvailable', value ? 'true' : 'false');
    } catch {
      /* ignore */
    }
  }, []);

  const updateAutoListen = useCallback((value: boolean) => {
    setVoiceAutoListen(value);
    try {
      localStorage.setItem('deskpet_voice_autolisten', value ? 'true' : 'false');
    } catch {
      /* ignore */
    }
  }, []);

  const updateManualStop = useCallback((value: boolean) => {
    setVoiceManualStop(value);
    try {
      localStorage.setItem('deskpet_voice_manual_stop', value ? 'true' : 'false');
    } catch {
      /* ignore */
    }
  }, []);

  const updateCallSummary = useCallback((value: boolean) => {
    setCallSummaryEnabled(value);
    try {
      localStorage.setItem('deskpet_call_summary_enabled', value ? 'true' : 'false');
    } catch {
      /* ignore */
    }
  }, []);

  // ---- TTS 参数写入 ProviderManager ----
  const handleVoiceChange = (voiceId: string) => {
    setSelectedVoice(voiceId);
    if (!ttsProvider) return;
    providerManager.updateProvider(ttsProvider.config.id, { voice: voiceId });
  };

  const handleRateChange = (pct: number) => {
    setRatePct(pct);
    if (!ttsProvider) return;
    providerManager.updateProvider(ttsProvider.config.id, { rate: formatRate(pct) } as Record<
      string,
      unknown
    >);
  };

  const handleVolumeChange = (pct: number) => {
    setVolumePct(pct);
    if (!ttsProvider) return;
    providerManager.updateProvider(ttsProvider.config.id, { volume: formatRate(pct) } as Record<
      string,
      unknown
    >);
  };

  // ---- 播放音量写入 AudioPlayer ----
  const handlePlaybackVolumeChange = (pct: number) => {
    setPlaybackVol(pct);
    audioPlayer.setVolume(pct / 100);
  };

  return (
    <div className="p-4 animate-[fade-in-up_0.3s_ease-out]">
      {/* ====== TTS 合成 ====== */}
      <Section
        title={t('settings.chat.tts_section', { defaultValue: '语音合成（TTS）' })}
        description={t('settings.chat.tts_section_desc', {
          defaultValue: '助手回复后自动朗读',
        })}
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

          {/* 通话总结 */}
          <SettingRow
            title={t('settings.chat.call_summary', { defaultValue: '通话总结' })}
            description={t('settings.chat.call_summary_desc', {
              defaultValue: '语音通话挂断后生成口语化复盘，可在「聊天 → 通话记录」查看与管理',
            })}
          >
            <button
              type="button"
              onClick={() => updateCallSummary(!callSummaryEnabled)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                callSummaryEnabled ? 'bg-[var(--primary-500)]' : 'bg-neutral-200'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${
                  callSummaryEnabled ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </SettingRow>

          {/* 音色选择 */}
          <SettingRow
            title={t('settings.chat.tts_voice', { defaultValue: '音色选择' })}
            description={
              voices.find((v) => v.id === selectedVoice)?.label ??
              t('settings.chat.tts_voice_desc', { defaultValue: '选择朗读声音' })
            }
          >
            <select
              value={selectedVoice}
              onChange={(e) => handleVoiceChange(e.target.value)}
              disabled={!ttsEnabled}
              className="max-w-[180px] rounded-lg border border-neutral-200 bg-white px-2 py-1.5 text-sm text-neutral-700 outline-none transition-colors focus:border-[var(--primary-500)] disabled:opacity-40"
            >
              <option value="" disabled>
                {t('settings.chat.tts_voice_placeholder', { defaultValue: '请选择音色' })}
              </option>
              {voices.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </select>
          </SettingRow>

          {/* 语速 */}
          <SettingRow
            title={t('settings.chat.tts_rate', { defaultValue: '语速' })}
            description={`${ratePct > 0 ? '+' : ''}${ratePct}%`}
          >
            <input
              type="range"
              min={-50}
              max={50}
              value={ratePct}
              onChange={(e) => handleRateChange(Number(e.target.value))}
              disabled={!ttsEnabled}
              className="w-32 accent-[var(--primary-500)] disabled:opacity-40"
            />
          </SettingRow>

          {/* 音量 */}
          <SettingRow
            title={t('settings.chat.tts_volume', { defaultValue: '合成音量' })}
            description={`${volumePct > 0 ? '+' : ''}${volumePct}%`}
          >
            <input
              type="range"
              min={0}
              max={100}
              value={volumePct}
              onChange={(e) => handleVolumeChange(Number(e.target.value))}
              disabled={!ttsEnabled}
              className="w-32 accent-[var(--primary-500)] disabled:opacity-40"
            />
          </SettingRow>
        </div>
      </Section>

      {/* ====== STT 识别 ====== */}
      <Section
        title={t('settings.chat.stt_section', { defaultValue: '语音识别（STT）' })}
        description={t('settings.chat.stt_section_desc', {
          defaultValue: '麦克风输入转文字',
        })}
      >
        <div className="space-y-3 p-4">
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

          {/* 语音自动聆听（VAD）：说话即自动对话；默认关闭，避免后台常驻开麦 */}
          <SettingRow
            title={t('settings.chat.autolisten', { defaultValue: '语音自动聆听' })}
            description={t('settings.chat.autolisten_desc', {
              defaultValue:
                '开启后持续监听麦克风，检测到你说话即自动对话；关闭则麦克风仅在你按 Ctrl+Space 或唤醒词时启用',
            })}
          >
            <button
              type="button"
              onClick={() => updateAutoListen(!voiceAutoListen)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                voiceAutoListen ? 'bg-[var(--primary-500)]' : 'bg-neutral-200'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${
                  voiceAutoListen ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </SettingRow>

          {/* 手动按键结束：按 Ctrl+Space 开始，再次按下结束并识别；关闭则静音停顿自动结束 */}
          <SettingRow
            title={t('settings.chat.manual_stop', { defaultValue: '手动按键结束' })}
            description={t('settings.chat.manual_stop_desc', {
              defaultValue:
                '开启后按 Ctrl+Space 开始说话，再次按下才结束并识别（不怕停顿打断）；关闭则说完停顿约 0.8 秒自动结束',
            })}
          >
            <button
              type="button"
              onClick={() => updateManualStop(!voiceManualStop)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                voiceManualStop ? 'bg-[var(--primary-500)]' : 'bg-neutral-200'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${
                  voiceManualStop ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </SettingRow>

          {/* 当前引擎状态 */}
          <SettingRow
            title={t('settings.chat.stt_engine', { defaultValue: 'STT 引擎' })}
            description={
              sttEngineName
                ? `${sttEngineName} · ${t('settings.chat.engine_connected', { defaultValue: '已连接' })}`
                : t('settings.chat.engine_not_configured', { defaultValue: '未配置 STT 引擎' })
            }
          >
            {!sttEngineName && <span className="text-xs text-neutral-400">—</span>}
          </SettingRow>
        </div>
      </Section>

      {/* ====== 播放设置 ====== */}
      <Section
        title={t('settings.chat.playback_title', { defaultValue: '播放设置' })}
        description={t('settings.chat.playback_desc', {
          defaultValue: '全局音频播放参数',
        })}
      >
        <div className="space-y-3 p-4">
          <SettingRow
            title={t('settings.chat.playback_volume', { defaultValue: '播放音量' })}
            description={`${playbackVol}%`}
          >
            <input
              type="range"
              min={0}
              max={100}
              value={playbackVol}
              onChange={(e) => handlePlaybackVolumeChange(Number(e.target.value))}
              className="w-32 accent-[var(--primary-500)]"
            />
          </SettingRow>
        </div>
      </Section>

      {/* ====== 引擎管理入口 ====== */}
      <Section
        title={t('settings.chat.voice_engine_title', { defaultValue: '引擎配置' })}
        description={t('settings.chat.voice_engine_desc', {
          defaultValue: 'TTS / STT 服务地址、API Key、高级参数',
        })}
      >
        <div className="space-y-3 p-4">
          <SettingRow
            title={t('settings.chat.tts_engine_config', { defaultValue: 'TTS 引擎配置' })}
            description={t('settings.chat.tts_engine_config_desc', {
              defaultValue: '服务地址、API 密钥、模型选择等',
            })}
            to="/settings/services/tts"
          />

          <SettingRow
            title={t('settings.chat.stt_engine_config', { defaultValue: 'STT 引擎配置' })}
            description={t('settings.chat.stt_engine_config_desc', {
              defaultValue: '服务地址、语言、模型选择等',
            })}
            to="/settings/services/stt"
          />

          <SettingRow
            title={t('settings.chat.wake_word_config', { defaultValue: '语音唤醒' })}
            description={t('settings.chat.wake_word_config_desc', {
              defaultValue: '唤醒词检测与模型管理（像「小爱同学」一样叫名字唤醒）',
            })}
            to="/settings/extensions/wake-word"
          />
        </div>
      </Section>
    </div>
  );
}

export default ChatVoicePage;
