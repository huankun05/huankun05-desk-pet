import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { isTauriEnv } from '../utils/tauriEnv';
import { createLogger } from '../utils/logger';
import { fetchWithTimeout } from '../utils/fetch';
import type { ModelConfig } from '../components/Pet/ModelConfig';

const log = createLogger('PetModel');

const PARAMS_KEY = 'desk-pet-model-params';
const CURRENT_MODEL_KEY = 'desk-pet-current-model';
const MODEL_CONFIG_CACHE_KEY = 'desk-pet-model-config-cache';

interface ModelParams {
  scale: number;
  feetOffset: number;
  bubbleHeight: number;
  modelWidthRatio: number;
  idleTimeout: number;
  mouseSensitivity: number;
}

const DEFAULT_PARAMS: ModelParams = {
  scale: 1.0,
  feetOffset: 0,
  bubbleHeight: 70,
  modelWidthRatio: 1.0,
  idleTimeout: 5,
  mouseSensitivity: 1.0,
};

const DEFAULT_MODEL_ID = 'nahida';
const DEFAULT_MODEL: ModelInfo = {
  id: DEFAULT_MODEL_ID,
  name: '纳西妲',
  model3Json: '/models/nahida/Nahida_1080.model3.json',
  configJson: '/models/nahida/config.json',
  icon: '/models/nahida/icon.jpg',
};

function loadModelParams(): ModelParams {
  try {
    const raw = localStorage.getItem(PARAMS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<ModelParams>;
      return { ...DEFAULT_PARAMS, ...parsed };
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_PARAMS;
}

function loadCachedModelConfig(): ModelConfig | null {
  try {
    const raw = localStorage.getItem(MODEL_CONFIG_CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<ModelConfig>;
      if (parsed.windowWidth) {
        return {
          windowWidth: parsed.windowWidth,
          windowHeight: parsed.windowHeight ?? 500,
          canvasWidth: parsed.canvasWidth ?? 550,
          canvasHeight: parsed.canvasHeight ?? 750,
          chatExtraHeight: parsed.chatExtraHeight ?? 350,
          feetOffset: parsed.feetOffset ?? 0,
          headYRatio: parsed.headYRatio ?? 0.35,
          bubbleHeight: parsed.bubbleHeight ?? 70,
          modelWidthRatio: parsed.modelWidthRatio ?? 1.0,
          scale: parsed.scale ?? 1.0,
          idleTimeout: parsed.idleTimeout ?? 5,
          mouseSensitivity: parsed.mouseSensitivity ?? 1.0,
        } satisfies ModelConfig;
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

export interface ModelInfo {
  id: string;
  name: string;
  model3Json: string;
  configJson: string;
  icon: string;
}

export interface PetModelState {
  availableModels: ModelInfo[];
  currentModelId: string;
  currentModelPath: string;
  modelConfig: ModelConfig;
  modelInfo: { canvasWidth: number; canvasHeight: number } | null;
  switchModel: (id: string) => void;
  handleModelLoaded: (info: { canvasWidth: number; canvasHeight: number }) => void;
}

export function usePetModel(): PetModelState {
  const [availableModels, setAvailableModels] = useState<ModelInfo[]>([DEFAULT_MODEL]);
  const [currentModelId, setCurrentModelId] = useState<string>(() => {
    try {
      return localStorage.getItem(CURRENT_MODEL_KEY) || DEFAULT_MODEL_ID;
    } catch (e) {
      console.warn('[PetModel] failed to read current model id:', e);
      return DEFAULT_MODEL_ID;
    }
  });
  const [modelConfig, setModelConfig] = useState<ModelConfig>(() => {
    const cached = loadCachedModelConfig();
    if (cached) {
      const params = loadModelParams();
      return {
        ...cached,
        scale: params.scale,
        idleTimeout: params.idleTimeout,
        mouseSensitivity: params.mouseSensitivity,
      };
    }
    const params = loadModelParams();
    return {
      windowWidth: 280,
      windowHeight: 500,
      canvasWidth: 550,
      canvasHeight: 700,
      chatExtraHeight: 350,
      feetOffset: 0,
      headYRatio: 0.35,
      bubbleHeight: 70,
      modelWidthRatio: 1.0,
      scale: params.scale,
      idleTimeout: params.idleTimeout,
      mouseSensitivity: params.mouseSensitivity,
    };
  });
  const [modelInfo, setModelInfo] = useState<{ canvasWidth: number; canvasHeight: number } | null>(
    null,
  );
  const initializedRef = useRef(false);

  const currentModelPath = useMemo(() => {
    const m = availableModels.find((m) => m.id === currentModelId);
    return m?.model3Json || DEFAULT_MODEL.model3Json;
  }, [availableModels, currentModelId]);

  const switchModel = useCallback((id: string) => {
    setCurrentModelId(id);
    try {
      localStorage.setItem(CURRENT_MODEL_KEY, id);
    } catch (e) {
      console.warn('[PetModel] failed to persist current model id:', e);
    }
  }, []);

  const handleModelLoaded = useCallback((info: { canvasWidth: number; canvasHeight: number }) => {
    log.info(
      `Model loaded: canvas=${info.canvasWidth.toFixed(2)}x${info.canvasHeight.toFixed(2)}, aspect=${(info.canvasHeight / info.canvasWidth).toFixed(3)}`,
    );
    setModelInfo(info);
  }, []);

  // 启动时快速加载模型列表：只在首帧后空闲时读取，不阻塞模型出场
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    const start = Date.now();
    fetchWithTimeout('/models/index.json', {}, 5000)
      .then((r) => r.json())
      .then((json) => {
        if (json.models && Array.isArray(json.models) && json.models.length > 0) {
          setAvailableModels(json.models);
          log.info(`[PetModel] loaded ${json.models.length} models in ${Date.now() - start}ms`);
        }
      })
      .catch((err) => {
        log.warn('[PetModel] failed to load model index:', err);
      });
  }, []);

  // 模型配置读取：延后到首屏空闲，且优先用缓存配置立即出图
  useEffect(() => {
    if (!currentModelId || availableModels.length === 0) return;

    const model = availableModels.find((m) => m.id === currentModelId) || DEFAULT_MODEL;
    const configUrl = model.configJson;

    const run = async () => {
      // 先检查是否有最新缓存，有则跳过网络
      const cached = loadCachedModelConfig();
      if (cached) {
        setModelConfig((prev) => ({
          ...cached,
          scale: prev.scale,
          idleTimeout: prev.idleTimeout,
          mouseSensitivity: prev.mouseSensitivity,
        }));
      }

      try {
        const r = await fetchWithTimeout(configUrl, {}, 5000);
        const json = await r.json();
        if (json.windowWidth) {
          const params = loadModelParams();
          const cfg = {
            windowWidth: json.windowWidth,
            windowHeight: json.windowHeight,
            canvasWidth: json.canvasWidth || 550,
            canvasHeight: json.canvasHeight || 750,
            chatExtraHeight: json.chatExtraHeight || 350,
            feetOffset: json.feetOffset ?? 0,
            headYRatio: json.headYRatio ?? 0.35,
            bubbleHeight: json.bubbleHeight ?? 120,
            modelWidthRatio: json.modelWidthRatio ?? 1.0,
            scale: params.scale,
            idleTimeout: params.idleTimeout ?? 5,
            mouseSensitivity: params.mouseSensitivity ?? 1.0,
          } satisfies ModelConfig;
          setModelConfig(cfg);
          setModelInfo(null);
          try {
            localStorage.setItem(MODEL_CONFIG_CACHE_KEY, JSON.stringify(json));
            if (isTauriEnv()) {
              invoke('save_data', { key: 'model-config', data: JSON.stringify(json) }).catch(
                () => {},
              );
            }
          } catch {
            /* ignore */
          }
        }
      } catch {
        // 网络失败时保留缓存/默认配置，不阻塞
      }
    };

    const timer = setTimeout(run, 0);
    return () => clearTimeout(timer);
  }, [currentModelId, availableModels]);

  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === CURRENT_MODEL_KEY && e.newValue && e.newValue !== currentModelId) {
        setCurrentModelId(e.newValue);
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [currentModelId]);

  useEffect(() => {
    const handleParamsStorage = (e: StorageEvent) => {
      if (e.key === PARAMS_KEY && e.newValue) {
        try {
          const params = JSON.parse(e.newValue);
          setModelConfig((prev) => ({
            ...prev,
            feetOffset: params.feetOffset ?? prev.feetOffset,
            bubbleHeight: params.bubbleHeight ?? prev.bubbleHeight,
            modelWidthRatio: params.modelWidthRatio ?? prev.modelWidthRatio,
            scale: params.scale ?? prev.scale,
            idleTimeout: params.idleTimeout ?? prev.idleTimeout,
            mouseSensitivity: params.mouseSensitivity ?? prev.mouseSensitivity,
          }));
        } catch {
          /* ignore */
        }
      }
    };
    window.addEventListener('storage', handleParamsStorage);
    return () => window.removeEventListener('storage', handleParamsStorage);
  }, []);

  return {
    availableModels,
    currentModelId,
    currentModelPath,
    modelConfig,
    modelInfo,
    switchModel,
    handleModelLoaded,
  };
}
