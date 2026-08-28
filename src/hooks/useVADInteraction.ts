/**
 * useVADInteraction — VAD 智能交互 Hook
 *
 * 双模式 VAD：
 * - **中断模式**：TTS 播放中检测到语音 → 立即中断 AI 说话
 * - **自动 STT 模式**：空闲时检测到语音 → 自动录音 → STT → 发送
 *
 * 状态机：
 *   idle → (speech_start) → waiting_speech → (1.5s 持续 / speech_end) → recording → (speech_end) → idle
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { FrontendVADService } from '../services/audio/vad-service';

type AutoSTTPhase = 'idle' | 'waiting_speech' | 'recording';

export interface UseVADInteractionOptions {
  /** 是否正在播放 TTS */
  isPlaying: boolean;
  /** 是否正在流式输出 */
  isStreaming: boolean;
  /** 语音中断回调 */
  onInterrupt: () => void;
  /** 自动 STT 回调（'start' | 'ended' | 'stop'） */
  onAutoSTT?: (phase: string) => void;
  /** VAD 能量阈值 */
  speechThreshold?: number;
  /** 静音超时 */
  silenceTimeout?: number;
  /**
   * 是否启用 VAD 自动交互（含自动 STT 与语音中断）。
   * 关闭时绝不打开麦克风——语音仅在用户显式按 Ctrl+Space / 唤醒词时启用。
   * 默认 false（隐私优先：麦克风不常驻）。
   */
  enabled?: boolean;
}

export interface UseVADInteractionReturn {
  /** 是否正在检测到语音 */
  isSpeaking: boolean;
  /** VAD 服务是否可用 */
  isAvailable: boolean;
  /** 手动启动 */
  start: () => Promise<boolean>;
  /** 手动停止 */
  stop: () => void;
}

export function useVADInteraction(options: UseVADInteractionOptions): UseVADInteractionReturn {
  const {
    isPlaying,
    isStreaming,
    onInterrupt,
    onAutoSTT,
    speechThreshold = 0.015,
    silenceTimeout = 600,
    enabled = false,
  } = options;

  const serviceRef = useRef<FrontendVADService | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isAvailable, setIsAvailable] = useState(() => FrontendVADService.isSupported());

  const autoSTTPhase = useRef<AutoSTTPhase>('idle');
  const speechEndTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callbacksRef = useRef({
    onInterrupt,
    onAutoSTT,
    isPlaying,
    isStreaming,
  });

  useEffect(() => {
    callbacksRef.current = { onInterrupt, onAutoSTT, isPlaying, isStreaming };
  }, [onInterrupt, onAutoSTT, isPlaying, isStreaming]);

  // 语音开始处理
  const handleSpeechStart = useCallback(() => {
    const {
      onInterrupt: cbInterrupt,
      onAutoSTT: cbAutoSTT,
      isPlaying: cbPlaying,
      isStreaming: cbStreaming,
    } = callbacksRef.current;

    if (speechEndTimer.current) {
      clearTimeout(speechEndTimer.current);
      speechEndTimer.current = null;
    }

    if (cbPlaying || cbStreaming) {
      cbInterrupt();
      return;
    }

    if (cbAutoSTT) {
      autoSTTPhase.current = 'waiting_speech';

      speechEndTimer.current = setTimeout(() => {
        if (autoSTTPhase.current === 'waiting_speech' && callbacksRef.current.onAutoSTT) {
          autoSTTPhase.current = 'recording';
          callbacksRef.current.onAutoSTT('start');
        }
      }, 1500);
    }
  }, []);

  // 语音结束处理
  const handleSpeechEnd = useCallback(() => {
    const {
      onAutoSTT: cbAutoSTT,
      isPlaying: cbPlaying,
      isStreaming: cbStreaming,
    } = callbacksRef.current;

    if (speechEndTimer.current) {
      clearTimeout(speechEndTimer.current);
      speechEndTimer.current = null;
    }

    if (cbPlaying || cbStreaming) {
      return;
    }

    if (cbAutoSTT) {
      if (autoSTTPhase.current === 'waiting_speech') {
        autoSTTPhase.current = 'idle';
        cbAutoSTT('ended');
      } else if (autoSTTPhase.current === 'recording') {
        autoSTTPhase.current = 'idle';
        cbAutoSTT('stop');
      }
    }
  }, []);

  // 初始化 VAD 服务（仅一次）
  useEffect(() => {
    const service = new FrontendVADService({ speechThreshold, silenceTimeout });
    serviceRef.current = service;

    const supported = FrontendVADService.isSupported();
    if (supported) {
      service.setCallbacks({
        onSpeechStart: () => {
          setIsSpeaking(true);
          handleSpeechStart();
        },
        onSpeechEnd: () => {
          setIsSpeaking(false);
          handleSpeechEnd();
        },
      });
    }

    return () => {
      service.dispose();
      serviceRef.current = null;
    };
  }, [speechThreshold, silenceTimeout, handleSpeechStart, handleSpeechEnd]);

  // 模式切换：控制 VAD 启停
  useEffect(() => {
    const service = serviceRef.current;
    if (!service || !isAvailable) return;

    // 未启用：绝不打开麦克风（隐私优先），并清理残留监听状态
    if (!enabled) {
      service.stop();
      autoSTTPhase.current = 'idle';
      setIsSpeaking(false);
      if (speechEndTimer.current) {
        clearTimeout(speechEndTimer.current);
        speechEndTimer.current = null;
      }
      return;
    }

    void service.start().then((ok) => {
      if (!ok) setIsAvailable(false);
    });

    return () => {
      service.stop();
      autoSTTPhase.current = 'idle';
      if (speechEndTimer.current) {
        clearTimeout(speechEndTimer.current);
        speechEndTimer.current = null;
      }
    };
  }, [isPlaying, isStreaming, isAvailable, enabled]);

  const start = useCallback(async (): Promise<boolean> => {
    const service = serviceRef.current;
    if (!service) return false;
    return service.start();
  }, []);

  const stop = useCallback((): void => {
    const service = serviceRef.current;
    if (!service) return;
    service.stop();
    autoSTTPhase.current = 'idle';
    if (speechEndTimer.current) {
      clearTimeout(speechEndTimer.current);
      speechEndTimer.current = null;
    }
  }, []);

  return { isSpeaking, isAvailable, start, stop };
}
