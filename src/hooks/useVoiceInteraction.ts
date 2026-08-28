import { useState, useRef, useEffect, useCallback } from 'react';
import { AudioRecorder } from '../services/audio/recorder';
import { audioPlayer } from '../services/audio/player';
import { providerManager } from '../services/provider/manager';
import { transcribeViaBrain } from '../services/provider/sttBackend';
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
      const audio = await recorder.stop();
      recordingModeRef.current = 'idle';
      if (!audio) return;

      const result = await transcribeViaBrain(audio, 'wav');
      if (!result) {
        log.warn('No active STT provider');
        return;
      }
      if (result.text.trim()) {
        log.info('STT result', { text: result.text.slice(0, 50), emotion: result.emotion });
        if (result.emotion) {
          onUpdateFromVoice(result.text, result.emotion);
        }
        onSendMessage(result.text.trim());
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
