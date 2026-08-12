/**
 * AudioRecorder：麦克风录音
 *
 * 功能：
 * - MediaRecorder API 录音
 * - WAV 16kHz mono 输出
 * - VAD 简单端点检测（静音 1.5s 自动停止）
 * - 录音状态事件
 */

import { createLogger } from '../../utils/logger';

const log = createLogger('Recorder');

export type RecordState = 'idle' | 'recording' | 'processing';

export interface RecorderOptions {
  /** 采样率，默认 16000 */
  sampleRate?: number;
  /** 静音超时（ms），超过后自动停止，默认 1500 */
  silenceTimeout?: number;
  /** 静音阈值 0-1，默认 0.01 */
  silenceThreshold?: number;
  /** 录音状态变化回调 */
  onStateChange?: (state: RecordState) => void;
  /** 实时音频回调（用于流式 STT，预留） */
  onAudioChunk?: (chunk: Float32Array) => void;
  /** 静音自动停止后的音频回调（返回 WAV 数据），供语音通话循环使用 */
  onAutoStop?: (audio: ArrayBuffer) => void;
}

export class AudioRecorder {
  private mediaRecorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private chunks: Blob[] = [];
  private state: RecordState = 'idle';
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;
  private sampleRate = 16000;
  private silenceTimeout = 1500;
  private silenceThreshold = 0.01;
  private onStateChange?: (state: RecordState) => void;
  private onAudioChunk?: (chunk: Float32Array) => void;
  /** 静音自动停止后的音频回调；语音通话循环通过它拿到一段语音去识别 */
  onAutoStop?: (audio: ArrayBuffer) => void;
  private silenceCheckTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options?: RecorderOptions) {
    if (options?.sampleRate) this.sampleRate = options.sampleRate;
    if (options?.silenceTimeout) this.silenceTimeout = options.silenceTimeout;
    if (options?.silenceThreshold) this.silenceThreshold = options.silenceThreshold;
    this.onStateChange = options?.onStateChange;
    this.onAudioChunk = options?.onAudioChunk;
    this.onAutoStop = options?.onAutoStop;
  }

  /**
   * 开始录音
   */
  async start(): Promise<void> {
    if (this.state !== 'idle') return;

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: this.sampleRate,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });

      // 创建 AudioContext 用于静音检测
      this.audioContext = new AudioContext({ sampleRate: this.sampleRate });
      const source = this.audioContext.createMediaStreamSource(this.stream);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 256;
      source.connect(this.analyser);

      // 开始 MediaRecorder
      this.chunks = [];
      this.mediaRecorder = new MediaRecorder(this.stream, {
        mimeType: this.getBestMimeType(),
      });

      this.mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          this.chunks.push(e.data);
        }
      };

      this.mediaRecorder.onstop = () => {
        // 录音结束由 stop() 处理
      };

      this.mediaRecorder.start(100); // 每 100ms 收集一次数据
      this.setState('recording');
      log.info('Recording started', {
        mimeType: this.mediaRecorder.mimeType,
        sampleRate: this.sampleRate,
      });

      // 启动静音检测
      this.startSilenceDetection();
    } catch (err) {
      log.error('Failed to start recording', err);
      this.cleanup();
      throw err;
    }
  }

  /**
   * 停止录音，返回 WAV 音频数据
   */
  async stop(): Promise<ArrayBuffer | null> {
    if (this.state !== 'recording') return null;

    this.setState('processing');
    this.stopSilenceDetection();

    // 停止 MediaRecorder
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
    }

    // 等待最后的 dataavailable 事件
    await new Promise<void>((resolve) => setTimeout(resolve, 200));

    // 合并 Blob
    if (this.chunks.length === 0) {
      log.warn('Stop called but no audio chunks recorded');
      this.cleanup();
      this.setState('idle');
      return null;
    }

    const blob = new Blob(this.chunks, { type: this.mediaRecorder?.mimeType ?? 'audio/webm' });
    const arrayBuffer = await blob.arrayBuffer();

    // 转换为 WAV 16kHz mono
    const wavBuffer = await this.convertToWav(arrayBuffer);
    log.info('Recording stopped', {
      chunks: this.chunks.length,
      rawSize: arrayBuffer.byteLength,
      wavSize: wavBuffer.byteLength,
    });

    this.cleanup();
    this.setState('idle');
    return wavBuffer;
  }

  /**
   * 取消录音（不返回数据）
   */
  cancel(): void {
    log.info('Recording cancelled');
    this.stopSilenceDetection();
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
    }
    this.cleanup();
    this.setState('idle');
  }

  getState(): RecordState {
    return this.state;
  }

  /**
   * 检查浏览器是否支持录音
   */
  static isSupported(): boolean {
    return !!(
      navigator.mediaDevices &&
      typeof navigator.mediaDevices.getUserMedia === 'function' &&
      window.MediaRecorder
    );
  }

  // ===== 内部 =====

  private getBestMimeType(): string {
    const candidates = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
      'audio/mp4',
    ];
    for (const mime of candidates) {
      if (MediaRecorder.isTypeSupported(mime)) return mime;
    }
    return '';
  }

  private startSilenceDetection(): void {
    this.resetSilenceTimer();
    this.silenceCheckTimer = setInterval(() => {
      if (!this.analyser) return;

      const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
      this.analyser.getByteTimeDomainData(dataArray);

      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        const val = (dataArray[i] - 128) / 128;
        sum += val * val;
      }
      const rms = Math.sqrt(sum / dataArray.length);

      if (rms > this.silenceThreshold) {
        this.resetSilenceTimer();
      }

      // 实时回调
      if (this.onAudioChunk) {
        const float32 = new Float32Array(dataArray.length);
        for (let i = 0; i < dataArray.length; i++) {
          float32[i] = (dataArray[i] - 128) / 128;
        }
        this.onAudioChunk(float32);
      }
    }, 100);
  }

  private resetSilenceTimer(): void {
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    this.silenceTimer = setTimeout(() => {
      if (this.state === 'recording') {
        log.info('Silence detected, auto-stopping recording');
        void this.stop().then((buf) => {
          if (buf) this.onAutoStop?.(buf);
        });
      }
    }, this.silenceTimeout);
  }

  private stopSilenceDetection(): void {
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
    if (this.silenceCheckTimer) {
      clearInterval(this.silenceCheckTimer);
      this.silenceCheckTimer = null;
    }
  }

  private async convertToWav(audioBuffer: ArrayBuffer): Promise<ArrayBuffer> {
    // 使用 OfflineAudioContext 解码为 PCM
    const ctx = new OfflineAudioContext(1, 1, this.sampleRate);
    const decoded = await ctx.decodeAudioData(audioBuffer.slice(0));

    // 重采样到目标采样率
    const offlineCtx = new OfflineAudioContext(
      1,
      Math.ceil(decoded.duration * this.sampleRate),
      this.sampleRate,
    );
    const source = offlineCtx.createBufferSource();
    source.buffer = decoded;
    source.connect(offlineCtx.destination);
    source.start(0);
    const rendered = await offlineCtx.startRendering();

    // PCM → WAV
    const pcm = rendered.getChannelData(0);
    return this.pcmToWav(pcm, this.sampleRate);
  }

  private pcmToWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
    const numSamples = samples.length;
    const buffer = new ArrayBuffer(44 + numSamples * 2);
    const view = new DataView(buffer);

    // WAV header
    const writeString = (offset: number, str: string) => {
      for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
      }
    };

    writeString(0, 'RIFF');
    view.setUint32(4, 36 + numSamples * 2, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true); // chunk size
    view.setUint16(20, 1, true); // PCM format
    view.setUint16(22, 1, true); // mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true); // byte rate
    view.setUint16(32, 2, true); // block align
    view.setUint16(34, 16, true); // bits per sample
    writeString(36, 'data');
    view.setUint32(40, numSamples * 2, true);

    // PCM samples
    let offset = 44;
    for (let i = 0; i < numSamples; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      offset += 2;
    }

    return buffer;
  }

  private cleanup(): void {
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close();
      this.audioContext = null;
    }
    this.mediaRecorder = null;
    this.analyser = null;
    this.chunks = [];
  }

  private setState(state: RecordState): void {
    if (this.state === state) return;
    this.state = state;
    this.onStateChange?.(state);
  }
}
