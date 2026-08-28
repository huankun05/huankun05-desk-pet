/**
 * StatusIndicators — 主宠窗口右上/左上角的常驻状态角标
 *
 * 1) 语音：唤醒词常驻监听(listening) 或 语音助手单轮活跃(listening/recognizing/processing)
 *    期间在右上角显示麦克风角标 + 状态条，退出即灭。
 * 2) 屏幕：「一起看」开启期间在左上角显示「正在查看屏幕」角标，带实时脉冲点，
 *    让用户一眼知道桌宠正在周期性截屏。
 *
 * 两个角标均为纯展示、pointer-events:none，不拦截鼠标。
 */

import { useTranslation } from 'react-i18next';
import { Icon } from '@iconify/react';
import type { WakeWordState } from '../../hooks/useWakeWord';
import type { VoiceAssistantState } from '../../hooks/useVoiceAssistant';

export interface StatusIndicatorsProps {
  /** 唤醒词状态（'listening' = 麦克风常驻监听中） */
  wakeState: WakeWordState;
  /** 语音助手状态（'idle' 之外即单轮活跃） */
  voiceState: VoiceAssistantState;
  /** 是否处于「一起看」截屏模式 */
  isWatching: boolean;
}

type VoiceKind =
  'idle' | 'listening-wake' | 'listening' | 'recognizing' | 'processing' | 'loading' | 'error';

function resolveVoice(
  wakeState: WakeWordState,
  voiceState: VoiceAssistantState,
  t: (k: string) => string,
): { kind: VoiceKind; label: string } {
  // 单轮语音助手优先（用户正在说话/被处理）
  if (voiceState !== 'idle') {
    switch (voiceState) {
      case 'listening':
        return { kind: 'listening', label: t('status.voice.listening') };
      case 'recognizing':
        return { kind: 'recognizing', label: t('status.voice.recognizing') };
      case 'processing':
        return { kind: 'processing', label: t('status.voice.processing') };
    }
  }
  // 否则看唤醒词常驻监听状态
  switch (wakeState) {
    case 'loading-model':
      return { kind: 'loading', label: t('status.voice.loading_model') };
    case 'listening':
      return { kind: 'listening-wake', label: t('status.voice.listening_wake') };
    case 'error':
      return { kind: 'error', label: t('status.voice.error') };
    default:
      return { kind: 'idle', label: '' };
  }
}

export function StatusIndicators({ wakeState, voiceState, isWatching }: StatusIndicatorsProps) {
  const { t } = useTranslation();
  const voice = resolveVoice(wakeState, voiceState, t);
  const voiceActive = voice.kind !== 'idle';

  return (
    <>
      {voiceActive && (
        <div
          className={`status-indicator status-indicator--voice status--${voice.kind}`}
          role="status"
          aria-live="polite"
        >
          <span className="status-indicator__icon">
            <Icon icon="solar:microphone-bold" />
            <span className="status-indicator__pulse" />
          </span>
          <span className="status-indicator__label">{voice.label}</span>
        </div>
      )}

      {isWatching && (
        <div className="status-indicator status-indicator--screen" role="status" aria-live="polite">
          <span className="status-indicator__icon">
            <Icon icon="solar:eye-bold" />
            <span className="status-indicator__pulse status-indicator__pulse--live" />
          </span>
          <span className="status-indicator__label">
            {t('status.screen.watching')}
            <span className="status-indicator__live">{t('status.screen.live')}</span>
          </span>
        </div>
      )}
    </>
  );
}

export default StatusIndicators;
