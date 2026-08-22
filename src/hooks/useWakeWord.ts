/**
 * useWakeWord — 语音唤醒词状态机
 *
 * 流程：
 *   [启用] → 加载模型 → 开启麦克风监听
 *   [检测到"汐月"] → TTS"在"→ 自动唤醒语音助手（useVoiceAssistant）
 *   [语音助手完成] → 恢复唤醒词监听
 *   [禁用] → 停止监听 → 释放资源
 *
 * 资源管理：
 * - 默认关闭，用户在设置页启用
 * - 语音助手活跃时暂停唤醒词监听（避免回声误触发）
 * - 组件卸载时自动释放
 *
 * 跨窗口同步：
 * - 配置存储在 localStorage（deskpet_wakeWordConfig），设置页修改后通过 storage 事件通知主窗口
 * - 状态同步到 localStorage（deskpet_wakeWord），供设置页指示器读取
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { VoskEngine } from '../services/wakeWord/voskEngine';
import { synthesizeViaBrain } from '../services/provider/ttsBackend';
import { audioPlayer } from '../services/audio/player';
import { isTauriEnv } from '../utils/tauriEnv';
import { createLogger } from '../utils/logger';
import { readStorage, writeStorage } from './useStorageEvent';

const log = createLogger('useWakeWord');

/** localStorage 键 */
const CONFIG_KEY = 'deskpet_wakeWordConfig';
const STATE_KEY = 'deskpet_wakeWord';

/** 唤醒灵敏度档位 */
export type WakeSensitivity = 'strict' | 'standard' | 'loose';

/** 唤醒词配置 */
export interface WakeWordConfig {
  enabled: boolean;
  /** 主唤醒词 */
  keyword: string;
  /** 近音/同音候选词（命中任一即唤醒），用于缓解 Vosk 中文同音误识别 */
  variants: string[];
  /** 灵敏度：strict=仅精确主词+最终结果；standard=主词+候选+最终结果；loose=主词+候选+partial 也触发 */
  sensitivity: WakeSensitivity;
  /** 唤醒后角色回应的候选语（随机选一条） */
  responses: string[];
}

const DEFAULT_CONFIG: WakeWordConfig = {
  enabled: false,
  keyword: '汐月',
  variants: ['西月', '溪月', '昔月', '喜悦'],
  sensitivity: 'standard',
  responses: ['在~', '嗯？', '怎么啦', '我在呢', '叫我有事吗'],
};

/** 读取唤醒词配置（旧配置缺字段时补齐默认值，保证向后兼容） */
export function readWakeWordConfig(): WakeWordConfig {
  const saved = readStorage<Partial<WakeWordConfig> | null>(CONFIG_KEY, null);
  if (saved && typeof saved === 'object' && 'enabled' in saved && 'keyword' in saved) {
    return {
      ...DEFAULT_CONFIG,
      ...saved,
      variants: Array.isArray(saved.variants) ? saved.variants : DEFAULT_CONFIG.variants,
      responses: Array.isArray(saved.responses) && saved.responses.length > 0
        ? saved.responses
        : DEFAULT_CONFIG.responses,
    };
  }
  return DEFAULT_CONFIG;
}

/** 写入唤醒词配置（设置页调用） */
export function writeWakeWordConfig(config: WakeWordConfig): void {
  writeStorage(CONFIG_KEY, JSON.stringify(config));
}

export type WakeWordState = 'idle' | 'loading-model' | 'listening' | 'error';

export interface UseWakeWordOptions {
  /** 显示气泡文字 */
  showBubble: (text: string, duration?: number) => void;
  /** 触发语音助手（检测到唤醒词后调用） */
  onWake: () => void;
  /** 唤醒瞬间触发的视觉反馈（表情+动作），在 onWake 之前调用 */
  onWakeVisual?: () => void;
  /** 检查语音助手是否活跃（活跃时暂停唤醒词监听） */
  isVoiceAssistantActive: () => boolean;
}

export interface UseWakeWordReturn {
  /** 当前状态 */
  state: WakeWordState;
  /** 模型是否已下载 */
  modelReady: boolean;
  /** 启用唤醒词监听 */
  enable: () => Promise<void>;
  /** 禁用唤醒词监听 */
  disable: () => void;
  /** 下载模型（首次使用时） */
  downloadModel: (onProgress?: (d: number, t: number) => void) => Promise<void>;
}

export function useWakeWord({
  showBubble,
  onWake,
  onWakeVisual,
  isVoiceAssistantActive,
}: UseWakeWordOptions): UseWakeWordReturn {
  const [state, setState] = useState<WakeWordState>('idle');
  const [modelReady, setModelReady] = useState(false);

  const engineRef = useRef<VoskEngine | null>(null);
  const stateRef = useRef<WakeWordState>('idle');
  const configRef = useRef<WakeWordConfig>(DEFAULT_CONFIG);
  const wakeLockRef = useRef(false); // 防止唤醒词连续触发

  const updateState = useCallback((next: WakeWordState) => {
    stateRef.current = next;
    setState(next);
    try {
      writeStorage(STATE_KEY, next);
    } catch {
      /* ignore */
    }
  }, []);

  /** 播放"在"的语音回应 */
  const playResponse = useCallback(async (text: string) => {
    try {
      const result = await synthesizeViaBrain(text);
      if (!result) {
        log.warn('wake word: TTS 后端不可用，跳过语音回应');
        return;
      }
      audioPlayer.enqueue(result.audio, result.sampleRate, `wake-${Date.now()}`);
    } catch (err) {
      log.warn('TTS response failed (non-fatal)', { err });
    }
  }, []);

  /** 唤醒词检测回调 */
  const handleDetected = useCallback(() => {
    // 防止连续触发（500ms 冷却）
    if (wakeLockRef.current) return;
    if (isVoiceAssistantActive()) {
      log.debug('Voice assistant active, ignoring wake word');
      return;
    }

    wakeLockRef.current = true;
    setTimeout(() => {
      wakeLockRef.current = false;
    }, 500);

    log.info('Wake word detected, triggering voice assistant');
    const responses = configRef.current.responses.length
      ? configRef.current.responses
      : DEFAULT_CONFIG.responses;
    const picked = responses[Math.floor(Math.random() * responses.length)];
    // 唤醒瞬间的视觉反馈（惊喜表情 + 动作），先于语音助手进入聆听态
    try {
      onWakeVisual?.();
    } catch (err) {
      log.warn('onWakeVisual failed (non-fatal)', { err });
    }
    showBubble(picked, 1500);
    playResponse(picked);
    onWake();
  }, [showBubble, playResponse, onWake, onWakeVisual, isVoiceAssistantActive]);

  /** 下载模型 */
  const downloadModel = useCallback(async (onProgress?: (d: number, t: number) => void) => {
    try {
      await VoskEngine.downloadModel(onProgress);
      setModelReady(true);
      log.info('Vosk model downloaded');
    } catch (err) {
      log.error('Model download failed', { err });
      throw err;
    }
  }, []);

  /** 启用唤醒词监听 */
  const enable = useCallback(async () => {
    if (!isTauriEnv()) {
      showBubble('唤醒词需要桌面环境~', 3000);
      return;
    }
    if (stateRef.current === 'listening' || stateRef.current === 'loading-model') {
      log.debug('Already active, ignoring enable()');
      return;
    }

    // 检查模型
    const hasModel = await VoskEngine.checkModel();
    if (!hasModel) {
      showBubble('请先下载语音模型~', 3000);
      log.info('Model not downloaded, cannot enable');
      return;
    }

    updateState('loading-model');

    try {
      // 创建/复用引擎实例
      if (!engineRef.current) {
        engineRef.current = new VoskEngine();
      }
      await engineRef.current.ensureModelLoaded();

      const keyword = configRef.current.keyword;
      await engineRef.current.start(keyword, handleDetected, {
        variants: configRef.current.variants,
        sensitivity: configRef.current.sensitivity,
      });

      updateState('listening');
      log.info('Wake word enabled', { keyword });
    } catch (err) {
      log.error('Failed to enable wake word', { err });
      updateState('error');
      const errMsg = err instanceof Error ? err.message : String(err);
      if (
        errMsg.includes('Permission') ||
        errMsg.includes('denied') ||
        errMsg.includes('NotAllowed')
      ) {
        showBubble('麦克风权限被拒绝，请在系统设置中允许~', 4000);
      } else {
        showBubble('唤醒词启动失败~', 3000);
      }
    }
  }, [showBubble, updateState, handleDetected]);

  /** 禁用唤醒词监听 */
  const disable = useCallback(() => {
    if (engineRef.current) {
      engineRef.current.stop();
    }
    updateState('idle');
    log.info('Wake word disabled');
  }, [updateState]);

  /** 根据配置的 enabled 字段启用/禁用 */
  const applyConfig = useCallback(
    (config: WakeWordConfig) => {
      configRef.current = config;
      const shouldEnable = config.enabled;

      if (shouldEnable && stateRef.current === 'idle') {
        enable();
      } else if (!shouldEnable && stateRef.current !== 'idle') {
        disable();
      }
    },
    [enable, disable],
  );

  // 初始化：加载配置 + 检查模型
  useEffect(() => {
    (async () => {
      const config = readWakeWordConfig();
      configRef.current = config;

      const hasModel = await VoskEngine.checkModel();
      setModelReady(hasModel);

      // 如果配置中已启用且有模型，自动启动
      if (config.enabled && hasModel) {
        enable();
      } else if (config.enabled && !hasModel) {
        // 模型未下载但配置启用了，标记为错误状态
        updateState('error');
      }
    })().catch((err) => {
      log.error('Wake word init failed', { err });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 监听配置变化（来自设置页的跨窗口 storage 事件）
  useEffect(() => {
    const listener = (e: StorageEvent) => {
      if (e.key !== CONFIG_KEY || !e.newValue) return;
      try {
        const config = JSON.parse(e.newValue) as WakeWordConfig;
        log.info('Config changed from settings', { config });
        applyConfig(config);
      } catch (err) {
        log.warn('Failed to parse config change', { err });
      }
    };
    window.addEventListener('storage', listener);
    return () => window.removeEventListener('storage', listener);
  }, [applyConfig]);

  // 组件卸载时清理
  useEffect(() => {
    return () => {
      if (engineRef.current) {
        engineRef.current.terminate();
        engineRef.current = null;
      }
    };
  }, []);

  return {
    state,
    modelReady,
    enable,
    disable,
    downloadModel,
  };
}
