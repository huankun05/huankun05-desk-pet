import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { listen } from '@tauri-apps/api/event';
import i18n from './i18n';
import { Live2DViewer } from './components/Pet/Live2DViewer';
import { ControlsIsland, type ControlsIslandHandle } from './components/Pet/ControlsIsland';
import { ChatBubble } from './components/Bubble/ChatBubble';

import { useInteraction } from './hooks/useInteraction';
import { useStorageEvent, useStorageEvents } from './hooks/useStorageEvent';
import { useEmotion, DEFAULT_PERSONALITY, type EmotionState } from './hooks/useEmotion';
import { useWindowManager } from './hooks/useWindowManager';
import { useMode } from './hooks/useMode';
import { useHermesGateway } from './hooks/useHermesGateway';
import { useRagPersistence } from './hooks/useRagPersistence';
import { useVoiceInteraction } from './hooks/useVoiceInteraction';
import { usePetModel } from './hooks/usePetModel';
import { usePanelWindows } from './hooks/usePanelWindows';
import { usePerception } from './hooks/usePerception';
import { usePluginSystem } from './hooks/usePluginSystem';
import { useGlobalShortcuts } from './hooks/useGlobalShortcuts';
import { useWatchTogether } from './hooks/useWatchTogether';
import { useVoiceAssistant } from './hooks/useVoiceAssistant';
import { useWakeWord } from './hooks/useWakeWord';
import { useAppStorageSync } from './hooks/useAppStorageSync';
import {
  APPEARANCE_KEYS,
  DEFAULT_APPEARANCE,
  readAppearance,
  writeAppearanceConfig,
  bubbleThemeColors,
  isSystemDark,
  type AppearanceConfig,
} from './settings/appearanceConfig';

import { aiService } from './services/ai';
import { createStorage } from './services/storage';
import { settingsStorage } from './services/storage/settingsStorage';
import { safetyChecker } from './services/safety';
import { registerBuiltinTools } from './services/tools/builtins';
import { eventBus } from './services/eventBus';
import { useBrainBridge } from './hooks/useBrainBridge';
import { proactiveScheduler, type ProactiveTrigger } from './services/proactive/scheduler';
import { cronJobManager } from './services/cron/manager';
import { isTauriEnv } from './utils/tauriEnv';
import { showToast } from './utils/toast';
import { setLogLevel as setGlobalLogLevel } from './utils/logger';
import { startWatchdog, registerService } from './services/provider/watchdog';
import { IDLE_THRESHOLDS } from './services/idle/constants';
import { getBehaviorRegistry, PetContextImpl, EventType } from './services/behavior';
import { useStartupQueue } from './hooks/useStartupQueue';
import { useSplashInit } from './hooks/useSplashInit';
import { useAutoBackup } from './hooks/useAutoBackup';
import './services/behavior/builtins'; // side-effect: 自动注册 5 个内置行为
import type { PetContextDependencies } from './services/behavior';
import './App.css';

const emotionStorage = createStorage(
  'emotion',
  {
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
  },
  { location: 'project', subdir: 'memory' },
);

if (typeof document !== 'undefined') {
  const isPanel = typeof window !== 'undefined' && window.location.search.includes('panel=');
  if (!isPanel) {
    document.body.style.backgroundColor = 'transparent';
  }
  document.body.style.margin = '0';
  document.body.style.overflow = 'hidden';
  // --fade-opacity 由 App 内 appearance.fadeOpacity 驱动，无需在此预读
}

function MainPetApp() {
  // Phase 3: 身体 → 大脑 事件桥接（对话/感知写入 hermes_state.db）
  useBrainBridge();

  // 持久化设置是否就绪（初始化完成后才启动 watchdog，避免用默认值覆盖用户偏好）
  const [settingsReady, setSettingsReady] = useState(false);
  // 服务监控开关：初值来自持久化偏好，运行中由设置窗事件实时同步
  const [watchdogOn, setWatchdogOn] = useState(true);

  // Service Watchdog: monitor Core API + Perception（受 watchdogEnabled 持久偏好控制）
  useEffect(() => {
    if (!isTauriEnv() || !settingsReady || !watchdogOn) return;
    registerService('core-api', 9877, { maxFailures: 3, cooldownMs: 60_000 });
    registerService('perception', 8765, { maxFailures: 3, cooldownMs: 60_000 });
    return startWatchdog(30_000);
  }, [settingsReady, watchdogOn]);

  // 设置窗口修改「服务监控 / 离线模式」时，实时同步到主窗口实例（两窗 webview 内存独立）
  useEffect(() => {
    if (!isTauriEnv()) return;
    const unlisteners: (() => void)[] = [];
    listen<boolean>('watchdog-toggle', (e) => {
      settingsStorage.set({ watchdogEnabled: e.payload });
      setWatchdogOn(e.payload);
    }).then((u) => unlisteners.push(u));
    listen<boolean>('offline-toggle', (e) => {
      settingsStorage.set({ offlineMode: e.payload });
    }).then((u) => unlisteners.push(u));
    return () => unlisteners.forEach((u) => u());
  }, []);

  const controlsIslandRef = useRef<ControlsIslandHandle>(null);
  const emotionCtxRef = useRef<EmotionState | null>(null);
  const bubbleIdRef = useRef(0);

  const [bubble, setBubble] = useState<{ id: number; text: string; duration: number } | null>(null);

  const {
    emotionState,
    setEmotionFromResponse,
    updateFromVoice,
    setTalkingEmotion,
    getLive2DEmotion,
    emotionHistory,
    patHead,
    tapBody,
    stepFoot,
    idleTooLong,
    tooMuchClick,
    setPersonality,
    setConfig,
    applyAdminUpdate,
  } = useEmotion();

  useEffect(() => {
    emotionCtxRef.current = emotionState;
  }, [emotionState]);

  const {
    availableModels,
    currentModelId,
    currentModelPath,
    modelConfig,
    modelInfo,
    switchModel,
    handleModelLoaded,
  } = usePetModel();

  // Splash WebGL 预热：在首屏渲染前提前创建 WebGL 上下文 + 编译基础着色器，
  // 降低 Live2D 首次初始化时的 GPU/驱动冷启动延迟
  useSplashInit();
  useAutoBackup();

  const { add: queue } = useStartupQueue();

  const {
    setPetScale,
    controlsEdge,
    isLocked,
    toggleLock,
    isTransforming,
    toggleTransform,
    fadeOnHover,
    toggleFadeOnHover,
    isHovering,
    setIsHovering,
    zoomFactor,
  } = useWindowManager({
    modelConfig,
    modelInfo,
    controlsIslandRef,
  });

  const { t } = useTranslation();
  const { mode, toggleMode } = useMode();

  const handleToggleMode = useCallback(() => {
    const next = mode === 'chat' ? 'work' : 'chat';
    toggleMode();
    showToast(
      next === 'work'
        ? t('settings.chat.switch_to_work', { defaultValue: '已切换到工作模式' })
        : t('settings.chat.switch_to_chat', { defaultValue: '已切换到聊天模式' }),
      'success',
    );
  }, [mode, toggleMode, t]);

  const showBubble = useCallback((text: string, duration?: number) => {
    const raw = localStorage.getItem(APPEARANCE_KEYS.bubbleDuration);
    const dur = duration ?? (raw ? Number(raw) : DEFAULT_APPEARANCE.bubbleDuration);
    const msg = { id: ++bubbleIdRef.current, text, duration: dur };
    setBubble(msg);
    setTimeout(() => setBubble((prev) => (prev?.id === msg.id ? null : prev)), dur);
  }, []);

  // 本地 RAG 记忆写入（新 Gateway 路径的“写端”）
  const { addToRag } = useRagPersistence();

  // 使用 useMemo 稳定回调引用，避免每次渲染创建新对象导致下游 hook 连锁重渲染
  const hermesOptions = useMemo(
    () => ({
      ttsEnabled: true,
      onToken: () => {},
      onMessageComplete: async (
        userText: string,
        assistantText: string,
        sessionId: string,
        userMessageId?: string,
        assistantMessageId?: string,
      ) => {
        try {
          if (assistantText.trim()) {
            setEmotionFromResponse(assistantText);
            showBubble(assistantText);
          }
          // 新 Gateway 路径此前未落盘记忆：把本轮对话写入本地 RAG（长期记忆 + 结构化抽取）
          if (userMessageId && assistantMessageId && sessionId) {
            await addToRag(userText, assistantText, {
              userMessageId,
              assistantMessageId,
              sessionId,
            });
          }
        } catch {
          // ignore
        }
      },
      onInterrupt: () => {},
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [addToRag],
  );

  const { isStreaming, sendMessage, interruptResponse } = useHermesGateway(hermesOptions);

  useVoiceInteraction({
    isStreaming,
    onInterrupt: interruptResponse,
    onSendMessage: sendMessage,
    onUpdateFromVoice: updateFromVoice,
    onSetTalkingEmotion: setTalkingEmotion,
  });

  const { toggleChatPanel, openSettingsPanel } = usePanelWindows();

  // "一起看"模式：Ctrl+Shift+S 触发
  const { isWatching, toggleWatch } = useWatchTogether({
    showBubble,
    setEmotionFromResponse,
    setTalkingEmotion,
  });

  // 同步"一起看"状态到 localStorage（供设置页指示器读取）
  useEffect(() => {
    try {
      localStorage.setItem('deskpet_watchTogether', String(isWatching));
    } catch {
      /* ignore */
    }
  }, [isWatching]);

  // 语音助手：Ctrl+Space 唤醒
  const {
    state: voiceState,
    wake,
    stopAndRecognize,
    cancel: cancelVoice,
  } = useVoiceAssistant({
    showBubble,
    sendMessage,
    setListeningEmotion: setTalkingEmotion,
    setIdleEmotion: () => setEmotionFromResponse('neutral'),
  });

  // voiceState 的 ref，供 useWakeWord 的稳定回调读取最新值
  // （避免唤醒词检测回调闭包过期导致 isVoiceAssistantActive 失效）
  const voiceStateRef = useRef(voiceState);
  useEffect(() => {
    voiceStateRef.current = voiceState;
  }, [voiceState]);

  // 语音唤醒词"汐月"：检测到后自动触发语音助手
  useWakeWord({
    showBubble,
    onWake: () => wake(),
    isVoiceAssistantActive: () => voiceStateRef.current !== 'idle',
  });

  // 同步语音助手状态到 localStorage（供 UI 指示器读取）
  useEffect(() => {
    try {
      localStorage.setItem('deskpet_voiceAssistant', voiceState);
    } catch {
      /* ignore */
    }
  }, [voiceState]);

  // Esc 键取消语音助手（仅在语音助手活跃时生效，避免与 watchTogether Esc 冲突）
  useEffect(() => {
    if (voiceState === 'idle') return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        cancelVoice();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [voiceState, cancelVoice]);

  // 全局快捷键：语音唤醒 + 一起看模式
  useGlobalShortcuts({
    onVoiceWake: () => {
      // 再次按下 Ctrl+Space：若在聆听则停止识别，否则唤醒
      if (voiceState === 'listening') {
        stopAndRecognize();
      } else if (voiceState === 'idle') {
        wake();
      }
    },
    onScreenshotAnalyze: () => {
      toggleWatch();
    },
  });

  // 监听托盘菜单发出的 open-settings 事件
  useEffect(() => {
    if (!isTauriEnv()) return;
    let unlisten: (() => void) | undefined;
    import('@tauri-apps/api/event').then(({ listen }) => {
      listen('open-settings', () => {
        openSettingsPanel();
      })
        .then((u) => {
          unlisten = u;
        })
        .catch(() => {});
    });
    return () => {
      unlisten?.();
    };
  }, [openSettingsPanel]);

  // 启动时初始化持久化存储，恢复并应用系统设置（语言/窗口置顶/关闭行为/托盘左键）
  useEffect(() => {
    if (!isTauriEnv()) return;
    settingsStorage.init().then(() => {
      const s = settingsStorage.get();
      // 语言
      i18n.changeLanguage(s.lang);
      localStorage.setItem('desk_pet_lang', s.lang);
      // 关闭行为 / 托盘左键同步 Rust
      invoke('set_close_behavior', { behavior: s.closeBehavior }).catch(() => {});
      invoke('set_tray_left_click', { behavior: s.trayLeftClick }).catch(() => {});
      // 角色模型置顶
      invoke('set_always_on_top', { enabled: s.alwaysOnTop }).catch(() => {});
      // 恢复服务监控开关，并标记设置就绪（允许 watchdog 按持久偏好启动）
      setWatchdogOn(s.watchdogEnabled);
      setSettingsReady(true);
    });
  }, []);

  // 启动时应用日志级别（debugMode 优先）
  useEffect(() => {
    const debugMode = localStorage.getItem('desk-pet-debug-mode') === 'true';
    const logLevel =
      (localStorage.getItem('desk-pet-log-level') as 'debug' | 'info' | 'warn' | 'error' | null) ||
      'info';
    setGlobalLogLevel(debugMode ? 'debug' : logLevel);

    // 初始化定时任务管理器（恢复持久化任务）
    cronJobManager.init().catch(() => {});
  }, []);

  // 外观展示类配置（气泡/镜像/显隐/点击反馈/拖拽/FPS/淡出透明度），跨窗口实时同步
  const [appearance, setAppearance] = useState<AppearanceConfig>(() => readAppearance());
  useStorageEvents(
    Object.values(APPEARANCE_KEYS),
    () => {
      setAppearance(readAppearance());
    },
    [],
  );

  // 悬停淡出透明度：由外观配置驱动 CSS 变量，设置窗调整后主窗实时生效
  useEffect(() => {
    document.documentElement.style.setProperty('--fade-opacity', String(appearance.fadeOpacity));
  }, [appearance.fadeOpacity]);

  // 系统深浅色（供气泡「跟随主题」模式使用），跟随系统切换实时更新
  const [systemDark, setSystemDark] = useState<boolean>(() => isSystemDark());
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // 跨窗口 storage 同步：日志级别、定时任务触发
  useAppStorageSync({ showBubble });

  const { handleCanvasClick } = useInteraction({
    onPatHead: patHead,
    onTapBody: tapBody,
    onStepFoot: stepFoot,
    onIdleTooLong: idleTooLong,
    onTooMuchClick: tooMuchClick,
    currentMood: emotionState.mood,
    currentEmotion: emotionState.emotion,
    favorability: emotionState.favorability,
    showBubble,
    personality: emotionState.personality,
  });

  usePerception({
    modelConfig: { windowWidth: modelConfig.windowWidth, windowHeight: modelConfig.windowHeight },
    modelInfo,
    currentEmotion: emotionState.emotion,
    getLive2DEmotion,
  });

  usePluginSystem({
    emotionState,
    applyAdminUpdate,
    handleSendMessage: sendMessage,
    showBubble,
  });

  const handlePetClick = useCallback(
    (adjustedY: number) => {
      if (isLocked || isTransforming) return;
      if (!appearance.clickFeedback) return;
      handleCanvasClick(adjustedY);
    },
    [isLocked, isTransforming, appearance.clickFeedback, handleCanvasClick],
  );

  useEffect(() => {
    registerBuiltinTools();

    // MCP 自动连接涉及网络 I/O，延后到首屏空闲时执行
    queue(2, 'mcp-connect', async () => {
      try {
        const { getMcpServers, connectServer } = await import('./services/mcp/manager');
        const { syncMcpTools } = await import('./services/mcp/bridge');
        const servers = getMcpServers().filter((s) => s.enabled);
        for (const server of servers) {
          try {
            const tools = await connectServer(server);
            syncMcpTools(tools);
            console.info(`[MCP] 已自动连接 "${server.name}"，发现 ${tools.length} 个工具`);
          } catch (err) {
            console.warn(`[MCP] 自动连接 "${server.name}" 失败:`, err);
          }
        }
      } catch (err) {
        console.warn('[MCP] 初始化失败（可能尚未配置）:', err);
      }
    });

    invoke<string>('load_data', { key: 'settings' })
      .then((raw) => {
        if (raw) {
          const settings = JSON.parse(raw);
          if (settings.contentSafety) {
            safetyChecker.reloadConfig(settings.contentSafety);
          }
        }
      })
      .catch((err) => console.warn('[App] loadSettings failed:', err));

    // 从行为配置初始化主动陪伴调度器（与 BehaviorPage 共享 storage key）
    try {
      const behaviorRaw = localStorage.getItem('deskpet_behaviorConfig');
      if (behaviorRaw) {
        const bc = JSON.parse(behaviorRaw);
        if (typeof bc.enableSmartChat === 'boolean') {
          proactiveScheduler.updateConfig({
            enabled: bc.enableSmartChat,
            messageCooldown: (bc.smartChatInterval ?? 60) * 1000,
            dailyLimit: bc.smartChatDailyLimit ?? 20,
          });
        }
      }
    } catch {
      /* ignore */
    }

    proactiveScheduler.onTrigger((trigger: ProactiveTrigger) => {
      const scene = trigger.scene;
      showBubble(`💭 ${scene.label}`, 3000);

      const emotionCtx = emotionCtxRef.current;
      if (!emotionCtx) return;
      aiService
        .generateProactiveMessage(emotionCtx.emotion, emotionCtx.mood)
        .then((text) => {
          if (text) {
            showBubble(text, 6000);
            eventBus.emit('message:response', { text, sessionId: 'proactive' });
          }
        })
        .catch((err) => console.warn('[App] proactive scheduler error:', err));
    });

    // ===== 行为系统：构造 PetContext → initializeAll → 转发 eventBus =====
    queue(3, 'behavior-init', async () => {
      // 如果组件已卸载（竞态保护），直接终止
      if (behaviorDisposedRef.current) return;
      const deps: PetContextDependencies = {
        say: async (text: string) => {
          // 只显示气泡（不直接朗读 TTS，避免 TTS 未配置时报错）
          showBubble(text, 4500);
        },
        showBubble: (text: string, duration?: number) => showBubble(text, duration),
        playAnimation: (name: string) => {
          window.dispatchEvent(new CustomEvent('deskpet:action', { detail: { action: name } }));
        },
        setExpression: (expression: string) => {
          window.dispatchEvent(new CustomEvent('deskpet:expression', { detail: { expression } }));
        },
        getMood: () => emotionCtxRef.current?.mood ?? 'normal',
        getEmotion: () => emotionCtxRef.current?.emotion ?? 'idle',
        getFavorability: () => emotionCtxRef.current?.favorability ?? 0,
        getTimeContext: () => {
          const d = new Date();
          return {
            hour: d.getHours(),
            dayOfWeek: d.getDay(),
            isWeekend: d.getDay() === 0 || d.getDay() === 6,
          };
        },
        getPersonality: () => emotionCtxRef.current?.personality ?? DEFAULT_PERSONALITY,
        setLocked: (locked: boolean) => {
          try {
            localStorage.setItem('deskpet_locked', String(locked));
            window.dispatchEvent(new CustomEvent('deskpet:lockchange', { detail: { locked } }));
          } catch {
            /* ignore */
          }
        },
        sendMessage: async (text: string) => {
          return new Promise<string>((resolve) => {
            const timer = setTimeout(() => resolve(''), 30000);
            const off = eventBus.on('message:response', (payload) => {
              const p = payload as { text: string; sessionId: string };
              if (p.sessionId !== 'proactive') {
                clearTimeout(timer);
                off();
                resolve(p.text);
              }
            });
            try {
              localStorage.setItem('deskpet_chatPending', text);
            } catch {
              clearTimeout(timer);
              off();
              resolve('');
            }
          });
        },
      };

      const petCtx = new PetContextImpl(deps);
      const registry = getBehaviorRegistry();

      // 等待一个微任务让 builtins 自注册完成
      await new Promise<void>((resolve) => queueMicrotask(resolve));

      await registry.initializeAll(petCtx);
      console.info(`[Behavior] 初始化完成，共注册 ${registry.count} 个行为`);

      // 如果组件在初始化期间卸载，直接清理并终止
      if (behaviorDisposedRef.current) {
        registry.terminateAll().catch(() => {});
        return;
      }

      // ===== 转发 eventBus 事件到 BehaviorRegistry =====
      const unsubs: Array<() => void> = [];
      const forward = <T,>(
        evName: Parameters<typeof eventBus.on>[0],
        eventType: EventType,
        mapper?: (p: T) => unknown,
      ) => {
        const off = eventBus.on(evName, (payload) => {
          const p = mapper ? mapper(payload as T) : payload;
          registry.dispatch(eventType, p).catch((err) => {
            console.warn('[Behavior] dispatch error', eventType, String(err));
          });
        });
        unsubs.push(off);
      };
      forward('message:sent', EventType.MESSAGE_SENT);
      forward('message:response', EventType.MESSAGE_RESPONSE);
      forward('emotion:changed', EventType.EMOTION_CHANGED);
      forward('favorability:changed', EventType.FAVORABILITY_CHANGED);
      forward('persona:changed', EventType.PERSONA_CHANGED);
      // 感知事件：用户手势/面部表情
      forward('perception:gesture', EventType.PERCEPTION_GESTURE);
      forward('perception:face_expr', EventType.PERCEPTION_FACE_EXPR);
      // 交互事件：用户点击/触摸
      forward('interaction:pat', EventType.INTERACTION_PAT);
      forward('interaction:tap', EventType.INTERACTION_TAP);
      forward('interaction:step', EventType.INTERACTION_STEP);
      // init 事件（一次性）
      queueMicrotask(() => {
        registry.dispatch(EventType.INIT, {}).catch(() => {});
      });

      // WINDOW_FOCUS / BLUR 监听
      const onFocus = () => registry.dispatch(EventType.WINDOW_FOCUS, {}).catch(() => {});
      const onBlur = () => registry.dispatch(EventType.WINDOW_BLUR, {}).catch(() => {});
      window.addEventListener('focus', onFocus);
      window.addEventListener('blur', onBlur);

      // IDLE 定时器：如果超过 6 分钟没有 activity，则派发 IDLE 事件
      let lastActivityAt = Date.now();
      const resetActivity = () => {
        lastActivityAt = Date.now();
      };
      const idleOffs: Array<() => void> = [
        eventBus.on('message:sent', resetActivity),
        eventBus.on('message:response', resetActivity),
        eventBus.on('persona:changed', resetActivity),
      ];
      window.addEventListener('click', resetActivity, true);
      window.addEventListener('keydown', resetActivity, true);
      const idleTimer = setInterval(() => {
        const ms = Date.now() - lastActivityAt;
        if (ms >= IDLE_THRESHOLDS.medium) {
          registry.dispatch(EventType.IDLE, { idleMs: ms }).catch(() => {});
        }
      }, 60 * 1000); // 每分钟检查一次

      // dispose
      behaviorCleanupRef.current = () => {
        unsubs.forEach((fn) => fn());
        idleOffs.forEach((fn) => fn());
        window.removeEventListener('focus', onFocus);
        window.removeEventListener('blur', onBlur);
        window.removeEventListener('click', resetActivity, true);
        window.removeEventListener('keydown', resetActivity, true);
        clearInterval(idleTimer);
        registry
          .terminateAll()
          .catch((err) => console.warn('[App] behavior terminateAll failed:', err));
      };
    });
  }, [showBubble, queue]);

  // 行为系统 cleanup（由卸载时调用）
  // 注意：behaviorCleanupRef 在上面的 async IIFE 中赋值，
  // 为防止卸载时 IIFE 尚未执行到赋值行，用 disposedRef 标记是否已卸载
  const behaviorCleanupRef = useRef<() => void>(() => {});
  const behaviorDisposedRef = useRef(false);
  useEffect(
    () => () => {
      behaviorDisposedRef.current = true;
      behaviorCleanupRef.current();
    },
    [],
  );

  useEffect(() => {
    try {
      emotionStorage.set(emotionState);
    } catch {
      /* ignore */
    }
  }, [emotionState]);

  useEffect(() => {
    try {
      localStorage.setItem('deskpet_emotionHistory', JSON.stringify(emotionHistory.slice(-15)));
    } catch {
      /* ignore */
    }
  }, [emotionHistory]);

  useStorageEvent(
    'deskpet_emotion',
    (newValue) => {
      if (!newValue) return;
      try {
        const p = JSON.parse(newValue);
        if (p.personality) setPersonality(p.personality);
        if (p.config) setConfig(p.config);
      } catch {
        /* ignore */
      }
    },
    [setPersonality, setConfig],
  );

  const handlePetMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (!isTransforming) return;
      const t = e.target as HTMLElement;
      if (
        ['BUTTON', 'INPUT', 'TEXTAREA'].includes(t.tagName) ||
        t.closest('.toolbar') ||
        t.closest('.context-menu')
      )
        return;
      if (!isTauriEnv()) return;
      if (!appearance.dragEnabled) return;
      try {
        getCurrentWindow().startDragging();
      } catch {
        /* ignore */
      }
    },
    [isTransforming, appearance.dragEnabled],
  );

  const handleClose = useCallback(async () => {
    if (!isTauriEnv()) return;
    try {
      // 读取关闭行为配置：minimize_to_tray 则隐藏到托盘，exit 则真正退出
      const behavior = localStorage.getItem('deskpet_close_behavior') || 'minimize_to_tray';
      if (behavior === 'exit') {
        // 调用 Rust 侧退出（会停止所有服务）
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        await getCurrentWindow().close();
      } else {
        await invoke('hide_to_tray');
      }
    } catch {
      /* ignore */
    }
  }, []);

  const handleToggleLive2D = useCallback(() => {
    const next = !appearance.petVisible;
    setAppearance((a) => ({ ...a, petVisible: next }));
    writeAppearanceConfig({ petVisible: next });
  }, [appearance.petVisible]);

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      if (!isTransforming) return;
      e.preventDefault();
      setPetScale((p) => Math.min(2, Math.max(0.2, p + (e.deltaY > 0 ? -0.05 : 0.05))));
    },
    [isTransforming, setPetScale],
  );

  const baseViewportAspect = useMemo(() => {
    const w = modelConfig.windowWidth;
    const actualCanvasW = modelInfo?.canvasWidth ?? modelConfig.canvasWidth;
    const actualCanvasH = modelInfo?.canvasHeight ?? modelConfig.canvasHeight;
    const modelAspect = actualCanvasH / actualCanvasW;
    const BUBBLE_H = modelConfig.bubbleHeight ?? 30;
    const TOOLBAR_H = 56;
    return w / (BUBBLE_H + Math.round(w * modelAspect) + TOOLBAR_H);
  }, [
    modelConfig.windowWidth,
    modelConfig.bubbleHeight,
    modelConfig.canvasWidth,
    modelConfig.canvasHeight,
    modelInfo?.canvasWidth,
    modelInfo?.canvasHeight,
  ]);

  const bubbleColors = bubbleThemeColors(appearance.bubbleTheme, systemDark);

  return (
    <div
      className={`app-container ${isLocked ? 'locked' : ''}`}
      onWheel={handleWheel}
      style={
        {
          ['--bubble-font-size' as string]: `${appearance.bubbleFontSize}px`,
          ['--bubble-radius' as string]: `${appearance.bubbleRadius}px`,
          ['--bubble-bg' as string]: bubbleColors.bg,
          ['--bubble-color' as string]: bubbleColors.color,
        } as React.CSSProperties
      }
    >
      <div
        className={`bubble-zone ${appearance.bubblePosition === 'bottom' ? 'bubble-zone--bottom' : ''}`}
      >
        <ChatBubble message={bubble} onComplete={() => setBubble(null)} />
      </div>

      <div
        className={`pet-zone ${isLocked ? 'locked' : ''} ${isTransforming ? 'moving' : ''} ${fadeOnHover && isHovering ? 'fading' : ''}`}
        onMouseDown={handlePetMouseDown}
        onMouseEnter={() => !isLocked && setIsHovering(true)}
        onMouseLeave={() => !isLocked && setIsHovering(false)}
        style={{
          transform: appearance.mirror ? 'scaleX(-1)' : undefined,
          // 隐藏时整块区域不再拦截鼠标（2D 已卸载），点击可穿透到下方
          pointerEvents: appearance.petVisible ? 'auto' : 'none',
        }}
      >
        {/* 隐藏角色：直接卸载 Live2D，把 2D 图像从桌面彻底移除（而非仅设 opacity:0 透明留 DOM） */}
        {appearance.petVisible && (
          <div className="pet-model">
            <Live2DViewer
              modelPath={currentModelPath}
              emotion={emotionState.emotion}
              zoomFactor={zoomFactor * (modelConfig.scale ?? 1.0)}
              feetOffset={modelConfig.feetOffset}
              modelWidthRatio={modelConfig.modelWidthRatio ?? 1.0}
              baseViewportAspect={baseViewportAspect}
              modelCanvasW={modelInfo?.canvasWidth ?? 750}
              modelCanvasH={modelInfo?.canvasHeight ?? 1080}
              energy={emotionState.personality.energy}
              expressionMap={emotionState.expressionMap}
              idleExpressions={emotionState.idleExpressions}
              idleTimeout={modelConfig.idleTimeout ?? 5}
              mouseSensitivity={modelConfig.mouseSensitivity ?? 1.0}
              renderPaused={false}
              targetFps={appearance.targetFps}
              adaptiveFps={appearance.adaptiveFps}
              onClickPosition={handlePetClick}
              onModelLoaded={handleModelLoaded}
              headYRatio={modelConfig.headYRatio ?? 0.35}
            />
          </div>
        )}
      </div>

      <ControlsIsland
        ref={controlsIslandRef}
        onSettings={openSettingsPanel}
        onChat={toggleChatPanel}
        onToggleLive2D={handleToggleLive2D}
        onToggleLock={toggleLock}
        onToggleFade={toggleFadeOnHover}
        onToggleTransform={toggleTransform}
        onToggleMode={handleToggleMode}
        onExit={handleClose}
        isTransforming={isTransforming}
        currentMode={mode}
        isLocked={isLocked}
        fadeOnHover={fadeOnHover}
        petVisible={appearance.petVisible}
        availableModels={availableModels}
        currentModelId={currentModelId}
        onSwitchModel={(id) => {
          switchModel(id);
        }}
        edge={controlsEdge}
      />
    </div>
  );
}

export default MainPetApp;
