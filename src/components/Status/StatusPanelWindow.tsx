import { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { StatusPanel } from './StatusPanel';
import type {
  EmotionState,
  EmotionHistoryEntry,
  Personality,
  EmotionConfig,
} from '../../hooks/useEmotion';

// ===== 状态面板独立窗口 =====
function StatusPanelWindow() {
  const [state, setState] = useState<EmotionState>(() => {
    try {
      const raw = localStorage.getItem('deskpet_emotion');
      if (raw) {
        const p = JSON.parse(raw);
        return {
          mood: p.mood || 'cheerful',
          moodIntensity: p.moodIntensity ?? 0.7,
          emotion: p.emotion || 'happy',
          emotionIntensity: p.emotionIntensity ?? 0.8,
          favorability: p.favorability ?? 50,
          personality: {
            cheerfulness: 0.7,
            sensitivity: 0.6,
            sociability: 0.8,
            energy: 0.7,
            ...p.personality,
          },
          config: {
            decayInterval: 120000,
            decayMood: 0.01,
            decayEmotion: 0.03,
            idleDecayStart: 900000,
            cooldownMs: 3000,
            cooldownFactor: 0.3,
            maxIntensityPerAction: 0.9,
            favPatHead: 3,
            favTapBody: 1,
            favStepFoot: -5,
            favTalk: 2,
            favTooMuch: -2,
            ...p.config,
          },
          lastChange: p.lastChange ? new Date(p.lastChange) : new Date(),
          reason: p.reason || '',
        };
      }
    } catch {
      /* 忽略 */
    }
    return {
      mood: 'cheerful',
      moodIntensity: 0.7,
      emotion: 'happy',
      emotionIntensity: 0.8,
      favorability: 50,
      personality: { cheerfulness: 0.7, sensitivity: 0.6, sociability: 0.8, energy: 0.7 },
      config: {
        decayInterval: 120000,
        decayMood: 0.01,
        decayEmotion: 0.03,
        idleDecayStart: 900000,
        cooldownMs: 3000,
        cooldownFactor: 0.3,
        maxIntensityPerAction: 0.9,
        favPatHead: 3,
        favTapBody: 1,
        favStepFoot: -5,
        favTalk: 2,
        favTooMuch: -2,
      },
      lastChange: new Date(),
      reason: '',
    };
  });
  const [history, setHistory] = useState<EmotionHistoryEntry[]>(() => {
    try {
      const raw = localStorage.getItem('deskpet_emotionHistory');
      if (raw) return JSON.parse(raw);
    } catch {
      /* 忽略 */
    }
    return [];
  });

  // 轮询同步主窗口数据（2 秒间隔）
  const pollRef = useRef<ReturnType<typeof setInterval>>(undefined);
  useEffect(() => {
    pollRef.current = setInterval(() => {
      try {
        const raw = localStorage.getItem('deskpet_emotion');
        if (raw) {
          const p = JSON.parse(raw);
          setState((prev: EmotionState) => {
            // 字段级浅比较，避免 JSON.stringify 全量序列化
            if (
              p.mood === prev.mood &&
              p.moodIntensity === prev.moodIntensity &&
              p.emotion === prev.emotion &&
              p.emotionIntensity === prev.emotionIntensity &&
              p.favorability === prev.favorability &&
              p.personality?.cheerfulness === prev.personality?.cheerfulness &&
              p.personality?.sensitivity === prev.personality?.sensitivity &&
              p.personality?.sociability === prev.personality?.sociability &&
              p.personality?.energy === prev.personality?.energy
            )
              return prev;
            return {
              mood: p.mood || 'cheerful',
              moodIntensity: p.moodIntensity ?? 0.7,
              emotion: p.emotion || 'happy',
              emotionIntensity: p.emotionIntensity ?? 0.8,
              favorability: p.favorability ?? 50,
              personality: {
                cheerfulness: 0.7,
                sensitivity: 0.6,
                sociability: 0.8,
                energy: 0.7,
                ...p.personality,
              },
              config: {
                decayInterval: 120000,
                decayMood: 0.01,
                decayEmotion: 0.03,
                idleDecayStart: 900000,
                cooldownMs: 3000,
                cooldownFactor: 0.3,
                maxIntensityPerAction: 0.9,
                favPatHead: 3,
                favTapBody: 1,
                favStepFoot: -5,
                favTalk: 2,
                favTooMuch: -2,
                ...p.config,
              },
              lastChange: p.lastChange ? new Date(p.lastChange) : new Date(),
              reason: p.reason || '',
            };
          });
        }
        const rawH = localStorage.getItem('deskpet_emotionHistory');
        if (rawH) setHistory(JSON.parse(rawH));
      } catch {
        // 静默失败，不影响渲染
      }
    }, 2000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // 窗口尺寸+位置持久化（Tauri API 监听拖拽/缩放）
  useEffect(() => {
    let saveTimer: ReturnType<typeof setTimeout>;
    const dpr = window.devicePixelRatio || 1;
    const saveGeometry = (partial?: { w?: number; h?: number; x?: number; y?: number }) => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        try {
          const prev = JSON.parse(localStorage.getItem('deskpet_status_geometry') || '{}');
          const next = { ...prev, ...partial };
          localStorage.setItem('deskpet_status_geometry', JSON.stringify(next));
          invoke('save_data', { key: 'status_panel_size', data: JSON.stringify(next) }).catch(
            (err) => console.warn('[StatusPanel] save_data failed', err),
          );
        } catch {
          /* 忽略 */
        }
      }, 300);
    };
    // Tauri 事件：onMoved 返回物理像素，÷dpr 转逻辑像素存储
    import('@tauri-apps/api/window')
      .then(({ getCurrentWindow }) => {
        const win = getCurrentWindow();
        win.onMoved((e) => saveGeometry({ x: e.payload.x / dpr, y: e.payload.y / dpr }));
        win.onResized((e) => saveGeometry({ w: e.payload.width / dpr, h: e.payload.height / dpr }));
      })
      .catch(() => {});
    // 初始保存
    saveGeometry();
    return () => {
      clearTimeout(saveTimer);
    };
  }, []);

  const handlePersonalityChange = useCallback((p: Partial<Personality>) => {
    setState((prev: EmotionState) => {
      const next = { ...prev, personality: { ...prev.personality, ...p } };
      localStorage.setItem('deskpet_emotion', JSON.stringify(next));
      return next;
    });
  }, []);

  const handleConfigChange = useCallback((c: Partial<EmotionConfig>) => {
    setState((prev: EmotionState) => {
      const next = { ...prev, config: { ...prev.config, ...c } };
      localStorage.setItem('deskpet_emotion', JSON.stringify(next));
      return next;
    });
  }, []);

  useEffect(() => {
    const h = () => {
      try {
        invoke('save_data', {
          key: 'window_size',
          data: JSON.stringify({ w: window.outerWidth, h: window.outerHeight }),
        }).catch((err) => console.warn('[StatusPanel] save_data failed', err));
      } catch {
        /* 忽略 */
      }
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, []);

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        backgroundColor: 'rgba(15,15,25,1)',
        overflow: 'auto',
      }}
    >
      <StatusPanel
        state={state}
        history={history}
        onPersonalityChange={handlePersonalityChange}
        onConfigChange={handleConfigChange}
        onClose={() => {
          document.body.style.opacity = '0';
          import('@tauri-apps/api/window')
            .then(({ getCurrentWindow }) => getCurrentWindow().close())
            .catch(() => (document.body.style.opacity = '1'));
        }}
        standalone
      />
    </div>
  );
}

export default StatusPanelWindow;
