/**
 * FrontendVADService — 前端实时语音活动检测（VAD）
 *
 * 基于 Web Audio API AnalyserNode 的能量检测 VAD，无需外部模型文件。
 * 持续分析麦克风输入的能量，检测用户是否在说话。
 *
 * 功能：
 * - 实时语音开始/结束检测
 * - 可配置的能量阈值和静音超时
 * - 语音中断回调（用户开口 → 中断 AI 说话）
 * - 静默降级（无麦克风权限时自动禁用）
 *
 * 借鉴 Open-LLM-VTuber 的 VAD 前端检测模式，适配 desk_pet 架构。
 */

import { createLogger } from '../../utils/logger';

const log = createLogger('FrontendVAD');

export interface VADConfig {
  /** 语音能量阈值 (0-1)，默认 0.015 */
  speechThreshold?: number;
  /** 语音开始后需持续的最短时间 (ms)，默认 200 */
  minSpeechDuration?: number;
  /** 静音超时判定语音结束 (ms)，默认 800 */
  silenceTimeout?: number;
  /** FFT 大小，默认 2048 */
  fftSize?: number;
  /** 检测频率 (ms)，默认 50 */
  checkInterval?: number;
}

export interface VADCallbacks {
  /** 检测到语音开始 */
  onSpeechStart?: () => void;
  /** 检测到语音结束 */
  onSpeechEnd?: () => void;
  /** 语音中断（用户开口打断 AI 说话） */
  onInterrupt?: () => void;
}

type VADState = 'idle' | 'listening' | 'speaking' | 'error';

export class FrontendVADService {
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private mediaStream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;

  private config: Required<VADConfig>;
  private callbacks: VADCallbacks = {};

  private state: VADState = 'idle';
  private checkTimer: ReturnType<typeof setInterval> | null = null;
  private speechStartTime = 0;
  private silenceStartTime = 0;
  private wasSpeaking = false;

  private isAvailable = false;
  private permissionDenied = false;

  constructor(config: VADConfig = {}) {
    this.config = {
      speechThreshold: config.speechThreshold ?? 0.015,
      minSpeechDuration: config.minSpeechDuration ?? 200,
      silenceTimeout: config.silenceTimeout ?? 800,
      fftSize: config.fftSize ?? 2048,
      checkInterval: config.checkInterval ?? 50,
    };
  }

  /** VAD 是否可用（浏览器支持 + 麦克风权限） */
  get available(): boolean {
    return this.isAvailable;
  }

  /** 当前状态 */
  get currentState(): VADState {
    return this.state;
  }

  /** 是否正在检测到语音 */
  get isSpeaking(): boolean {
    return this.state === 'speaking';
  }

  /** 检查浏览器是否支持所需 API */
  static isSupported(): boolean {
    return !!(
      navigator.mediaDevices &&
      typeof navigator.mediaDevices.getUserMedia === 'function' &&
      window.AudioContext &&
      window.AnalyserNode
    );
  }

  /** 设置回调 */
  setCallbacks(callbacks: VADCallbacks): void {
    this.callbacks = callbacks;
  }

  /**
   * 启动 VAD 监听
   * @returns true 如果成功启动
   */
  async start(): Promise<boolean> {
    if (this.state !== 'idle') return false;
    if (this.permissionDenied) return false;

    try {
      // 获取麦克风权限
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      // 创建 AudioContext + AnalyserNode
      this.audioContext = new AudioContext({ sampleRate: 16000 });
      this.source = this.audioContext.createMediaStreamSource(this.mediaStream);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = this.config.fftSize;
      this.analyser.smoothingTimeConstant = 0.3;
      this.source.connect(this.analyser);

      this.isAvailable = true;
      this.setState('listening');
      this.startChecking();

      log.info('Frontend VAD started', { threshold: this.config.speechThreshold });
      return true;
    } catch (err) {
      // 权限被拒后标记，不再重复尝试
      if (
        err instanceof DOMException &&
        (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError')
      ) {
        this.permissionDenied = true;
        log.info('VAD: 麦克风权限被拒，已静默禁用');
      } else {
        log.warn('Frontend VAD failed to start', err);
      }
      this.cleanup();
      this.setState('error');
      this.isAvailable = false;
      return false;
    }
  }

  /**
   * 停止 VAD 监听
   */
  stop(): void {
    if (this.state === 'idle') return;

    this.stopChecking();
    this.cleanup();
    this.wasSpeaking = false;
    this.setState('idle');

    log.debug('Frontend VAD stopped');
  }

  /**
   * 重置检测状态（不停止监听）
   */
  reset(): void {
    this.wasSpeaking = false;
    this.speechStartTime = 0;
    this.silenceStartTime = 0;
    if (this.state === 'speaking') {
      this.setState('listening');
    }
  }

  /**
   * 释放所有资源
   */
  dispose(): void {
    this.stop();
    this.callbacks = {};
    this.isAvailable = false;
  }

  // ===== 内部方法 =====

  private startChecking(): void {
    this.stopChecking();
    this.checkTimer = setInterval(() => this.checkAudio(), this.config.checkInterval);
  }

  private stopChecking(): void {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }
  }

  private checkAudio(): void {
    if (!this.analyser || this.state === 'idle') return;

    const dataArray = new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(dataArray);

    // 计算 RMS 能量
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
      sum += dataArray[i] * dataArray[i];
    }
    const rms = Math.sqrt(sum / dataArray.length);

    this.processVADResult(rms);
  }

  private processVADResult(rms: number): void {
    const isAboveThreshold = rms >= this.config.speechThreshold;
    const now = Date.now();

    if (isAboveThreshold) {
      // 能量高于阈值 → 可能是语音
      if (this.state === 'listening') {
        // 首次检测到能量
        this.speechStartTime = now;
        this.setState('speaking');
        this.callbacks.onSpeechStart?.();
      } else if (this.state === 'speaking') {
        // 持续语音中，重置静音计时
        this.silenceStartTime = 0;
      }
    } else if (this.state === 'speaking') {
      // 能量低于阈值 → 可能是静音
      if (this.silenceStartTime === 0) {
        this.silenceStartTime = now;
      }

      const silenceDuration = now - this.silenceStartTime;
      const speechDuration = now - this.speechStartTime;

      if (
        silenceDuration >= this.config.silenceTimeout &&
        speechDuration >= this.config.minSpeechDuration
      ) {
        // 确认语音结束（静音足够长 + 语音持续足够久）
        this.wasSpeaking = true;
        this.callbacks.onSpeechEnd?.();
        this.setState('listening');
      } else if (silenceDuration >= this.config.silenceTimeout * 2) {
        // 长时间静音，强制重置
        this.wasSpeaking = false;
        this.setState('listening');
      }
    }
  }

  private setState(newState: VADState): void {
    if (this.state === newState) return;
    const prev = this.state;
    this.state = newState;
    log.debug('VAD state changed', { from: prev, to: newState });
  }

  private cleanup(): void {
    this.stopChecking();

    if (this.source) {
      try {
        this.source.disconnect();
      } catch {
        /* ignore */
      }
      this.source = null;
    }

    if (this.analyser) {
      try {
        this.analyser.disconnect();
      } catch {
        /* ignore */
      }
      this.analyser = null;
    }

    if (this.audioContext && this.audioContext.state !== 'closed') {
      void this.audioContext.close();
      this.audioContext = null;
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((t) => t.stop());
      this.mediaStream = null;
    }
  }
}
