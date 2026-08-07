/**
 * AudioPlayer：Web Audio API 音频播放管道
 *
 * 功能：
 * - 播放队列（多条消息顺序播放）
 * - 打断机制（用户新消息停止当前语音）
 * - 音量控制
 * - 播放状态事件（开始/结束/打断）
 * - 振幅回调（用于嘴型同步 ParamMouthOpenY）
 */

import { createLogger } from '../../utils/logger';

const log = createLogger('AudioPlayer');

type PlayState = 'idle' | 'playing' | 'paused';

export interface AudioPlayerOptions {
  /** 音量 0-1，默认 0.8 */
  volume?: number;
  /** 振幅回调频率（ms），默认 50ms */
  amplitudeInterval?: number;
  /** 振幅回调，value 0-1，用于嘴型同步 */
  onAmplitude?: (value: number) => void;
  /** 播放状态变化回调 */
  onStateChange?: (state: PlayState) => void;
}

interface QueueItem {
  audio: ArrayBuffer;
  sampleRate: number;
  id: string;
}

export class AudioPlayer {
  private audioContext: AudioContext | null = null;
  private gainNode: GainNode | null = null;
  private currentSource: AudioBufferSourceNode | null = null;
  private queue: QueueItem[] = [];
  private state: PlayState = 'idle';
  private volume = 0.8;
  private amplitudeInterval = 50;
  private onAmplitude?: (value: number) => void;
  private onStateChange?: (state: PlayState) => void;
  private analyser: AnalyserNode | null = null;
  private amplitudeTimer: ReturnType<typeof setInterval> | null = null;
  private isProcessingQueue = false;

  constructor(options?: AudioPlayerOptions) {
    if (options?.volume !== undefined) this.volume = options.volume;
    if (options?.amplitudeInterval !== undefined)
      this.amplitudeInterval = options.amplitudeInterval;
    this.onAmplitude = options?.onAmplitude;
    this.onStateChange = options?.onStateChange;
  }

  /**
   * 初始化 AudioContext（需要用户交互后才能调用）
   */
  private ensureContext(): AudioContext {
    if (!this.audioContext || this.audioContext.state === 'closed') {
      this.audioContext = new AudioContext();
      this.gainNode = this.audioContext.createGain();
      this.gainNode.gain.value = this.volume;
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 256;
      this.gainNode.connect(this.analyser);
      this.analyser.connect(this.audioContext.destination);
    }
    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume();
    }
    return this.audioContext;
  }

  /**
   * 添加音频到播放队列
   */
  enqueue(audio: ArrayBuffer, sampleRate: number, id?: string): void {
    const itemId = id ?? `audio-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    this.queue.push({ audio, sampleRate, id: itemId });
    log.info('Enqueue', {
      id: itemId,
      size: audio.byteLength,
      sampleRate,
      queueDepth: this.queue.length,
    });
    if (!this.isProcessingQueue) {
      this.processQueue();
    }
  }

  /**
   * 顺序播放队列中的音频
   */
  private async processQueue(): Promise<void> {
    this.isProcessingQueue = true;

    while (this.queue.length > 0) {
      const item = this.queue.shift()!;
      log.debug('Playing', { id: item.id, size: item.audio.byteLength });
      try {
        await this.playBuffer(item.audio, item.sampleRate);
      } catch {
        log.debug('Playback interrupted or errored', { id: item.id });
        break;
      }
    }

    this.isProcessingQueue = false;
    if (this.state === 'playing') {
      this.setState('idle');
    }
    log.debug('Queue finished');
  }

  /**
   * 播放单个 ArrayBuffer
   */
  private playBuffer(audio: ArrayBuffer, _sampleRate: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const ctx = this.ensureContext();

      // 解码音频（支持 WAV/MP3/OGG）
      ctx.decodeAudioData(
        audio.slice(0),
        (decodedBuffer) => {
          if (this.state === 'idle' && this.currentSource) {
            // 已被打断
            reject(new Error('Interrupted'));
            return;
          }

          const source = ctx.createBufferSource();
          source.buffer = decodedBuffer;
          source.connect(this.gainNode!);
          this.currentSource = source;
          this.setState('playing');

          // 开始振幅监测
          this.startAmplitudeMonitor();

          source.onended = () => {
            this.stopAmplitudeMonitor();
            this.currentSource = null;
            if (this.onAmplitude) this.onAmplitude(0);
            resolve();
          };

          source.start(0);
        },
        (err) => {
          log.error('decodeAudioData error', err);
          reject(err);
        },
      );
    });
  }

  /**
   * 立即停止当前播放并清空队列
   */
  stop(): void {
    if (this.currentSource) {
      log.info('Stop/interrupt', { queueRemaining: this.queue.length });
      try {
        this.currentSource.stop();
      } catch {
        // 可能已经停止
      }
      this.currentSource = null;
    }
    this.queue = [];
    this.stopAmplitudeMonitor();
    this.setState('idle');
    if (this.onAmplitude) this.onAmplitude(0);
  }

  /**
   * 设置音量 0-1
   */
  setVolume(vol: number): void {
    this.volume = Math.max(0, Math.min(1, vol));
    if (this.gainNode) {
      this.gainNode.gain.value = this.volume;
    }
  }

  getVolume(): number {
    return this.volume;
  }

  getState(): PlayState {
    return this.state;
  }

  /**
   * 释放资源
   */
  dispose(): void {
    this.stop();
    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close();
    }
    this.audioContext = null;
    this.gainNode = null;
    this.analyser = null;
  }

  // ===== 内部 =====

  private setState(state: PlayState): void {
    if (this.state === state) return;
    this.state = state;
    this.onStateChange?.(state);
  }

  private startAmplitudeMonitor(): void {
    if (!this.analyser || !this.onAmplitude) return;

    const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
    this.amplitudeTimer = setInterval(() => {
      if (!this.analyser) return;
      this.analyser.getByteTimeDomainData(dataArray);

      // 计算 RMS 振幅
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        const val = (dataArray[i] - 128) / 128;
        sum += val * val;
      }
      const rms = Math.sqrt(sum / dataArray.length);
      // 映射到 0-1 范围，适当放大
      this.onAmplitude?.(Math.min(1, rms * 3));
    }, this.amplitudeInterval);
  }

  private stopAmplitudeMonitor(): void {
    if (this.amplitudeTimer) {
      clearInterval(this.amplitudeTimer);
      this.amplitudeTimer = null;
    }
  }
}

/** 全局单例 */
export const audioPlayer = new AudioPlayer();
