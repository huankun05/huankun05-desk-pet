/**
 * useVoiceAssistant — 语音助手状态机
 *
 * 流程：
 *   Ctrl+Space 唤醒 → 录音（VAD 静音自动停止）→ STT 转文字
 *   → sendMessage 进入 Chat Pipeline → LLM 处理（可调用工具）
 *   → TTS 播放回复 → 气泡显示文字
 *
 * 设计要点：
 * - 不可重入：识别中再次唤醒会被忽略
 * - 无 STT 时降级为文本输入提示
 * - 录音失败/识别失败均给出友好提示
 * - 麦克风权限拒绝时引导用户
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { AudioRecorder } from '../services/audio/recorder';
import { providerManager } from '../services/provider/manager';
import { createLogger } from '../utils/logger';

const log = createLogger('VoiceAssistant');

export type VoiceAssistantState = 'idle' | 'listening' | 'recognizing' | 'processing';

export interface UseVoiceAssistantOptions {
  /** 显示气泡文字 */
  showBubble: (text: string, duration?: number) => void;
  /** 发送消息到 Chat Pipeline（含 LLM + 工具调用 + TTS） */
  sendMessage: (text: string) => Promise<void>;
  /** 设置"说话中"表情（录音/识别阶段） */
  setListeningEmotion?: () => void;
  /** 恢复空闲表情 */
  setIdleEmotion?: () => void;
}

export interface UseVoiceAssistantReturn {
  /** 当前状态 */
  state: VoiceAssistantState;
  /** 是否处于活跃状态（非 idle） */
  isActive: boolean;
  /** 唤醒语音助手（开始录音） */
  wake: () => void;
  /** 手动停止录音并识别 */
  stopAndRecognize: () => void;
  /** 取消当前会话 */
  cancel: () => void;
}

export function useVoiceAssistant({
  showBubble,
  sendMessage,
  setListeningEmotion,
  setIdleEmotion,
}: UseVoiceAssistantOptions): UseVoiceAssistantReturn {
  const [state, setState] = useState<VoiceAssistantState>('idle');

  const recorderRef = useRef<AudioRecorder | null>(null);
  const stateRef = useRef<VoiceAssistantState>('idle');

  const updateState = useCallback((next: VoiceAssistantState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  /** 确保录音器实例存在 */
  const ensureRecorder = useCallback((): AudioRecorder | null => {
    if (!AudioRecorder.isSupported()) {
      log.warn('MediaRecorder not supported in this environment');
      return null;
    }
    if (!recorderRef.current) {
      recorderRef.current = new AudioRecorder({
        sampleRate: 16000,
        silenceTimeout: 1500,
        silenceThreshold: 0.01,
      });
    }
    return recorderRef.current;
  }, []);

  /** 处理识别完成的文本 */
  const handleRecognizedText = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) {
        showBubble('没听清，再说一次~', 2500);
        updateState('idle');
        setIdleEmotion?.();
        return;
      }

      log.info('Recognized text', { text: trimmed, length: trimmed.length });
      showBubble(`🎤 ${trimmed}`, 3500);
      updateState('processing');

      try {
        // 直接走 Chat Pipeline，LLM 会自动调用工具（写文件/截屏/搜索等）
        await sendMessage(trimmed);
      } catch (err) {
        log.error('sendMessage failed in voice assistant', { err });
        showBubble('处理失败了，稍后再试~', 3000);
      } finally {
        updateState('idle');
        setIdleEmotion?.();
      }
    },
    [showBubble, sendMessage, updateState, setIdleEmotion],
  );

  /** 唤醒：开始录音 */
  const wake = useCallback(async () => {
    if (stateRef.current !== 'idle') {
      log.debug('Already active, ignoring wake', { state: stateRef.current });
      return;
    }

    // 检查 STT Provider
    const sttProvider = providerManager.getActiveSTTProvider();
    if (!sttProvider) {
      showBubble('请先在设置中配置语音识别 (STT) 服务~', 3000);
      log.info('No STT provider configured');
      return;
    }

    const recorder = ensureRecorder();
    if (!recorder) {
      showBubble('当前环境不支持录音~', 3000);
      return;
    }

    updateState('listening');
    setListeningEmotion?.();
    showBubble('正在聆听...', 2000);

    try {
      await recorder.start();
      log.info('Recording started');
    } catch (err) {
      log.error('Failed to start recording', { err });
      const errMsg = err instanceof Error ? err.message : String(err);
      if (
        errMsg.includes('Permission') ||
        errMsg.includes('denied') ||
        errMsg.includes('NotAllowed')
      ) {
        showBubble('麦克风权限被拒绝，请在系统设置中允许~', 4000);
      } else {
        showBubble('录音启动失败~', 3000);
      }
      updateState('idle');
      setIdleEmotion?.();
    }
  }, [ensureRecorder, showBubble, updateState, setListeningEmotion, setIdleEmotion]);

  /** 停止录音并触发识别 */
  const stopAndRecognize = useCallback(async () => {
    if (stateRef.current !== 'listening') return;

    const recorder = recorderRef.current;
    if (!recorder) {
      updateState('idle');
      return;
    }

    updateState('recognizing');
    showBubble('识别中...', 2000);

    try {
      const audioBuffer = await recorder.stop();
      if (!audioBuffer) {
        log.warn('No audio captured');
        showBubble('没听到声音~', 2500);
        updateState('idle');
        setIdleEmotion?.();
        return;
      }

      const sttProvider = providerManager.getActiveSTTProvider();
      if (!sttProvider) {
        showBubble('STT 服务不可用~', 3000);
        updateState('idle');
        return;
      }

      log.info('Transcribing audio', { size: audioBuffer.byteLength });
      const result = await sttProvider.transcribe(audioBuffer, 'wav');
      await handleRecognizedText(result.text);
    } catch (err) {
      log.error('STT transcription failed', { err });
      showBubble('识别失败了，稍后再试~', 3000);
      updateState('idle');
      setIdleEmotion?.();
    }
  }, [showBubble, updateState, handleRecognizedText, setIdleEmotion]);

  /** 取消当前会话 */
  const cancel = useCallback(() => {
    if (stateRef.current === 'idle') return;
    log.info('Voice assistant cancelled');

    const recorder = recorderRef.current;
    if (recorder && recorder.getState() === 'recording') {
      recorder.cancel();
    }

    updateState('idle');
    setIdleEmotion?.();
    showBubble('已取消', 1500);
  }, [updateState, setIdleEmotion, showBubble]);

  // 组件卸载时清理录音器
  useEffect(() => {
    return () => {
      const recorder = recorderRef.current;
      if (recorder && recorder.getState() !== 'idle') {
        recorder.cancel();
      }
    };
  }, []);

  return {
    state,
    isActive: state !== 'idle',
    wake,
    stopAndRecognize,
    cancel,
  };
}
