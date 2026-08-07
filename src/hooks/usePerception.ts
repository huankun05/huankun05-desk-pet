import { useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { perceptionService } from '../services/perception';
import { perceptionFallback, PerceptionFallback } from '../services/perception/fallback';
import { findMapping } from '../services/perception/gestureMapping';
import type { HandData, FaceData } from '../services/perception';
import { setExpression, triggerTapMotion, setFocusFromCss } from '../lib/live2d';
import { isTauriEnv } from '../utils/tauriEnv';
import { eventBus } from '../services/eventBus';
import { createLogger } from '../utils/logger';

const log = createLogger('Perception');

export interface UsePerceptionOptions {
  modelConfig: {
    windowWidth: number;
    windowHeight: number;
  };
  modelInfo: { canvasWidth: number; canvasHeight: number } | null;
  currentEmotion: string;
  getLive2DEmotion: (emotion: string) => string;
}

export function usePerception({
  modelConfig,
  modelInfo,
  currentEmotion,
  getLive2DEmotion,
}: UsePerceptionOptions): void {
  const perceptionSettingsRef = useRef({
    perceptionEnabled: false,
    handTrackingEnabled: true,
    faceTrackingEnabled: true,
  });
  // 用 ref 持有频繁变化的情绪依赖，避免 WebSocket 因情绪更新反复断连重连
  const emotionRef = useRef({ currentEmotion, getLive2DEmotion });
  // 表情恢复定时器引用，防止泄漏
  const expressionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    emotionRef.current = { currentEmotion, getLive2DEmotion };
  });

  useEffect(() => {
    const gestureCooldown = new Map<string, number>();
    const COOLDOWN_MS = 2000;

    const handleHandData = (hands: HandData[]) => {
      if (!perceptionSettingsRef.current.handTrackingEnabled) return;
      if (hands.length === 0) return;

      const hand = hands[0];
      const gesture = hand.gesture;
      if (!gesture || gesture === 'None') return;

      const now = Date.now();
      const lastTrigger = gestureCooldown.get(gesture);
      if (lastTrigger && now - lastTrigger < COOLDOWN_MS) return;

      const mapping = findMapping(gesture);
      if (mapping) {
        log.info(`Gesture detected: ${gesture} → ${mapping.expression || '(no expression)'}`);
        gestureCooldown.set(gesture, now);

        // 发射感知事件到 eventBus，驱动情感/行为系统
        eventBus.emit('perception:gesture', {
          gesture,
          confidence: 1,
          handX: hand.fingertip?.x,
          handY: hand.fingertip?.y,
        });

        if (mapping.expression) {
          setExpression(mapping.expression);
          if (mapping.expressionDuration) {
            const { currentEmotion: ce, getLive2DEmotion: gle } = emotionRef.current;
            const restoreExpression = gle(ce);
            if (expressionTimerRef.current) clearTimeout(expressionTimerRef.current);
            expressionTimerRef.current = setTimeout(() => {
              setExpression(restoreExpression);
              expressionTimerRef.current = null;
            }, mapping.expressionDuration * 1000);
          }
        }

        if (mapping.motion) {
          triggerTapMotion();
        }

        if (mapping.gazeTarget === 'hand' && hand.fingertip) {
          const x = hand.fingertip.x * (modelConfig.windowWidth || 300);
          const y = hand.fingertip.y * (modelConfig.windowHeight || 500);
          setFocusFromCss(x, y);
        }
      }
    };

    const handleFaceData = (face: FaceData | null) => {
      if (!perceptionSettingsRef.current.faceTrackingEnabled) return;
      if (!face || !face.detected) return;

      // 发射面部表情事件到 eventBus
      if (face.expression && face.expression !== 'neutral') {
        eventBus.emit('perception:face_expr', {
          expression: face.expression,
          intensity: Math.max(face.mouth_smile ?? 0, face.mouth_open ?? 0, 0),
        });
      }

      if (isTauriEnv() && modelInfo) {
        const centerX = modelInfo.canvasWidth / 2;
        const centerY = modelInfo.canvasHeight / 2;

        const gazeX = centerX + face.gaze.x * 50;
        const gazeY = centerY + face.gaze.y * 50;

        setFocusFromCss(gazeX, gazeY);
      }

      if (face.expression === 'happy' && face.mouth_smile > 0.5) {
        setExpression('Happy');
      } else if (face.expression === 'surprised' && face.mouth_open > 0.3) {
        setExpression('StarEye');
      }
    };

    const handUnsub = perceptionService.subscribeHandData(handleHandData);
    const faceUnsub = perceptionService.subscribeFaceData(handleFaceData);

    // 感知降级：Python 后端未连接时启用前端降级（鼠标跟随），让「宠物看着你」无后端也可用
    const fallbackMode = PerceptionFallback.readConfiguredMode();
    const updateFallback = (connected: boolean) => {
      perceptionFallback.setMode(connected ? 'off' : fallbackMode);
    };
    updateFallback(perceptionService.getState().isConnected);
    const fallbackUnsub = perceptionService.subscribeState((s) => updateFallback(s.isConnected));

    if (perceptionSettingsRef.current.perceptionEnabled) {
      perceptionService.connect();
    }

    return () => {
      handUnsub();
      faceUnsub();
      fallbackUnsub();
      perceptionService.disconnect();
      perceptionFallback.stop();
      if (expressionTimerRef.current) {
        clearTimeout(expressionTimerRef.current);
        expressionTimerRef.current = null;
      }
    };
  }, [
    modelConfig.windowWidth,
    modelConfig.windowHeight,
    modelInfo,
    // currentEmotion / getLive2DEmotion 通过 emotionRef 读取，不参与依赖
  ]);

  useEffect(() => {
    const loadPerceptionProvider = async () => {
      try {
        if (isTauriEnv()) {
          const raw = await invoke<string>('load_data', { key: 'providers' });
          if (raw) {
            const p = JSON.parse(raw);
            const activeId = p.activePerceptionId;
            if (activeId) {
              const config = p.configs?.find((c: { id: string }) => c.id === activeId);
              if (config?.enable !== false) {
                perceptionSettingsRef.current.perceptionEnabled = true;
                perceptionService.connect();
              }
            }
          }
        } else {
          try {
            const raw = localStorage.getItem('deskpet_providers');
            if (raw) {
              const p = JSON.parse(raw);
              const activeId = p.activePerceptionId;
              if (activeId) {
                const config = p.configs?.find((c: { id: string }) => c.id === activeId);
                if (config?.enable !== false) {
                  perceptionSettingsRef.current.perceptionEnabled = true;
                  perceptionService.connect();
                }
              }
            }
          } catch {
            /* ignore */
          }
        }
      } catch {
        /* ignore */
      }
    };
    loadPerceptionProvider();
  }, []);
}
