/**
 * useVoiceCall — 聊天窗口「语音通话」状态机（像 QQ 语音通话）
 *
 * 流程：
 *   点击通话按钮 → 发 voice:start 让网关按需拉起本地 STT/TTS 服务（不用时常驻）
 *   → 进入通话态：持续「听(静音自动停) → STT 识别 → 发聊天LLM(气泡显示) → 宠物TTS回话」
 *   → 挂断 → 发 voice:stop 释放本地服务
 *
 * 复用：AudioRecorder（前端录音 + 静音自动停）、providerManager（STT/TTS）、
 *      useHermesGateway.sendMessage（聊天 + 气泡渲染）。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AudioRecorder } from '../services/audio/recorder';
import { providerManager } from '../services/provider/manager';
import { synthesizeViaBrain } from '../services/provider/ttsBackend';
import { getHermesGatewayClient } from '../services/hermesGateway';
import { eventBus } from '../services/eventBus';
import { createLogger } from '../utils/logger';

const log = createLogger('VoiceCall');

export type VoiceCallState = 'idle' | 'connecting' | 'incall' | 'listening' | 'speaking' | 'error';

export interface UseVoiceCallOptions {
  /** 发送消息到聊天（含 LLM + 工具 + 气泡渲染） */
  sendMessage: (text: string) => Promise<void>;
  /** 通话状态变化回调（用于 UI） */
  onStateChange?: (s: VoiceCallState) => void;
  /** 错误提示 */
  showError?: (msg: string) => void;
}

export interface UseVoiceCallReturn {
  state: VoiceCallState;
  /** 通话秒数 */
  seconds: number;
  /** 是否通话中（incall/listening/speaking） */
  active: boolean;
  /** 切换通话（开/关） */
  toggle: () => void;
}

export function useVoiceCall({
  sendMessage,
  onStateChange,
  showError,
}: UseVoiceCallOptions): UseVoiceCallReturn {
  const [state, setState] = useState<VoiceCallState>('idle');
  const [seconds, setSeconds] = useState(0);

  const activeRef = useRef(false);
  const stateRef = useRef<VoiceCallState>('idle');
  const recorderRef = useRef<AudioRecorder | null>(null);
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const voiceStartResolveRef = useRef<((ok: boolean) => void) | null>(null);

  const setCallState = useCallback(
    (s: VoiceCallState) => {
      stateRef.current = s;
      setState(s);
      onStateChange?.(s);
    },
    [onStateChange],
  );

  const stopTts = useCallback(() => {
    const a = ttsAudioRef.current;
    if (a) {
      try {
        a.pause();
        a.src = '';
      } catch {
        /* ignore */
      }
      ttsAudioRef.current = null;
    }
  }, []);

  /** 合成并播放宠物语音，返回播放结束的 Promise */
  const playTts = useCallback((text: string): Promise<void> => {
    return new Promise((resolve) => {
      synthesizeViaBrain(text)
        .then((res) => {
          if (!res) {
            log.warn('voice call: TTS 后端不可用，跳过回话');
            resolve();
            return;
          }
          const blob = new Blob([res.audio], { type: 'audio/wav' });
          const url = URL.createObjectURL(blob);
          const audio = new Audio(url);
          ttsAudioRef.current = audio;
          audio.onended = () => {
            URL.revokeObjectURL(url);
            ttsAudioRef.current = null;
            resolve();
          };
          audio.onerror = () => {
            URL.revokeObjectURL(url);
            ttsAudioRef.current = null;
            resolve();
          };
          return audio.play();
        })
        .catch((e) => {
          log.error('tts synthesize/play failed', e);
          resolve();
        });
    });
  }, []);

  // 停止通话的内部实现（声明在 startTurn 之前，供其 catch 调用，避免 TDZ）
  const stopCallInternal = useCallback(() => {
    if (!activeRef.current && stateRef.current === 'idle') return;
    activeRef.current = false;
    try {
      recorderRef.current?.cancel();
    } catch {
      /* ignore */
    }
    recorderRef.current = null;
    stopTts();
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setSeconds(0);
    getHermesGatewayClient().sendVoice('stop');
    setCallState('idle');
  }, [stopTts, setCallState]);

  /** 开始一轮聆听 */
  const startTurn = useCallback(async () => {
    if (!activeRef.current) return;
    const stt = providerManager.getActiveSTTProvider();
    if (!stt) {
      setCallState('error');
      showError?.('请先在设置中配置语音识别 (STT) 服务~');
      return;
    }
    setCallState('listening');

    const rec = new AudioRecorder({ sampleRate: 16000, silenceTimeout: 1500 });
    recorderRef.current = rec;
    rec.onAutoStop = async (audio: ArrayBuffer) => {
      if (!activeRef.current) return;
      try {
        const result = await stt.transcribe(audio, 'wav');
        const text = (result as { text?: string }).text?.trim();
        if (text) {
          setCallState('speaking');
          // 发到聊天（渲染用户+助手气泡）；TTS 由 hermes:done 事件触发
          await sendMessage(text);
        }
      } catch (e) {
        log.error('stt transcribe failed', e);
      }
      // 下一轮聆听由 TTS 播放结束（或异常）后触发，避免抢话
    };
    try {
      await rec.start();
    } catch (e) {
      log.error('recorder start failed', e);
      const errMsg = e instanceof Error ? e.message : String(e);
      if (errMsg.includes('Permission') || errMsg.includes('denied')) {
        showError?.('麦克风权限被拒绝，请在系统设置中允许~');
      } else {
        showError?.('麦克风启动失败~');
      }
      stopCallInternal();
    }
  }, [sendMessage, setCallState, showError, stopCallInternal]);

  const startCall = useCallback(async () => {
    if (activeRef.current) return;
    activeRef.current = true;
    setSeconds(0);
    setCallState('connecting');

    // 计时
    timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);

    // 让网关按需拉起本地 STT/TTS 服务（按前端活跃 TTS 引擎选择，避免多起闲置 Edge :8001）
    const activeTts = providerManager.getActiveTTSConfig();
    const ready = await new Promise<boolean>((resolve) => {
      voiceStartResolveRef.current = resolve;
      getHermesGatewayClient().sendVoice('start', { typeName: activeTts?.typeName });
      // 兜底：10s 内未收到响应则按"已尝试"继续
      setTimeout(() => {
        if (voiceStartResolveRef.current) {
          voiceStartResolveRef.current(true);
          voiceStartResolveRef.current = null;
        }
      }, 10000);
    });

    if (!ready) {
      stopCallInternal();
      showError?.('本地语音服务启动失败，请检查 STT/TTS 服务配置~');
      return;
    }

    // 服务就绪（STT 是关键），开始通话循环
    const stt = providerManager.getActiveSTTProvider();
    if (!stt) {
      stopCallInternal();
      showError?.('请先在设置中配置语音识别 (STT) 服务~');
      return;
    }
    setCallState('incall');
    startTurn();
  }, [startTurn, stopCallInternal, showError, setCallState]);

  const toggle = useCallback(() => {
    if (activeRef.current) {
      stopCallInternal();
    } else {
      void startCall();
    }
  }, [startCall, stopCallInternal]);

  // 监听网关 voice 状态 + 助手回复（触发 TTS）
  useEffect(() => {
    const offVoice = eventBus.on('hermes:voice', (data: Record<string, unknown>) => {
      const action = data.action as string;
      if (action === 'start') {
        // all_ready = STT + Edge TTS 均已就绪（通话关键服务）；缺则降级为仅看 STT
        const allReady = typeof data.all_ready === 'boolean' ? data.all_ready : undefined;
        const services = (data.services as Record<string, { ok?: boolean }>) || {};
        const sttOk = services.stt ? Boolean(services.stt.ok) : false;
        const ttsOk = services.tts ? Boolean(services.tts.ok) : false;
        const ok = allReady ?? (sttOk && ttsOk);
        const resolve = voiceStartResolveRef.current;
        if (resolve) {
          voiceStartResolveRef.current = null;
          resolve(ok);
        }
      }
    });

    const offDone = eventBus.on('hermes:done', (data: Record<string, unknown>) => {
      if (!activeRef.current) return;
      if (stateRef.current !== 'speaking') return;
      const full = (data.fullResponse as string) || '';
      if (!full.trim()) {
        // 无有效回复，直接进入下一轮聆听
        if (activeRef.current) startTurn();
        return;
      }
      void playTts(full).then(() => {
        if (activeRef.current) startTurn();
      });
    });

    return () => {
      offVoice();
      offDone();
    };
  }, [playTts, startTurn]);

  // 卸载时清理
  useEffect(() => {
    return () => {
      activeRef.current = false;
      try {
        recorderRef.current?.cancel();
      } catch {
        /* ignore */
      }
      stopTts();
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [stopTts]);

  const active = state === 'incall' || state === 'listening' || state === 'speaking';

  return { state, seconds, active, toggle };
}
