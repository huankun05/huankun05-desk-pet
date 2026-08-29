/**
 * StreamingTTSPlayer — 流式 TTS 渐进式播放器
 *
 * 设计目标：边生成边播，降低「首音延迟 (TTFA)」，让多句回复更快出声。
 * - push(text)：喂入流式增量文本；按句末标点切整句，逐句送合成（不做从句级切分，
 *   CosyVoice 每次合成首块 2~5s，切碎会增加句间间隙，反而更卡）。
 * - 合成与播放重叠：句子 N 正在播放时，句子 N+1 已在后台合成。
 * - finish()：标记流式结束，把残留片段作为最后一句合成播放。
 * - whenDone()：Promise，全部合成并播放完毕时 resolve（供「播完才下一轮」场景）。
 *
 * 关键改进（通话延迟专项）：
 * 本播放器现在通过 synthesizeStreamViaBrain 消费「流式合成」——
 * 支持流式合成的引擎（CosyVoice / Edge）会边合成边 yield 音频块，
 * 首块到达即播放，把通话里「说一句 → 等整段合成完 → 才出声」的 4~7s 等待，
 * 压缩到「首块到达即可出声」（CosyVoice 实测约 3s）。
 * 句子之间严格按顺序串行合成，保证多句回复的播放顺序不串台。
 */

import { createLogger } from '../../utils/logger';
import { synthesizeStreamViaBrain } from '../provider/ttsBackend';

const log = createLogger('StreamingTTS');

export type TtsPlayFn = (audio: ArrayBuffer, sampleRate: number) => void | Promise<void>;

/** 整句边界：到此处才切句（保证标点完整、语气自然）。
 *
 * ⚠️ 不再从句级提前切分（曾按「，、：」切 ≥5 字的从句）——实测对 CosyVoice 是反优化：
 * CosyVoice 每次独立合成都有 2~5s 的首块延迟，从句切得越碎 → 独立合成次数越多 →
 * 句间全是「上一句播完等下一句首块」的静音间隙，听感「卡顿 / 没说完就被切掉」。
 * 只按句末标点切整句：整段回复通常 1~3 句，首块延迟只承担少数几次，
 * 且「句 N 播放时句 N+1 已在后台合成」的重叠窗口足够，听感连贯。
 */
const SENTENCE_END = /[。！？!?；;\n]/;

export class StreamingTTSPlayer {
  private buffer = '';
  private readyQueue: { audio: ArrayBuffer; sampleRate: number }[] = [];
  private playing = false;
  private finished = false;
  private active = true;
  /**
   * 熔断标志：任一句合成未产出任何音频（后端不可用 / 无 provider）后，
   * 后续句子直接跳过。否则每个句子都会各自触发一次后端就绪轮询，
   * 在服务不可用时形成 N × 超时 的等待与 IPC 风暴。
   */
  private failed = false;
  private playFn: TtsPlayFn;
  /** 说话情绪（透传给 TTS 后端，使语气与表情同源）；首句判定前为 null */
  private emotion: string | null = null;
  /** 待合成句子队列（按句切分后顺序合成，保证播放顺序） */
  private sentenceQueue: string[] = [];
  /** 正在处理句子队列（串行，避免多句 chunk 交叉导致顺序错乱） */
  private draining = false;

  constructor(playFn: TtsPlayFn) {
    this.playFn = playFn;
  }

  /** 设置本段回复的说话情绪（首句判定后调用，影响后续每句的合成语气） */
  setEmotion(emotion: string | null): void {
    this.emotion = emotion;
  }

  /** 喂入增量文本（来自流式 token）。 */
  push(text: string): void {
    if (!this.active || !text) return;
    this.buffer += text;
    this.extractSentences();
  }

  /**
   * 从缓冲中切出可合成的句子：
   * - 只在整句边界（SENTENCE_END：。！？!?；;\n）切句，保证标点完整、语气自然；
   * - 未到整句边界则等待更多 token（不做从句级提前切分，见 SENTENCE_END 注释）。
   * 句子之间严格按顺序入队，保证播放顺序不串台。
   */
  private extractSentences(): void {
    let idx = this.nextBoundary();
    while (idx >= 0) {
      const sentence = this.buffer.slice(0, idx + 1).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (sentence) this.sentenceQueue.push(sentence);
      idx = this.nextBoundary();
    }
    this.drain();
  }

  /** 返回下一个应切句的边界下标；无则 -1 */
  private nextBoundary(): number {
    return this.buffer.search(SENTENCE_END);
  }

  private drain(): void {
    if (this.draining || !this.active) return;
    this.draining = true;
    void this.processQueue();
  }

  private async processQueue(): Promise<void> {
    try {
      while (this.sentenceQueue.length > 0 && this.active && !this.failed) {
        const sentence = this.sentenceQueue.shift()!;
        await this.synthesizeSentence(sentence);
      }
    } finally {
      this.draining = false;
    }
  }

  /** 流式合成单句：边 yield 边推入播放队列（首块到达即出声），串行保证顺序 */
  private async synthesizeSentence(sentence: string): Promise<void> {
    const opts = this.emotion ? { emotion: this.emotion } : undefined;
    let yielded = 0;
    try {
      for await (const chunk of synthesizeStreamViaBrain(sentence, opts)) {
        if (!this.active) break;
        yielded += 1;
        this.readyQueue.push(chunk);
        this.pump();
      }
    } catch (e) {
      log.warn('sentence synthesis failed', e);
    }
    // 整句未产出任何音频 → 后端不可用，熔断本轮剩余句子，避免 N× 超时等待
    if (this.active && yielded === 0) {
      this.failed = true;
      log.warn('TTS 后端不可用，熔断本轮剩余句子的合成');
    }
  }

  private pump(): void {
    if (!this.active || this.playing) return;
    const next = this.readyQueue.shift();
    if (!next) return;
    this.playing = true;
    Promise.resolve(this.playFn(next.audio, next.sampleRate)).finally(() => {
      this.playing = false;
      this.pump();
    });
  }

  /** 标记流式结束，把残留文本作为最后一句合成播放。 */
  finish(): void {
    this.finished = true;
    const rem = this.buffer.trim();
    this.buffer = '';
    if (rem) this.sentenceQueue.push(rem);
    this.drain();
  }

  /** 全部合成并播放完毕时 resolve。 */
  whenDone(): Promise<void> {
    return new Promise((resolve) => {
      const check = () => {
        if (this.finished && !this.draining && !this.playing && this.readyQueue.length === 0) {
          resolve();
        } else {
          setTimeout(check, 80);
        }
      };
      check();
    });
  }

  /** 立即停止（不再播放后续句子）。 */
  stop(): void {
    this.active = false;
    this.readyQueue = [];
    this.buffer = '';
    this.sentenceQueue = [];
  }
}
