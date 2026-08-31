/**
 * useWatchTogether — "一起看"模式状态机
 *
 * 功能：
 * - idle ↔ watching 状态切换（Ctrl+Shift+S 触发）
 * - watching 模式下定时截屏 → LLM 视觉分析 → 气泡 + 表情 + TTS
 * - Esc 键退出
 * - 防抖：分析进行中不触发新一轮
 * - 去重：缓存最近 3 次评论，避免重复
 *
 * 集成方式：
 *   const { isWatching, toggleWatch } = useWatchTogether({
 *     showBubble, setEmotionFromResponse, setTalkingEmotion,
 *   });
 *   // useGlobalShortcuts 中调用 toggleWatch
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { createStorage } from '../services/storage';
import { synthesizeViaBrain } from '../services/provider/ttsBackend';
import { audioPlayer } from '../services/audio/player';
import {
  captureScreenshot,
  analyzeScreenshot,
  checkVisionCapability,
  type WatchTogetherResult,
} from '../services/scenes/watchTogether';
import { aiService } from '../services/ai';
import { providerManager } from '../services/provider/manager';
import { isTauriEnv } from '../utils/tauriEnv';
import { createLogger } from '../utils/logger';

const log = createLogger('useWatchTogether');

/** 多模态配置（与 MultimodalPage 保持一致） */
interface MultimodalConfig {
  enabled: boolean;
  visionDetection: 'auto' | 'manual';
  isVisionModel: boolean;
  visionSourcePriority: 'auto' | 'llm_first' | 'embedding_first' | 'vision_model_first';
  screenshotQuality: number;
  screenshotScale: number;
  watchInterval: number;
  watchPrompt: string;
}

const DEFAULT_CONFIG: MultimodalConfig = {
  enabled: true,
  visionDetection: 'auto',
  isVisionModel: false,
  visionSourcePriority: 'auto',
  screenshotQuality: 70,
  screenshotScale: 0.75,
  watchInterval: 30,
  watchPrompt: '',
};

const multimodalStorage = createStorage<MultimodalConfig>('multimodal', DEFAULT_CONFIG, {
  location: 'project',
  subdir: 'config',
});

export interface UseWatchTogetherOptions {
  /** 显示气泡文字 */
  showBubble: (text: string, duration?: number) => void;
  /** 从文本提取情感（复用 emotion engine 关键词匹配） */
  setEmotionFromResponse: (text: string) => void;
  /** 设置"说话中"表情 */
  setTalkingEmotion: () => void;
}

export interface UseWatchTogetherReturn {
  /** 是否处于"一起看"模式 */
  isWatching: boolean;
  /** 切换"一起看"模式（开→关 / 关→开） */
  toggleWatch: () => void;
  /** 手动触发一次截屏分析（不切换状态） */
  triggerOnce: () => void;
}

export function useWatchTogether({
  showBubble,
  setEmotionFromResponse,
  setTalkingEmotion,
}: UseWatchTogetherOptions): UseWatchTogetherReturn {
  const [isWatching, setIsWatching] = useState(false);

  const isWatchingRef = useRef(false);
  const isAnalyzingRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recentCommentsRef = useRef<string[]>([]);

  // 读取多模态配置
  const getConfig = useCallback((): MultimodalConfig => {
    try {
      return multimodalStorage.get();
    } catch {
      return DEFAULT_CONFIG;
    }
  }, []);

  /** 播放 TTS */
  const playTTS = useCallback(async (text: string) => {
    try {
      const result = await synthesizeViaBrain(text);
      if (!result) {
        log.warn('TTS 后端未能启动，跳过朗读');
        return;
      }
      audioPlayer.enqueue(result.audio, result.sampleRate, `watch-${Date.now()}`);
    } catch (err) {
      log.warn('TTS playback failed (non-fatal)', { err });
    }
  }, []);

  /** 执行一次截屏分析 */
  const runAnalysis = useCallback(async () => {
    if (isAnalyzingRef.current) {
      log.debug('Analysis already in progress, skipping');
      return;
    }

    const config = getConfig();
    if (!config.enabled) {
      log.info('Multimodal disabled, stopping watch mode');
      setIsWatching(false);
      return;
    }

    // 视觉来源优先级：配置「优先独立视觉模型」时，vision provider 天生支持视觉
    const useVisionModelFirst = config.visionSourcePriority === 'vision_model_first';
    const visionProvider = useVisionModelFirst ? providerManager.getActiveVisionProvider() : null;

    if (useVisionModelFirst && !visionProvider) {
      showBubble('请先在「视觉模型」服务中配置视觉模型~', 3000);
      setIsWatching(false);
      return;
    }

    // 非独立视觉模型模式：依赖对话 LLM 的原生视觉能力
    const chatProvider = aiService.getChatProvider();
    if (!useVisionModelFirst) {
      if (!chatProvider) {
        showBubble('请先配置 LLM 服务~', 3000);
        setIsWatching(false);
        return;
      }
      const isVision = checkVisionCapability(chatProvider.config.model, config);
      if (!isVision) {
        showBubble('当前模型不支持视觉，请选择 vision 模型~', 3000);
        log.info('Current model is not a vision model', { model: chatProvider.config.model });
        setIsWatching(false);
        return;
      }
    }

    isAnalyzingRef.current = true;
    setTalkingEmotion();

    try {
      const imageDataUrl = await captureScreenshot();
      const prompt = config.watchPrompt || '请分析这张截图并给出评论。';
      const result: WatchTogetherResult = await analyzeScreenshot(imageDataUrl, prompt, {
        visionSourcePriority: config.visionSourcePriority,
      });

      // 去重：如果和最近 3 次评论相同，换一句
      if (recentCommentsRef.current.includes(result.comment)) {
        log.debug('Duplicate comment detected, using generic');
        result.comment = '这个画面真有意思~';
      }
      recentCommentsRef.current = [...recentCommentsRef.current, result.comment].slice(-3);

      // 展示评论
      showBubble(result.comment, 6000);
      setEmotionFromResponse(result.expression);
      log.info('WatchTogether result', {
        expression: result.expression,
        description: result.description,
      });

      // TTS 播放
      await playTTS(result.comment);
    } catch (err) {
      log.error('Screenshot analysis failed', { err });
      showBubble('分析失败了，稍后再试~', 3000);
    } finally {
      isAnalyzingRef.current = false;
    }
  }, [getConfig, showBubble, setTalkingEmotion, setEmotionFromResponse, playTTS]);

  /** 启动定时截屏 */
  const startTimer = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    const config = getConfig();
    const intervalMs = Math.max(10, config.watchInterval) * 1000;
    timerRef.current = setInterval(() => {
      if (isWatchingRef.current && !isAnalyzingRef.current) {
        runAnalysis();
      }
    }, intervalMs);
    log.info('Watch timer started', { intervalSec: config.watchInterval });
  }, [getConfig, runAnalysis]);

  /** 停止定时截屏 */
  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
      log.info('Watch timer stopped');
    }
  }, []);

  /** 切换"一起看"模式 */
  const toggleWatch = useCallback(() => {
    if (!isTauriEnv()) {
      showBubble('一起看模式需要桌面环境~', 3000);
      return;
    }

    if (isWatchingRef.current) {
      // 关闭
      isWatchingRef.current = false;
      setIsWatching(false);
      stopTimer();
      audioPlayer.stop();
      showBubble('不看了不看了~', 2000);
      log.info('Watch mode OFF');
    } else {
      // 开启
      const config = getConfig();
      if (!config.enabled) {
        showBubble('请先在设置中启用多模态功能~', 3000);
        return;
      }
      isWatchingRef.current = true;
      setIsWatching(true);
      showBubble('好呀，一起看！', 2000);
      log.info('Watch mode ON');
      // 立即分析一次，然后启动定时器
      runAnalysis();
      startTimer();
    }
  }, [getConfig, showBubble, runAnalysis, startTimer, stopTimer]);

  /** 手动触发一次（不切换状态） */
  const triggerOnce = useCallback(() => {
    if (!isWatchingRef.current) {
      toggleWatch();
    } else {
      runAnalysis();
    }
  }, [toggleWatch, runAnalysis]);

  // Esc 键退出
  useEffect(() => {
    if (!isWatching) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (isWatchingRef.current) {
          isWatchingRef.current = false;
          setIsWatching(false);
          stopTimer();
          audioPlayer.stop();
          showBubble('不看了~', 2000);
          log.info('Watch mode OFF (Esc)');
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isWatching, stopTimer, showBubble]);

  // 组件卸载时清理
  useEffect(() => {
    return () => {
      isWatchingRef.current = false;
      stopTimer();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    isWatching,
    toggleWatch,
    triggerOnce,
  };
}
