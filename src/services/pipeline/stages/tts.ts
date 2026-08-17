/**
 * TTSStage — TTS 语音合成
 *
 * 获取当前活跃 TTS Provider，validate 预检，synthesize 合成。
 * 连接丢失时优雅降级（warn 不抛错）。
 */

import type { Stage, MessageContext, PipelineCallbacks } from '../types';
import type { ProviderManager } from '../../provider/manager';
import { ensureActiveTTSBackend } from '../../provider/ttsBackend';
import { createLogger } from '../../../utils/logger';
import { showToast } from '../../../utils/toast';

const log = createLogger('TTSStage');

export class TTSStage implements Stage {
  readonly name = 'tts';
  private manager: ProviderManager;

  constructor(manager: ProviderManager) {
    this.manager = manager;
  }

  async process(ctx: MessageContext, _callbacks: PipelineCallbacks): Promise<void> {
    if (!ctx.speakableText) return;

    // 自动拉起活跃 TTS 后端（避免"后端未运行→静默跳过合成"）。
    // 应用启动预热通常会先拉起；此处兜底，确保任何 speak 路径都能触发。
    const backendOk = await ensureActiveTTSBackend({ waitReady: true, timeoutMs: 30000 });
    if (!backendOk) {
      log.warn('TTS 后端不可用，跳过本次合成', { text: ctx.speakableText.slice(0, 30) });
      showToast('TTS 服务不可用，请检查配置', 'warning');
      return;
    }

    const ttsProvider = this.manager.getSessionTTSProvider(ctx.session.id);
    if (!ttsProvider) {
      showToast('TTS 服务不可用，请检查配置', 'warning');
      return;
    }

    const providerId = ttsProvider.config.id;
    try {
      // 优先 isAvailable()（运行时健康探针），未实现则回退 validate()
      const isReachable =
        typeof ttsProvider.isAvailable === 'function'
          ? await ttsProvider.isAvailable()
          : await ttsProvider.validate();
      if (!isReachable) {
        log.warn('TTS service unreachable, skipping synthesis', {
          provider: ttsProvider.getName(),
        });
        this.manager.markUnhealthy('tts', providerId);
        showToast(`TTS 服务「${ttsProvider.getName()}」不可用，已自动降级`, 'warning');
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
      // 合成失败：标记该 provider 不健康，下次 getActiveTTSProvider 自动回退（Phase 12.1）
      this.manager.markUnhealthy('tts', providerId);
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
