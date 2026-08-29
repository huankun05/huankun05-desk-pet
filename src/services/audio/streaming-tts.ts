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
 * ⚠️ 不从句级提前切分、也不遇标点就切：CosyVoice 每次独立合成（无论句子长短）
 * 都有 ~2.5~3.5s 的首块固定成本。切得越碎 → 合成次数越多 → 句间全是「上句播完等
 * 下句首块」的静音间隙，听感「卡顿 / 没说完就被切掉」。
 * 采用长度分级：
 *  - 超短句（≤SHORT_IMMEDIATE 字，含标点）立即切：如「好的」「嗯」，多为完整回应，
 *    LLM 输出快，等下去无收益；
 *  - 短句（SHORT_IMMEDIATE+1 ~ MIN_SENTENCE_LEN-1）暂不切，继续缓冲与后续内容
 *    合并成一次合成（如「嗯...被摸头了。今天有点累...」合并为 26 字一次合成）；
 *  - 长句（≥MIN_SENTENCE_LEN）遇句末标点切，保证每次合成内容足够、播放时间
 *    长于下一句的首块延迟，句间无缝。
 */
const SENTENCE_END = /[。！？!?；;\n]/;
/** 超短句阈值：≤此长度（含标点）立即切句 */
const SHORT_IMMEDIATE = 6;
/** 最小合成长度：缓冲累计到该长度且遇句末标点才切（低于此长度的短句继续缓冲合并） */
const MIN_SENTENCE_LEN = 12;
/**
 * jitter buffer 目标音频字节数（24kHz / 16bit / mono = 48000 B/s）≈ 1.2s。
 *
 * CosyVoice 本地推理实际 RTF≈2（生成 1s 音频约需 2s，chunk 间隔 > chunk 时长），
 * 若 chunk 即到即播会频繁「播完等下一块」→ 卡顿。攒够 buffer 再开播可平滑停顿，
 * 代价是首字延迟增加约 1.2s；合成全部完成（finalFlush）时强制开播，短句不受影响。
 */
const JITTER_BUFFER_BYTES = 48000 * 1.2;

export class StreamingTTSPlayer {
  private buffer = '';
  private readyQueue: { audio: ArrayBuffer; sampleRate: number }[] = [];
  private playing = false;
  private finished = false;
  private active = true;
  /** jitter buffer 是否已开播；合成全部完成（finalFlush）时跳过等待强制开播 */
  private started = false;
  /** 所有句子已合成完成：即使 buffer 不足也开播（避免短句永远等不到） */
  private finalFlush = false;
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
   * 从缓冲中切出可合成的句子（长度分级，见 SENTENCE_END 注释）：
   * - 超短句（≤SHORT_IMMEDIATE）遇句末标点立即切（完整回应，等下去无收益）；
   * - 中等长度短句（<MIN_SENTENCE_LEN）继续缓冲，与后续内容合并成一次合成，
   *   避免短句独立合成的固定首块成本；
   * - 长句（≥MIN_SENTENCE_LEN）遇句末标点切，合成内容足够长、播放时间覆盖
   *   下一句的首块延迟。
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
    const idx = this.buffer.search(SENTENCE_END);
    if (idx < 0) return -1;
    const len = idx + 1; // 含标点的缓冲长度
    // 超短句（≤6 字）立即切：完整回应，LLM 输出快，等下去无收益
    if (len <= SHORT_IMMEDIATE) return idx;
    // 短句（7~11 字）继续缓冲，与后续内容合并成一次合成
    if (len < MIN_SENTENCE_LEN) return -1;
    return idx;
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
      // finish() 可能在本轮合成期间又追加了残留：队列非空则继续处理（自恢复，不用
      // return 以免触发 no-unsafe-finally）
      if (this.active && !this.failed && this.sentenceQueue.length > 0) {
        void this.processQueue();
      } else if (this.finished && this.sentenceQueue.length === 0) {
        // 所有句子合成完成：允许 pump 跳过 jitter buffer 强制开播（短句不用等攒够）
        this.finalFlush = true;
        this.pump();
      }
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
    // jitter buffer：合成未完成时攒够 ~1.2s 音频再开播，平滑服务端 chunk 间隙；
    // finalFlush（全部合成完）或 buffer 耗尽重攒后仍需满足条件
    if (!this.started && !this.finalFlush) {
      const buffered = this.readyQueue.reduce((s, c) => s + c.audio.byteLength, 0);
      if (buffered < JITTER_BUFFER_BYTES) return;
      this.started = true;
    }
    const next = this.readyQueue.shift();
    if (!next) {
      // buffer 耗尽：若合成未完成则重新攒 buffer，避免后续继续卡顿
      if (!this.finalFlush) this.started = false;
      return;
    }
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
    this.started = false;
    this.finalFlush = false;
  }
}
