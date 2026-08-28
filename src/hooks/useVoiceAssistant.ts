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
import { transcribeViaBrain } from '../services/provider/sttBackend';
import { createLogger } from '../utils/logger';
import { eventBus } from '../services/eventBus';

const log = createLogger('VoiceAssistant');

/**
 * STT 模型是否已预热（进程级，整段会话只探测一次）。
 * 唤醒时后台异步预热，成功后置位；后续唤醒不再发探测请求，直接进聆听态。
 */
let sttWarmed = false;

/**
 * 生成一段静音 WAV（16k mono）用于唤醒时做 STT 可用性探测 + 预热模型。
 * 不要发 0 字节：服务端虽已对空音频做保护，但发送静音 WAV 既能正常走通
 * 识别链路（返回空文本=可用），又能在录入真实语音前把模型加载好，避免卡顿。
 */
function makeSilentWav(seconds = 0.3): ArrayBuffer {
  const sampleRate = 16000;
  const numSamples = Math.floor(sampleRate * seconds);
  const buffer = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(buffer);
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + numSamples * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, numSamples * 2, true);
  // 采样点全 0（静音），无需填充
  return buffer;
}

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
  /** 手动按键模式：开启后关闭静音自动停止，需再次按 Ctrl+Space 才结束并识别 */
  manualStop?: boolean;
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
  manualStop,
}: UseVoiceAssistantOptions): UseVoiceAssistantReturn {
  const [state, setState] = useState<VoiceAssistantState>('idle');

  const recorderRef = useRef<AudioRecorder | null>(null);
  const stateRef = useRef<VoiceAssistantState>('idle');
  /** 录到音频的统一处理函数（用 ref 避免 ensureRecorder 闭包里的“声明前引用”问题） */
  const recordedAudioHandlerRef = useRef<((buf: ArrayBuffer | null) => void) | null>(null);

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
        silenceTimeout: 800,
        silenceThreshold: 0.01,
      });
      // 静音自动停止时把录到的音频交给统一处理函数，否则真实录音会被丢弃
      recorderRef.current.onAutoStop = (buf) => {
        void recordedAudioHandlerRef.current?.(buf);
      };
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
      // 顶部刘海字幕：显示识别出的用户语句（recognized 态）
      eventBus.emit('subtitle:update', { phase: 'recognized', text: trimmed });
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

  /**
   * 处理录到的音频（静音自动停止 / 手动停止 共用）。
   * 关键：录音器静音超时自动停止时会回调 onAutoStop(buf)，必须把音频喂到这里，
   * 否则真实录音会被丢弃（之前语音助手没接 onAutoStop，导致只有唤醒探测的静音 WAV 到达 STT）。
   */
  const handleRecordedAudio = useCallback(
    async (audioBuffer: ArrayBuffer | null) => {
      if (stateRef.current !== 'listening') return; // 防重入（自动/手动停止可能重复触发）
      if (!audioBuffer) {
        showBubble('没听到声音~', 2500);
        updateState('idle');
        setIdleEmotion?.();
        return;
      }

      updateState('recognizing');
      showBubble('识别中...', 2000);
      // 顶部刘海字幕：识别中
      eventBus.emit('subtitle:update', { phase: 'listening', text: '识别中…' });

      try {
        const result = await transcribeViaBrain(audioBuffer, 'wav');
        if (!result) {
          showBubble('STT 服务不可用~', 3000);
          updateState('idle');
          return;
        }
        await handleRecognizedText(result.text);
      } catch (err) {
        log.error('STT transcription failed', { err });
        showBubble('识别失败了，稍后再试~', 3000);
        updateState('idle');
        setIdleEmotion?.();
      }
    },
    [showBubble, updateState, handleRecognizedText, setIdleEmotion],
  );

  // 同步处理函数到 ref，供 ensureRecorder 的 onAutoStop 闭包使用
  useEffect(() => {
    recordedAudioHandlerRef.current = handleRecordedAudio;
  }, [handleRecordedAudio]);

  /** 唤醒：开始录音 */
  const wake = useCallback(async () => {
    if (stateRef.current !== 'idle') {
      log.debug('Already active, ignoring wake', { state: stateRef.current });
      return;
    }

    const recorder = ensureRecorder();
    if (!recorder) {
      showBubble('当前环境不支持录音~', 3000);
      return;
    }

    // 运行时应用手动/自动模式（支持设置页实时切换，无需重建录音器）
    recorder.autoStopOnSilence = !manualStop;

    updateState('listening');
    setListeningEmotion?.();
    if (manualStop) {
      // 手动模式：明确提示"再按一次结束"，停顿不会误触发识别
      showBubble('正在聆听…（再按 Ctrl+Space 结束）', 2500);
      eventBus.emit('subtitle:update', {
        phase: 'listening',
        text: '聆听中…（再按 Ctrl+Space 结束）',
      });
    } else {
      showBubble('正在聆听...', 2000);
      eventBus.emit('subtitle:update', { phase: 'listening', text: '正在聆听…' });
    }

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
      return;
    }

    // 预热 STT 模型：后台异步发一段静音 WAV，不阻塞「聆听」开始。
    // （不 await：避免每次唤醒都多等一个网络往返才进聆听态；模型在用户说话期间
    // 即可加载完成，首次真实语音识别几乎无感。不要发 0 字节——服务端已对空音频
    // 做保护，但静音 WAV 能正常走通识别链路并预热 FunASR 模型。）
    // 可用性（未配置 STT）由 handleRecordedAudio 在真实识别时统一提示，无需此处挡路。
    if (!sttWarmed) {
      void transcribeViaBrain(makeSilentWav(0.3), 'wav')
        .then((ok) => {
          if (ok) sttWarmed = true;
        })
        .catch(() => {
          /* 首次预热失败不阻塞，留待真实识别时报错 */
        });
    }
  }, [ensureRecorder, showBubble, updateState, setListeningEmotion, setIdleEmotion, manualStop]);

  /** 停止录音并触发识别（手动停止：如再次按下 Ctrl+Space） */
  const stopAndRecognize = useCallback(async () => {
    if (stateRef.current !== 'listening') return;

    const recorder = recorderRef.current;
    if (!recorder) {
      updateState('idle');
      return;
    }

    const audioBuffer = await recorder.stop();
    await handleRecordedAudio(audioBuffer);
  }, [updateState, handleRecordedAudio]);

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
