/**
 * SubtitleNotch — 屏幕顶部中央「刘海位」字幕 + 声波层
 *
 * 覆盖所有说话场景：
 *   - 唤醒（listening：正在聆听…）
 *   - 语音助手/通话 用户识别（recognized：用户说的原文）
 *   - 角色回复（speaking：流式 TTS 文本，来自 hermes:token 累积）
 *
 * 数据来源：eventBus 'subtitle:update'（useVoiceAssistant / useVoiceCall / hermesGateway 统一 emit）
 * 空闲 8s 无新事件自动淡出；收到 idle 立即隐藏。
 */

import { useEffect, useRef, useState } from 'react';
import { eventBus } from '../../services/eventBus';

type SubtitlePhase = 'listening' | 'recognized' | 'speaking' | 'idle';

interface SubtitleState {
  phase: SubtitlePhase;
  text: string;
}

/** 自动隐藏延时（ms） */
const AUTO_HIDE_MS = 8000;

export function SubtitleNotch() {
  const [state, setState] = useState<SubtitleState>({ phase: 'idle', text: '' });
  const [visible, setVisible] = useState(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const scheduleHide = () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      hideTimerRef.current = setTimeout(() => {
        setVisible(false);
        setState({ phase: 'idle', text: '' });
      }, AUTO_HIDE_MS);
    };

    const off = eventBus.on('subtitle:update', (payload) => {
      const { phase, text } = payload;
      if (phase === 'idle') {
        setVisible(false);
        setState({ phase: 'idle', text: '' });
        if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
        return;
      }
      setState({ phase, text });
      setVisible(true);
      scheduleHide();
    });

    return () => {
      off();
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, []);

  if (!visible) return null;

  const isListening = state.phase === 'listening';
  const showWave = state.phase === 'listening' || state.phase === 'speaking';
  const label =
    state.phase === 'listening'
      ? '🎙️'
      : state.phase === 'recognized'
        ? '🗣️'
        : '💬';

  return (
    <div
      className="fixed left-1/2 top-2 z-[9998] -translate-x-1/2 select-none"
      style={{ pointerEvents: 'none' }}
    >
      <div
        className="flex max-w-[80vw] items-center gap-2.5 rounded-full border border-white/15 px-4 py-1.5 shadow-lg backdrop-blur-md"
        style={{
          background: 'rgba(20,20,28,0.72)',
          transition: 'opacity 240ms ease, transform 240ms ease',
          opacity: visible ? 1 : 0,
        }}
      >
        {/* 声波律动 */}
        {showWave && (
          <span className="flex h-4 items-end gap-[3px]" aria-hidden>
            {[0, 1, 2, 3, 4].map((i) => (
              <span
                key={i}
                className="w-[3px] rounded-full bg-[var(--primary-400)]"
                style={{
                  height: isListening ? '6px' : '10px',
                  animation: `subtitleWave 0.9s ease-in-out ${i * 0.12}s infinite`,
                }}
              />
            ))}
          </span>
        )}

        <span className="text-sm leading-none">{label}</span>

        <span
          className="max-w-[60vw] truncate text-sm text-white/90"
          style={{ fontWeight: 500 }}
        >
          {state.text || (isListening ? '正在聆听…' : '')}
        </span>
      </div>

      <style>{`
        @keyframes subtitleWave {
          0%, 100% { transform: scaleY(0.4); opacity: 0.5; }
          50% { transform: scaleY(1); opacity: 1; }
        }
      `}</style>
    </div>
  );
}

export default SubtitleNotch;
