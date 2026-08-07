/**
 * TTSStage — TTS 语音合成
 *
 * 获取当前活跃 TTS Provider，validate 预检，synthesize 合成。
 * 连接丢失时优雅降级（warn 不抛错）。
 */

import type { Stage, MessageContext, PipelineCallbacks } from '../types';
import type { ProviderManager } from '../../provider/manager';
import { createLogger } from '../../../utils/logger';

const log = createLogger('TTSStage');

export class TTSStage implements Stage {
  readonly name = 'tts';
  private manager: ProviderManager;

  constructor(manager: ProviderManager) {
    this.manager = manager;
  }

  async process(ctx: MessageContext, _callbacks: PipelineCallbacks): Promise<void> {
    if (!ctx.speakableText) return;

    const ttsProvider = this.manager.getSessionTTSProvider(ctx.session.id);
    if (!ttsProvider) return;

    try {
      const isReachable = await ttsProvider.validate();
      if (!isReachable) {
        log.warn('TTS service unreachable, skipping synthesis', {
          provider: ttsProvider.getName(),
        });
        return;
      }

      const ttsStart = performance.now();
      const currentEmotion = ctx.emotionSnapshot.emotion;
      const ttsResult = await ttsProvider.synthesize(ctx.speakableText, {
        emotion: currentEmotion !== 'idle' ? currentEmotion : undefined,
      });

      const durationMs = Math.round(performance.now() - ttsStart);
      const audioSize = ttsResult.audio.byteLength;
      log.info('TTS 合成完成', {
        provider: ttsProvider.getName(),
        textLen: ctx.speakableText.length,
        audioSize,
        durationMs,
        emotion: currentEmotion !== 'idle' ? currentEmotion : 'neutral',
      });

      ctx.ttsAudio = ttsResult.audio;
      ctx.ttsSampleRate = ttsResult.sampleRate;
    } catch (ttsErr) {
      if (ttsErr instanceof TypeError && ttsErr.message.includes('Failed to fetch')) {
        log.warn('TTS service connection lost during synthesis', {
          provider: ttsProvider.getName(),
        });
      } else {
        log.warn('TTS synthesis failed', ttsErr);
      }
    }
  }
}
