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
  private playFn: TtsPlayFn;

  constructor(playFn: TtsPlayFn) {
    this.playFn = playFn;
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
    this.inflight += 1;
    try {
      const res = await synthesizeViaBrain(sentence);
      if (!res) return;
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
