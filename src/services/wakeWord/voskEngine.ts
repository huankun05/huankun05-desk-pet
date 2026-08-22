/**
 * VoskEngine — Vosk WASM 唤醒词检测引擎
 *
 * 封装 vosk-browser 的模型加载、识别器创建、音频处理。
 * 使用关键词列表模式（grammar），仅识别配置的唤醒词，CPU 占用极低。
 *
 * 使用流程：
 *   1. ensureModelLoaded() — 加载模型（通过 convertFileSrc 访问本地文件）
 *   2. start(keyword, onDetected) — 开启麦克风，检测到关键词时回调
 *   3. stop() — 停止监听，释放麦克风
 *   4. terminate() — 彻底释放模型和 WASM 资源
 */

// 注意：vosk-browser 体积约 5.8MB（WASM 引擎），改为按需动态导入，
// 避免它被打进首屏初始 JS 包，阻塞模型加载前的解析/编译耗时。
import type { Model, KaldiRecognizer } from 'vosk-browser';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { createLogger } from '../../utils/logger';

const log = createLogger('VoskEngine');

export class VoskEngine {
  private model: Model | null = null;
  private recognizer: KaldiRecognizer | null = null;
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private processorNode: ScriptProcessorNode | null = null;
  private listening = false;
  private modelLoaded = false;

  /** 模型是否已加载 */
  get isModelLoaded(): boolean {
    return this.modelLoaded;
  }

  /** 是否正在监听 */
  get isListening(): boolean {
    return this.listening;
  }

  /**
   * 检查本地是否已有模型文件
   */
  static async checkModel(): Promise<boolean> {
    try {
      return await invoke<boolean>('check_vosk_model');
    } catch {
      return false;
    }
  }

  /**
   * 下载模型（调用 Rust 命令）
   * @param onProgress 下载进度回调 (0-1)
   */
  static async downloadModel(
    onProgress?: (downloaded: number, total: number) => void,
  ): Promise<void> {
    const { listen } = await import('@tauri-apps/api/event');

    // 监听进度事件
    const unlisten = await listen<{ downloaded: number; total: number }>(
      'vosk-model-progress',
      (event) => {
        if (onProgress) {
          onProgress(event.payload.downloaded, event.payload.total);
        }
      },
    );

    try {
      await invoke('download_vosk_model');
    } finally {
      unlisten();
    }
  }

  /**
   * 加载 Vosk 模型
   *
   * 通过 convertFileSrc 将本地文件路径转为 asset:// URL，
   * vosk-browser 在 Web Worker 中 fetch 该 URL 加载模型。
   */
  async ensureModelLoaded(): Promise<void> {
    if (this.modelLoaded && this.model) return;

    const exists = await VoskEngine.checkModel();
    if (!exists) {
      throw new Error('Vosk model not downloaded. Call downloadModel() first.');
    }

    // 获取模型文件路径
    const modelPath = await invoke<string>('get_project_data_dir').then(
      (dir) => `${dir}/models/vosk/model.tar.gz`,
    );

    // 转为 webview 可访问的 URL
    const modelUrl = convertFileSrc(modelPath);
    log.info('Loading Vosk model', { modelUrl });

    // 动态导入 vosk-browser（约 5.8MB），仅在真正启用唤醒词时才下载/解析
    const { createModel } = await import('vosk-browser');
    this.model = await createModel(modelUrl);
    this.modelLoaded = true;
    log.info('Vosk model loaded successfully');
  }

  /**
   * 开始监听唤醒词
   *
   * @param keyword 唤醒词（如"汐月"）
   * @param onDetected 检测到唤醒词时的回调
   * @param options 匹配选项：variants=近音候选词；sensitivity=灵敏度档
   */
  async start(
    keyword: string,
    onDetected: () => void,
    options?: { variants?: string[]; sensitivity?: 'strict' | 'standard' | 'loose' },
  ): Promise<void> {
    if (!this.model) {
      throw new Error('Model not loaded. Call ensureModelLoaded() first.');
    }
    if (this.listening) {
      log.warn('Already listening, ignoring start()');
      return;
    }

    const sensitivity = options?.sensitivity ?? 'standard';
    const variants = options?.variants ?? [];
    // strict 档不启用候选词，仅精确主词
    const matchWords = sensitivity === 'strict' ? [keyword] : [keyword, ...variants];

    // 创建识别器，使用关键词列表 grammar
    // grammar 格式：JSON 字符串数组，包含关键词（含候选）和 [unk]（未知词占位）
    const grammar = JSON.stringify([...matchWords, '[unk]']);
    this.recognizer = new this.model.KaldiRecognizer(16000, grammar);

    // 是否接受 partial 结果触发：仅 loose 档，避免普通对话误唤醒
    const acceptPartial = sensitivity === 'loose';

    const hit = (text: string): boolean => {
      const t = text.trim();
      if (!t) return false;
      return matchWords.some((w) => w && t.includes(w));
    };

    // 监听识别结果
    this.recognizer.on('result', (msg) => {
      if (!('result' in msg) || !('text' in msg.result)) return;
      const text = msg.result.text.trim();
      log.debug('Recognition result', { text });
      if (hit(text)) {
        log.info('Wake word detected', { keyword, matchWords, text });
        onDetected();
      }
    });

    this.recognizer.on('partialresult', (msg) => {
      if (!acceptPartial) return;
      if (!('result' in msg) || !('partial' in msg.result)) return;
      const partial = msg.result.partial.trim();
      if (partial && hit(partial)) {
        log.info('Wake word detected (partial)', { keyword, matchWords, partial });
        onDetected();
      }
    });

    // 开启麦克风
    this.mediaStream = await navigator.mediaDevices.getUserMedia({
      video: false,
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        channelCount: 1,
        sampleRate: 16000,
      },
    });

    // 创建音频处理链
    this.audioContext = new AudioContext({ sampleRate: 16000 });
    this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);

    // 使用 ScriptProcessor（虽然已废弃，但 vosk-browser 依赖它）
    // 缓冲区大小 4096，单声道
    this.processorNode = this.audioContext.createScriptProcessor(4096, 1, 1);
    this.processorNode.onaudioprocess = (event) => {
      if (!this.recognizer || !this.listening) return;
      try {
        this.recognizer.acceptWaveform(event.inputBuffer);
      } catch (err) {
        log.error('acceptWaveform failed', { err });
      }
    };

    this.sourceNode.connect(this.processorNode);
    // ScriptProcessorNode 需要连接到 destination 才能工作（即使不输出声音）
    this.processorNode.connect(this.audioContext.destination);

    this.listening = true;
    log.info('Wake word listening started', { keyword });
  }

  /**
   * 停止监听（保留模型，可再次 start）
   */
  stop(): void {
    this.listening = false;

    if (this.processorNode) {
      this.processorNode.disconnect();
      this.processorNode.onaudioprocess = null;
      this.processorNode = null;
    }
    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((t) => t.stop());
      this.mediaStream = null;
    }
    if (this.recognizer) {
      this.recognizer.remove();
      this.recognizer = null;
    }

    log.info('Wake word listening stopped');
  }

  /**
   * 彻底释放模型和 WASM 资源
   */
  terminate(): void {
    this.stop();
    if (this.model) {
      this.model.terminate();
      this.model = null;
    }
    this.modelLoaded = false;
    log.info('Vosk engine terminated');
  }
}
