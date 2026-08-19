import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { StatusPanel } from './StatusPanel';
import type {
  EmotionState,
  EmotionHistoryEntry,
  Personality,
  EmotionConfig,
} from '../../hooks/useEmotion';
import { isTauriEnv } from '../../utils/tauriEnv';
import {
  EMOTION_CHANGED_EVENT,
  normalizeEmotionState,
  readEmotionSnapshot,
  readEmotionHistory,
} from '../../services/emotionSync';

// ===== 状态面板独立窗口 =====
function StatusPanelWindow() {
  const [state, setState] = useState<EmotionState>(
    () => readEmotionSnapshot() ?? normalizeEmotionState({}),
  );
  const [history, setHistory] = useState<EmotionHistoryEntry[]>(() => readEmotionHistory());

  // 跨窗同步：优先监听主窗 Tauri 事件（实时推送），保留 30s 低频兜底轮询防事件失效
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    if (isTauriEnv()) {
      listen<Record<string, unknown>>(EMOTION_CHANGED_EVENT, (e) => {
        setState(normalizeEmotionState(e.payload));
        setHistory(readEmotionHistory());
      })
        .then((fn) => {
          unlisten = fn;
        })
        .catch(() => {});
    }

    const fallbackTimer = setInterval(() => {
      try {
        const snap = readEmotionSnapshot();
        if (snap) {
          setState((prev: EmotionState) => {
            // 字段级浅比较，避免 JSON.stringify 全量序列化
            if (
              snap.mood === prev.mood &&
              snap.moodIntensity === prev.moodIntensity &&
              snap.emotion === prev.emotion &&
              snap.emotionIntensity === prev.emotionIntensity &&
              snap.favorability === prev.favorability &&
              snap.personality?.cheerfulness === prev.personality?.cheerfulness &&
              snap.personality?.sensitivity === prev.personality?.sensitivity &&
              snap.personality?.sociability === prev.personality?.sociability &&
              snap.personality?.energy === prev.personality?.energy
            )
              return prev;
            return snap;
          });
          setHistory(readEmotionHistory());
        }
      } catch {
        // 静默失败，不影响渲染
      }
    }, 30000);

    return () => {
      clearInterval(fallbackTimer);
      if (unlisten) unlisten();
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
