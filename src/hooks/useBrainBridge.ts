import { useEffect } from 'react';
import { eventBus } from '../services/eventBus';
import {
  appendSessionMessage,
  postEmotionBridgeEvent,
  getEmotionBridgeState,
} from '../services/coreApi';
import { isTauriEnv } from '../utils/tauriEnv';

/** 情绪 → 表情轮询间隔（ms）—— 修改此处或服务端 config 均可调整 */
const EMOTION_POLL_MS = 30_000;

/**
 * useBrainBridge — 身体 ↔ 大脑 双向桥接（Phase 3 + 情绪绑定方案 A）
 *
 * 身体 → 大脑：
 * - 对话消息写入主会话 desk-pet-main
 * - 感知/交互事件同时写入 brain-events 会话 + 通过 emotion bridge
 *   更新汐月九维情绪（映射表在服务端 emotion_bridge_config.json）
 *
 * 大脑 → 身体：
 * - 定时拉取九维情绪 → 映射 PAD → 发射 expression:change 事件，
 *   Live2D 表情跟随汐月心情（expression_scale 控制流露强度）
 *
 * Core API 未启动时静默降级，不影响主流程。
 */
export function useBrainBridge() {
  useEffect(() => {
    if (!isTauriEnv()) return;

    const unsubs: Array<() => void> = [];

    // ---- 身体 → 大脑：对话写入主会话 ----
    unsubs.push(
      eventBus.on('message:sent', (p) => {
        void appendSessionMessage('desk-pet-main', 'user', p.text).catch(() => {});
      }),
      eventBus.on('message:response', (p) => {
        void appendSessionMessage('desk-pet-main', 'assistant', p.text).catch(() => {});
      }),
    );

    // ---- 身体 → 大脑：感知/交互事件 → 情绪 + 会话存档 ----
    const recordPerception = (text: string) => {
      void appendSessionMessage('brain-events', 'system', text).catch(() => {});
    };
    unsubs.push(
      eventBus.on('perception:gesture', (p) => {
        recordPerception(`[gesture] ${p.gesture} (conf ${Math.round(p.confidence * 100)}%)`);
        void postEmotionBridgeEvent('perception:gesture', p.gesture).catch(() => {});
      }),
      eventBus.on('perception:face_expr', (p) => {
        recordPerception(`[face] ${p.expression} (intensity ${Math.round(p.intensity * 100)}%)`);
        void postEmotionBridgeEvent('perception:face_expr', p.expression).catch(() => {});
      }),
      eventBus.on('interaction:pat', (p) => {
        recordPerception(`[interaction] pat ${p.target} x${p.count}`);
        void postEmotionBridgeEvent('interaction:pat').catch(() => {});
      }),
      eventBus.on('interaction:tap', (p) => {
        recordPerception(
          `[interaction] tap ${p.target} (intensity ${Math.round(p.intensity * 100)}%)`,
        );
        void postEmotionBridgeEvent('interaction:tap').catch(() => {});
      }),
      eventBus.on('interaction:step', (p) => {
        recordPerception(`[interaction] step ${p.target}`);
        void postEmotionBridgeEvent('interaction:step').catch(() => {});
      }),
    );

    // ---- 大脑 → 身体：定时拉取九维 → 表情事件 ----
    let stopped = false;
    let lastMood = '';
    const pollEmotion = async () => {
      try {
        const s = await getEmotionBridgeState();
        if (stopped || !s || !s.mood_label) return;
        // 情绪变化时才发射（避免无意义刷新）
        if (s.mood_label !== lastMood) {
          lastMood = s.mood_label;
          const intensity = Math.min(
            1,
            Math.max(0.1, (Math.abs(s.pad.pleasure) + Math.abs(s.pad.arousal)) / 2),
          );
          eventBus.emit('expression:change', {
            expression: s.mood_label,
            emotion: s.mood_label,
            intensity: intensity * (s.expression_scale ?? 0.6),
          });
        }
      } catch {
        // Core API 未启动：静默降级
      }
    };
    void pollEmotion();
    const timer = setInterval(pollEmotion, EMOTION_POLL_MS);
    unsubs.push(() => {
      stopped = true;
      clearInterval(timer);
    });

    return () => {
      for (const off of unsubs) off();
    };
  }, []);
}
