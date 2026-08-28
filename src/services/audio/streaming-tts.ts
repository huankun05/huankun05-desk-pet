/**
 * StreamingTTSPlayer — 流式 TTS 渐进式播放器
 *
 * 设计目标：边生成边播，降低「首音延迟 (TTFA)」，让多句回复更快出声。
 * - push(text)：喂入流式增量文本；自动按句末标点切句，逐句送合成。
 * - 合成与播放重叠：句子 N 正在播放时，句子 N+1 已在后台合成。
 * - finish()：标记流式结束，把残留片段作为最后一句合成播放。
 * - whenDone()：Promise，全部合成并播放完毕时 resolve（供「播完才下一轮」场景）。
 *
 * 注意：本播放器仅降低「听到第一句的时间」，不改变总音频时长；
 * 仅对支持流式/逐句合成的引擎（Edge / CosyVoice）有感知收益，极短句收益很小。
 */

import { createLogger } from '../../utils/logger';
import { synthesizeViaBrain } from '../provider/ttsBackend';

const log = createLogger('StreamingTTS');

export type TtsPlayFn = (audio: ArrayBuffer, sampleRate: number) => void | Promise<void>;

const SENTENCE_END = /[。！？!?；;\n]/;

export class StreamingTTSPlayer {
  private buffer = '';
  private readyQueue: { audio: ArrayBuffer; sampleRate: number }[] = [];
  private playing = false;
  private finished = false;
  private active = true;
  private inflight = 0;
  /**
   * 熔断标志：任一句合成返回 null（后端不可用 / 无 provider）后，
   * 后续句子直接跳过。否则每个句子都会各自触发一次后端就绪轮询，
   * 在服务不可用时形成 N × 超时 的等待与 IPC 风暴。
   */
  private failed = false;
  private playFn: TtsPlayFn;
  /** 说话情绪（透传给 TTS 后端，使语气与表情同源）；首句判定前为 null */
  private emotion: string | null = null;

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

  private extractSentences(): void {
    let idx = this.buffer.search(SENTENCE_END);
    while (idx >= 0) {
      const sentence = this.buffer.slice(0, idx + 1).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (sentence) this.enqueueSentence(sentence);
      idx = this.buffer.search(SENTENCE_END);
    }
  }

  private enqueueSentence(sentence: string): void {
    void this.synthesize(sentence);
  }

  private async synthesize(sentence: string): Promise<void> {
    // 已熔断：后端不可用，后续句子不再尝试（避免重复等待超时）
    if (this.failed) return;
    this.inflight += 1;
    try {
      const res = await synthesizeViaBrain(
        sentence,
        this.emotion ? { emotion: this.emotion } : undefined,
      );
      if (!res) {
        // 后端不可用或无 provider：熔断本轮，后续句子直接跳过
        this.failed = true;
        log.warn('TTS 后端不可用，熔断本轮剩余句子的合成');
        return;
      }
      this.readyQueue.push({ audio: res.audio, sampleRate: res.sampleRate });
      this.pump();
    } catch (e) {
      log.warn('sentence synthesis failed', e);
    } finally {
      this.inflight -= 1;
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
    if (rem) this.enqueueSentence(rem);
  }

  /** 全部合成并播放完毕时 resolve。 */
  whenDone(): Promise<void> {
    return new Promise((resolve) => {
      const check = () => {
        if (this.finished && !this.playing && this.readyQueue.length === 0 && this.inflight === 0) {
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
  }
}
