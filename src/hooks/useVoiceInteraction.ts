import { useState, useRef, useEffect, useCallback } from 'react';
import { AudioRecorder } from '../services/audio/recorder';
import { audioPlayer } from '../services/audio/player';
import { providerManager } from '../services/provider/manager';
import {
  transcribeViaBrain,
  startStreamingSTT,
  type StreamingSTTHandle,
} from '../services/provider/sttBackend';
import { setMouthOpenY } from '../lib/live2d';
import { useVADInteraction } from './useVADInteraction';
import { createLogger } from '../utils/logger';

const log = createLogger('VoiceInteraction');

export interface UseVoiceInteractionOptions {
  isStreaming: boolean;
  onInterrupt: () => void;
  onSendMessage: (text: string) => void;
  onUpdateFromVoice: (text: string, voiceEmotion?: string) => void;
  onSetTalkingEmotion: () => void;
  sessionId?: string;
  /** 是否启用 VAD 自动聆听（说话即自动对话）。默认 false，关闭则不开麦。 */
  autoListen?: boolean;
}

export interface VoiceInteractionState {
  isRecording: boolean;
  sttAvailable: boolean;
  vadIsSpeaking: boolean;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<void>;
}

export function useVoiceInteraction({
  isStreaming,
  onInterrupt,
  onSendMessage,
  onUpdateFromVoice,
  onSetTalkingEmotion: _onSetTalkingEmotion,
  autoListen = false,
}: UseVoiceInteractionOptions): VoiceInteractionState {
  const [isRecording, setIsRecording] = useState(false);
  const [sttAvailable, setSttAvailable] = useState(
    () => providerManager.getActiveSTTProvider() !== null,
  );
  const recorderRef = useRef<AudioRecorder | null>(null);
  const sttStreamHandleRef = useRef<StreamingSTTHandle | null>(null);
  const vadInterruptRef = useRef<(() => void) | null>(null);
  const recordingModeRef = useRef<'idle' | 'manual' | 'auto'>('idle');

  useEffect(() => {
    if (!recorderRef.current && AudioRecorder.isSupported()) {
      recorderRef.current = new AudioRecorder({
        sampleRate: 16000,
        silenceTimeout: 1500,
        silenceThreshold: 0.01,
        // 手动按住模式：关闭静音自动停，避免说完话停顿 1.5s 后音频被自动停止并丢弃
        autoStopOnSilence: false,
        onStateChange: (state) => {
          if (state === 'recording') setIsRecording(true);
          if (state === 'idle') {
            setIsRecording(false);
            recordingModeRef.current = 'idle';
          }
        },
      });
    }
    return () => {
      recorderRef.current?.cancel();
    };
  }, []);

  useEffect(() => {
    const player = audioPlayer as unknown as { onAmplitude?: (value: number) => void };
    const originalOnAmplitude = player.onAmplitude;
    player.onAmplitude = (value: number) => {
      setMouthOpenY(value);
      originalOnAmplitude?.(value);
    };

    const sttTimer = setInterval(() => {
      const cfg = providerManager.getActiveSTTConfig();
      const available = cfg !== null;
      setSttAvailable(available);
      try {
        localStorage.setItem('deskpet_sttAvailable', String(available));
      } catch {
        /* ignore */
      }
    }, 3000);

    return () => {
      player.onAmplitude = originalOnAmplitude;
      clearInterval(sttTimer);
      setMouthOpenY(0);
    };
  }, []);

  const handleRecordStart = useCallback(async () => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    if (recordingModeRef.current !== 'idle') return;
    try {
      recordingModeRef.current = 'manual';
      await recorder.start();
      // 启动流式 STT：边说边识别，停止即出最终文本；WS 不可用时 handle 为 null，停止时回退整段识别。
      try {
        const handle = await startStreamingSTT(recorder);
        sttStreamHandleRef.current = handle;
      } catch {
        sttStreamHandleRef.current = null;
      }
    } catch (err) {
      recordingModeRef.current = 'idle';
      log.error('Record start failed', err);
    }
  }, []);

  const handleRecordStop = useCallback(async () => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    if (recordingModeRef.current !== 'manual') return;
    try {
      recordingModeRef.current = 'idle';
      let text = '';
      let emotion: string | undefined;
      // 优先取流式最终结果（说话途中已边识别，停止即出，延迟最低）
      const handle = sttStreamHandleRef.current;
      sttStreamHandleRef.current = null;
      if (handle) {
        try {
          const res = await handle.finish();
          if (res && res.text.trim()) {
            text = res.text.trim();
            emotion = res.emotion;
          }
        } catch {
          /* 流式结束失败，下面回退 */
        } finally {
          handle.dispose();
        }
      }
      // 停止录音释放麦克风
      let audio: ArrayBuffer | null = null;
      try {
        audio = await recorder.stop();
      } catch {
        /* ignore */
      }
      // 流式未拿到文本 → 回退整段识别
      if (!text && audio) {
        const result = await transcribeViaBrain(audio, 'wav');
        if (result?.text?.trim()) {
          text = result.text.trim();
          emotion = result.emotion;
        }
      }
      if (text) {
        log.info('STT result', { text: text.slice(0, 50), emotion });
        if (emotion) {
          onUpdateFromVoice(text, emotion);
        }
        onSendMessage(text);
      } else {
        log.warn('No active STT provider / empty result');
      }
    } catch (err) {
      recordingModeRef.current = 'idle';
      log.error('STT transcription failed', err);
    }
  }, [onSendMessage, onUpdateFromVoice]);

  const handleVADAutoSTT = useCallback(
    async (phase: string) => {
      const recorder = recorderRef.current;
      if (!recorder) return;

      if (phase === 'start') {
        if (recorder.getState() === 'idle' && !isStreaming && recordingModeRef.current === 'idle') {
          try {
            recordingModeRef.current = 'auto';
            await recorder.start();
            log.debug('VAD auto-STT: 自动开始录音');
          } catch (err) {
            recordingModeRef.current = 'idle';
            log.warn('VAD auto-STT 录音启动失败', err);
          }
        }
      } else if (phase === 'ended' || phase === 'stop') {
        if (recordingModeRef.current !== 'auto') return;
        const audio = await recorder.stop();
        recordingModeRef.current = 'idle';
        if (!audio) return;
        try {
          const result = await transcribeViaBrain(audio, 'wav');
          if (!result) {
            log.warn('VAD auto-STT: 无 STT Provider');
            return;
          }
          const text = result.text.trim();
          if (text) {
            log.info('VAD auto-STT 识别完成', { text: text.slice(0, 50) });
            if (result.emotion) {
              onUpdateFromVoice(text, result.emotion);
            }
            onSendMessage(text);
          }
        } catch (err) {
          recordingModeRef.current = 'idle';
          log.error('VAD auto-STT STT 失败', err);
        }
      }
    },
    [onSendMessage, onUpdateFromVoice, isStreaming],
  );

  useEffect(() => {
    vadInterruptRef.current = () => {
      log.info('VAD: 语音中断', { action: 'stop TTS + abort LLM' });
      onInterrupt();
    };
  }, [onInterrupt]);

  const { isSpeaking: vadIsSpeaking } = useVADInteraction({
    isPlaying: audioPlayer.getState() === 'playing',
    isStreaming,
    onInterrupt: () => vadInterruptRef.current?.(),
    onAutoSTT: handleVADAutoSTT,
    speechThreshold: 0.015,
    silenceTimeout: 600,
    enabled: autoListen,
  });

  return {
    isRecording,
    sttAvailable,
    vadIsSpeaking,
    startRecording: handleRecordStart,
    stopRecording: handleRecordStop,
  };
}
