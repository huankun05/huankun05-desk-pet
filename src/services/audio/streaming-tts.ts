/**
 * StreamingTTSController — 流式 TTS 并行合成 + 有序播放控制器
 *
 * 工作流程：
 * 1. LLM 流式输出期间，句子边界触发 onStreamingTTS 回调，句子入队
 * 2. Pipeline 完成后，并行合成所有收集到的句子
 * 3. 按序投放到 AudioPlayer，实现"边说边生成"
 *
 * 借鉴 Open-LLM-VTuber 的 SentenceDivider + TTSTaskManager 模式
 */

import { createLogger } from '../../utils/logger';
import { synthesizeViaBrain } from '../provider/ttsBackend';

const log = createLogger('StreamingTTS');

interface SentenceJob {
  seq: number;
  text: string;
}

interface SynthesisResult {
  seq: number;
  audio: ArrayBuffer;
  sampleRate: number;
}

export class StreamingTTSController {
  private sentences: SentenceJob[] = [];
  private seqCounter = 0;
  private results: Map<number, SynthesisResult> = new Map();
  private emotion?: string;

  /** 设置情感参数 */
  setup(emotion?: string): void {
    this.emotion = emotion;
  }

  /** 是否已配置（不再强依赖 provider 实例） */
  get isReady(): boolean {
    return true;
  }

  /** 添加一个完整句子（在 LLM 流式期间调用） */
  addSentence(text: string): void {
    const trimmed = text.trim();
    if (!trimmed) return;

    const seq = this.seqCounter++;
    this.sentences.push({ seq, text: trimmed });
    log.debug('Sentence collected', { seq, text: trimmed.slice(0, 40) });
  }

  /** 已收集的句子数量 */
  get pendingCount(): number {
    return this.sentences.length;
  }

  /**
   * 并行合成所有收集到的句子
   * 返回按 seq 排序的音频结果数组
   */
  async synthesizeAll(): Promise<SynthesisResult[]> {
    if (this.sentences.length === 0) {
      return [];
    }

    log.info('Streaming TTS: 开始并行合成', {
      count: this.sentences.length,
      emotion: this.emotion,
    });

    const ttsStart = performance.now();

    // 并行合成所有句子
    const promises = this.sentences.map((job) =>
      this.synthesizeSentence(job).catch((err) => {
        log.warn('Sentence synthesis failed', { seq: job.seq, text: job.text.slice(0, 40), err });
        return null;
      }),
    );

    const results = await Promise.all(promises);
    const validResults = results.filter((r): r is SynthesisResult => r !== null);

    const durationMs = Math.round(performance.now() - ttsStart);
    log.info('Streaming TTS: 合成完成', {
      total: this.sentences.length,
      success: validResults.length,
      durationMs,
    });

    // 按 seq 排序（并行合成可能乱序完成）
    validResults.sort((a, b) => a.seq - b.seq);

    // 清空已合成的句子
    this.sentences = [];
    this.seqCounter = 0;

    return validResults;
  }

  /**
   * 合成单个句子
   */
  private async synthesizeSentence(job: SentenceJob): Promise<SynthesisResult> {
    const ttsStart = performance.now();
    const result = await synthesizeViaBrain(job.text, {
      emotion: this.emotion,
    });
    if (!result) {
      throw new Error('synthesizeViaBrain returned null');
    }

    const durationMs = Math.round(performance.now() - ttsStart);
    log.debug('Sentence synthesized', {
      seq: job.seq,
      textLen: job.text.length,
      audioSize: result.audio.byteLength,
      durationMs,
    });

    return {
      seq: job.seq,
      audio: result.audio,
      sampleRate: result.sampleRate,
    };
  }

  /** 重置状态 */
  reset(): void {
    this.sentences = [];
    this.seqCounter = 0;
    this.results.clear();
  }
}
