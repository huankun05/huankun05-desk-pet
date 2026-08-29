import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow, LogicalPosition } from '@tauri-apps/api/window';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';

import { emit, listen } from '@tauri-apps/api/event';
import i18n from './i18n';
import { Live2DViewer } from './components/Pet/Live2DViewer';
import { ChatBubble } from './components/Bubble/ChatBubble';
import { SubtitleNotch } from './components/Pet/SubtitleNotch';
import { StatusIndicators } from './components/Pet/StatusIndicators';
import {
  type ControlsStatePayload,
  type ControlsActionPayload,
} from './components/Pet/ControlsOrb';

import { useInteraction } from './hooks/useInteraction';
import { useStorageEvent, useStorageEvents } from './hooks/useStorageEvent';
import {
  useEmotion,
  DEFAULT_PERSONALITY,
  type EmotionState,
  type EmotionType,
} from './hooks/useEmotion';
import { stripControlTags } from './services/live2d/visualMapping';
import { useWindowManager } from './hooks/useWindowManager';
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

import { aiService, type ChatMessage } from './services/ai';
import { synthesizeViaBrain } from './services/provider/ttsBackend';
import { audioPlayer } from './services/audio/player';
import { loadBehaviorConfig } from './services/behavior/behaviorConfig';
import { createStorage } from './services/storage';
import { settingsStorage } from './services/storage/settingsStorage';
import { safetyChecker } from './services/safety';
import { registerBuiltinTools } from './services/tools/builtins';
import { eventBus } from './services/eventBus';
import { registerGatewayToolExecutor } from './services/tools/executor';
import { getHermesGatewayClient } from './services/hermesGateway';
import ConsentGate from './components/ConsentGate';
import { permissionManager } from './services/permission/PermissionManager';
import { useBrainBridge } from './hooks/useBrainBridge';
import { isPointOverCharacter } from './lib/live2d';
import { triggerAnimation } from './lib/live2d/lappdelegate';
import { proactiveScheduler, type ProactiveTrigger } from './services/proactive/scheduler';
import { getMemoryStats } from './services/coreApi';
import { PROACTIVE_WAKE_PROMPT } from './data/liveModePrompts';
import { cronJobManager } from './services/cron/manager';
import { isTauriEnv } from './utils/tauriEnv';
import { computeOrbDefaultPos, getMainRect } from './utils/orbPosition';
import { setLogLevel as setGlobalLogLevel } from './utils/logger';
import { startWatchdog, registerService } from './services/provider/watchdog';
import { isOfflineModeEnabled } from './services/provider/watchdog';
import { lifecycle } from './services/provider/serviceLifecycle';
import { IDLE_THRESHOLDS } from './services/idle/constants';
import { getBehaviorRegistry, PetContextImpl, EventType } from './services/behavior';
import { useStartupQueue } from './hooks/useStartupQueue';
import { useSplashInit } from './hooks/useSplashInit';
import { useAutoBackup } from './hooks/useAutoBackup';
import './services/behavior/builtins'; // side-effect: 自动注册 5 个内置行为
import type { PetContextDependencies } from './services/behavior';
import { EMOTION_CHANGED_EVENT } from './services/emotionSync';
import { CHAT_EMOTION_EVENT, CHAT_ACTIVE_EVENT } from './services/eventBus';
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

  const emotionCtxRef = useRef<EmotionState | null>(null);
  const bubbleIdRef = useRef(0);

  const [bubble, setBubble] = useState<{ id: number; text: string; duration: number } | null>(null);
  // 2D 模型是否已真正加载完成：未加载前不显示说话气泡（避免无角色本体时气泡悬空）
  const [petModelReady, setPetModelReady] = useState(false);

  const {
    emotionState,
    setEmotionFromResponse,
    setNewEmotion,
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
  });

  const showBubble = useCallback((text: string, duration?: number) => {
    const raw = localStorage.getItem(APPEARANCE_KEYS.bubbleDuration);
    const dur = duration ?? (raw ? Number(raw) : DEFAULT_APPEARANCE.bubbleDuration);
    const msg = { id: ++bubbleIdRef.current, text, duration: dur };
    setBubble(msg);
    setTimeout(() => setBubble((prev) => (prev?.id === msg.id ? null : prev)), dur);
  }, []);

  // 模型真正加载完成：通知 usePetModel 记录尺寸，并解锁说话气泡显示
  const onPetModelLoaded = useCallback(
    (info: { canvasWidth: number; canvasHeight: number }) => {
      handleModelLoaded(info);
      setPetModelReady(true);
    },
    [handleModelLoaded],
  );

  // 本地 RAG 记忆写入（新 Gateway 路径的“写端”）
  const { addToRag } = useRagPersistence();

  // 使用 useMemo 稳定回调引用，避免每次渲染创建新对象导致下游 hook 连锁重渲染
  const hermesOptions = useMemo(
    () => ({
      // 读取与聊天面板窗一致的 TTS 总开关，避免主窗口聊天朗读无法关闭
      ttsEnabled: localStorage.getItem('deskpet_tts_enabled') !== 'false',
      // 说话开始：立即进入 talking 态（说话脸），消除「脸慢半拍」
      onSpeechStart: () => setNewEmotion('talking', 0.6, 'AI 说话中'),
      // 首句情绪判定后即时同步表情（与 TTS 语气同源，由 useHermesGateway 内部判定）
      onSpeechEmotion: (e: EmotionType) => setNewEmotion(e, 0.8, 'AI 说话中'),
      onToken: () => {},
      onMessageComplete: async (
        userText: string,
        assistantText: string,
        sessionId: string,
        userMessageId?: string,
        assistantMessageId?: string,
      ) => {
        try {
          // assistantText 含原始 [emotion:xxx] 标签：情绪解析用原文（显式标签优先），
          // 气泡展示与 RAG 落库用剥离后的文本（避免标签外泄到界面/记忆）
          const clean = stripControlTags(assistantText);
          if (clean.trim()) {
            setEmotionFromResponse(assistantText);
            showBubble(clean);
          }
          // 新 Gateway 路径此前未落盘记忆：把本轮对话写入本地 RAG（长期记忆 + 结构化抽取）
          if (userMessageId && assistantMessageId && sessionId) {
            await addToRag(userText, clean, {
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
    [addToRag, setNewEmotion],
  );

  const { isStreaming, sendMessage, interruptResponse, injectAssistantMessage } =
    useHermesGateway(hermesOptions);

  // 语音自动聆听（VAD）开关：隐私优先，默认关闭；设置页「聊天 → 语音」可开启。
  // 关闭时 FrontendVADService 绝不打开麦克风，语音仅在你按 Ctrl+Space / 唤醒词时启用。
  const [voiceAutoListen, setVoiceAutoListen] = useState(
    () => localStorage.getItem('deskpet_voice_autolisten') === 'true',
  );
  useStorageEvent('deskpet_voice_autolisten', (v) => setVoiceAutoListen(v === 'true'), []);

  // 语音输入模式：手动按键结束（默认开启，避免停顿被静音端点误截断）
  const [voiceManualStop, setVoiceManualStop] = useState(
    () => localStorage.getItem('deskpet_voice_manual_stop') !== 'false',
  );
  useStorageEvent('deskpet_voice_manual_stop', (v) => setVoiceManualStop(v === 'true'), []);

  const { vadIsSpeaking } = useVoiceInteraction({
    isStreaming,
    onInterrupt: interruptResponse,
    // 语音驱动的对话（VAD 自动聆听/按住说话）不落聊天历史，但回复语音照常播放
    onSendMessage: (text: string) => {
      void sendMessage(text, undefined, { noHistory: true });
    },
    onUpdateFromVoice: updateFromVoice,
    onSetTalkingEmotion: setTalkingEmotion,
    autoListen: voiceAutoListen,
  });

  const { toggleChatPanel, openSettingsPanel, openControlsOrb } = usePanelWindows();

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
    // 语音助手（Ctrl+Space / 唤醒词）说的话不落聊天历史，但回复语音照常播放
    sendMessage: (text: string) => sendMessage(text, undefined, { noHistory: true }),
    setListeningEmotion: setTalkingEmotion,
    setIdleEmotion: () => setEmotionFromResponse('neutral'),
    manualStop: voiceManualStop,
  });

  // voiceState 的 ref，供 useWakeWord 的稳定回调读取最新值
  // （避免唤醒词检测回调闭包过期导致 isVoiceAssistantActive 失效）
  const voiceStateRef = useRef(voiceState);
  useEffect(() => {
    voiceStateRef.current = voiceState;
  }, [voiceState]);

  // 唤醒瞬间的视觉反馈：惊喜表情 + 唤醒动作（招手/身体前倾），形成「惊喜→聆听」过渡
  const wakeVisual = useCallback(() => {
    setEmotionFromResponse('surprised');
    triggerAnimation('wake');
  }, [setEmotionFromResponse]);

  // 语音唤醒词"汐月"：检测到后自动触发语音助手
  const { state: wakeState } = useWakeWord({
    showBubble,
    onWake: () => wake(),
    onWakeVisual: wakeVisual,
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

  // ===== 主动闲聊"忙碌"闸 =====
  // 语音助手活跃 / 回复流式 / VAD 检测到语音 / 聊天窗语音通话中 / 聊天面板文字对话中 →
  // 暂停主动消息与静态闲聊，避免"正在对话时突然冒一句"。用 ref 聚合各路来源，统一写入 proactiveScheduler。
  const busySourcesRef = useRef({ voice: false, streaming: false, vad: false, call: false, chat: false });
  const syncBusy = useCallback(() => {
    const s = busySourcesRef.current;
    proactiveScheduler.setBusy(s.voice || s.streaming || s.vad || s.call || s.chat);
  }, []);
  useEffect(() => {
    busySourcesRef.current.voice = voiceState !== 'idle';
    busySourcesRef.current.streaming = isStreaming;
    busySourcesRef.current.vad = vadIsSpeaking;
    syncBusy();
  }, [voiceState, isStreaming, vadIsSpeaking, syncBusy]);
  // 聊天面板窗口的语音通话状态（跨窗广播 'voicecall-active'）
  useEffect(() => {
    if (!isTauriEnv()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    listen<{ active: boolean }>('voicecall-active', (e) => {
      busySourcesRef.current.call = e.payload.active;
      syncBusy();
    })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(() => {
        /* 事件不可用时退化为仅本地 busy 来源 */
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [syncBusy]);
  // 聊天面板窗口的文字对话状态（跨窗广播 'deskpet:chat-active'）：打字/流式期间暂停主动闲聊
  useEffect(() => {
    if (!isTauriEnv()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    listen<{ active: boolean }>(CHAT_ACTIVE_EVENT, (e) => {
      busySourcesRef.current.chat = e.payload.active;
      syncBusy();
    })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(() => {
        /* 事件不可用时退化为仅本地 busy 来源 */
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [syncBusy]);

  // 聊天面板窗口产出的情绪跨窗回传：让主窗宠物表情跟着聊天回复变化
  useEffect(() => {
    if (!isTauriEnv()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    listen<{ emotion: string; intensity: number; reason: string }>(CHAT_EMOTION_EVENT, (e) => {
      setNewEmotion(
        e.payload.emotion as Parameters<typeof setNewEmotion>[0],
        e.payload.intensity,
        e.payload.reason,
      );
    })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(() => {
        /* 事件不可用时忽略 */
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [setNewEmotion]);

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
    onKill: () => {
      // 紧急停止：中断当前语音助手活动
      if (voiceStateRef.current !== 'idle') {
        cancelVoice();
      }
      // 广播中断信号，供工具循环/子 Agent 后续接入（#33）
      eventBus.emit('tool:abort', { reason: 'kill-switch' });
      showBubble('已紧急停止', 1500);
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

  // 服务生命周期大脑：设置就绪后分批拉起所有服务（资源感知调度）
  useEffect(() => {
    if (!settingsReady || !isTauriEnv()) return;
    lifecycle.bootstrapAll().catch((err) => {
      console.warn('[MainPetApp] bootstrapAll 失败:', err);
    });
  }, [settingsReady]);

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

  // 最新 petVisible 快照（供跨窗状态使用）
  const petVisibleRef = useRef(appearance.petVisible);

  // ── 悬浮球：无碰撞，z 序最高、可盖在角色之上（拖拽/吸附/展开逻辑见 ControlsOrb.tsx）──

  // 悬停淡出透明度：由外观配置驱动 CSS 变量，设置窗调整后主窗实时生效
  useEffect(() => {
    document.documentElement.style.setProperty('--fade-opacity', String(appearance.fadeOpacity));
  }, [appearance.fadeOpacity]);

  // 隐藏角色时重置「模型已加载」标记：重新显示会经历一次加载，加载完成前不显示气泡
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!appearance.petVisible) setPetModelReady(false);
    petVisibleRef.current = appearance.petVisible;
  }, [appearance.petVisible]);

  // 角色隐藏 或 模型未就绪 时，立即清掉正在显示的说话气泡，确保与显示状态一致。
  // 锁定态不清除气泡：锁定走窗口级 setIgnoreCursorEvents 实现整窗穿透，气泡会自然
  // 跟随角色一起穿透（可见但不拦截点击），符合「气泡与角色状态一致」的预期。
  useEffect(() => {
    if (!appearance.petVisible || !petModelReady) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setBubble(null);
    }
  }, [appearance.petVisible, petModelReady]);

  // 切换模型时重置：新模型加载完成前不显示气泡
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPetModelReady(false);
  }, [currentModelPath]);

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
    injectAssistantMessage,
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
            // 闲置触发阈值（分钟 → 毫秒）：多久没互动才发主动消息
            longIdleThreshold: (bc.smartChatIdleThreshold ?? 30) * 60 * 1000,
          });
        }
      }
    } catch {
      /* ignore */
    }

    proactiveScheduler.onTrigger(async (trigger: ProactiveTrigger) => {
      if (isOfflineModeEnabled()) {
        showBubble('现在处于离线模式，暂时不能陪你聊天了。', 4000);
        return;
      }

      const emotionCtx = emotionCtxRef.current;
      if (!emotionCtx) return;

      const hints = trigger.hints?.length ? `\n上下文：${trigger.hints.join('；')}` : '';
      let systemPrompt = `${PROACTIVE_WAKE_PROMPT}\n${trigger.scene.promptSuffix}${hints}
当前情绪：${emotionCtx.emotion}，心情：${emotionCtx.mood}。`;

      // 每日状态简报：注入真实本地数据（后端不可用时降级为空壳，不影响发送）
      if (trigger.scene.id === 'daily_brief') {
        try {
          const stats = await getMemoryStats();
          const daily = proactiveScheduler.getDailyStats();
          const trend =
            daily.emotionTrend === 'positive'
              ? '较好'
              : daily.emotionTrend === 'negative'
                ? '偏低落'
                : '平稳';
          systemPrompt += `\n今日数据（仅作参考，不要生硬罗列数字）：今天和主人聊了约 ${daily.turns} 轮；我新记住了 ${stats.today} 件关于你的事，记忆库现在一共 ${stats.total} 条；你近期的情绪${trend}。`;
        } catch {
          /* 后端不可用：保持空壳简报 */
        }
      }

      const messages: ChatMessage[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: '请主动说一句话' },
      ];

      aiService
        .proactiveChat(messages)
        .then((text) => {
          if (!text) return;
          showBubble(text, 6000);
          // #20 主动消息 TTS 朗读开关：开启时把主动消息用语音播报
          if (loadBehaviorConfig().proactiveTts) {
            void synthesizeViaBrain(text)
              .then((res) => {
                if (res?.audio) {
                  audioPlayer.enqueue(res.audio, res.sampleRate, `proactive-${Date.now()}`);
                }
              })
              .catch(() => {
                /* TTS 未就绪/合成失败：静默降级，气泡已展示 */
              });
          }
          const sessionId = (() => {
            try {
              return import('./services/chatStorage').then((m) => m.getActiveSession()?.id ?? null);
            } catch {
              return Promise.resolve(null);
            }
          })();
          sessionId.then((id: string | null) => {
            const targetSessionId = id && id.length > 0 ? id : 'default';
            eventBus.emit('message:response', { text, sessionId: targetSessionId });
          });
          try {
            localStorage.setItem(
              'deskpet_chat_unread',
              String((parseInt(localStorage.getItem('deskpet_chat_unread') || '0', 10) || 0) + 1),
            );
          } catch {
            /* ignore */
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
            const targetId = (async () => {
              try {
                const m = await import('./services/chatStorage');
                return m.getActiveSession()?.id ?? 'default';
              } catch {
                return 'default';
              }
            })();
            const off = eventBus.on('message:response', async (payload) => {
              const id = await targetId;
              const p = payload as { text: string; sessionId: string };
              if (p.sessionId === id) {
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
      // 跨窗实时同步：状态面板改监听 Tauri 事件（替代 2s 轮询）
      if (isTauriEnv()) {
        emit(EMOTION_CHANGED_EVENT, emotionState).catch(() => {});
      }
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

      // ★ 真实角色包围盒命中测试：仅当按下位置落在角色本体（含边缘缓冲）才允许拖动角色。
      // .pet-model 100% 覆盖窗口，点空白也会触发 mousedown，必须拦截，
      // 否则「点角色周围空白」会拖动整个角色窗口（空白误触）。
      // 与 Live2DViewer.handleCanvasClick 共用同一套基于 Cubism 模型矩阵的命中测试，保持一致。
      try {
        const rect = e.currentTarget.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          const clickX = e.clientX - rect.left;
          const clickY = e.clientY - rect.top;
          if (!isPointOverCharacter(clickX, clickY)) return; // 空白区：不拖动角色
        }
      } catch {
        /* ignore */
      }

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
        // 退出前先关闭悬浮球独立窗口，避免主窗关闭后它残留
        import('@tauri-apps/api/webviewWindow')
          .then(({ WebviewWindow }) => WebviewWindow.getByLabel('controls'))
          .then((w) => w?.close().catch(() => {}))
          .catch(() => {});
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
    // 用 ref 快照计算，避免闭包过期（跨窗回调经 ref 调用，依赖数组 [] 保证引用稳定）
    const next = !petVisibleRef.current;
    setAppearance((a) => ({ ...a, petVisible: next }));
    writeAppearanceConfig({ petVisible: next });
  }, []);

  // 启动悬浮球独立窗口（常驻，可拖到屏幕任意位置）
  useEffect(() => {
    if (!isTauriEnv()) return;
    openControlsOrb();
  }, [openControlsOrb]);

  // 悬浮球 z 序最高：启动一次把悬浮球提到最上层。
  // ⚠️ 注意：绝不在主窗 onFocusChanged 里 re-raise 悬浮球！
  //   两窗都是 alwaysOnTop，主窗获焦时若去 toggle 悬浮球，会与「悬浮球失焦自我提价」互抢，
  //   鼠标在悬浮球/角色边界来回移动时焦点反复横跳 → 每秒多次 off→on toggle → 疯狂闪烁。
  //   正确做法：悬浮球自己「失焦那刻」才自我提价（见 ControlsOrb.tsx），离散事件、不进循环。
  useEffect(() => {
    if (!isTauriEnv()) return;
    // 启动：确保悬浮球在最上层（一次性，无闪烁）
    void WebviewWindow.getByLabel('controls')
      .then((c) => {
        if (c) c.setAlwaysOnTop(true).catch(() => {});
      })
      .catch(() => {});
  }, []);

  // 托盘「重置悬浮球」：把球移动到角色（主窗）旁边的默认位，并置顶，
  // 让球始终可见（无碰撞，球可以自由停在角色旁边或之上）。
  useEffect(() => {
    if (!isTauriEnv()) return;
    let unlisten: (() => void) | undefined;
    listen('tray:reset-orb', async () => {
      try {
        const controls = await WebviewWindow.getByLabel('controls').catch(() => null);
        if (!controls) return;
        // 即使此前被隐藏（如最小化到托盘）也一并显示，确保重置后用户能看到球
        try {
          await controls.show();
        } catch {
          /* ignore */
        }
        const main = await getMainRect();
        const d = await computeOrbDefaultPos(main);
        await controls.setPosition(new LogicalPosition(d.x, d.y)).catch(() => {});
        // ★ toggle 技巧：先 off 再 on 强制把球提升到所有置顶窗（含角色）之上
        controls
          .setAlwaysOnTop(false)
          .then(() => controls.setAlwaysOnTop(true))
          .catch(() => {});
      } catch {
        /* ignore */
      }
    })
      .then((u) => {
        unlisten = u;
      })
      .catch(() => {});
    return () => {
      unlisten?.();
    };
  }, []);

  // 跨窗通信：接收悬浮球窗口的动作并派发到本地 handler
  // ⚠️ 用 ref 持有「最新」handler，effect 只注册一次 listen：
  //   listen() 是异步的，若 effect 依赖变化重跑，cleanup 时 unlisten 可能尚未赋值
  //   （Promise 未 resolve）→ 旧 listener 泄漏、多个 listener 叠加；且回调捕获的
  //   是创建时的旧闭包（如 handleToggleLive2D 依赖 petVisible 会过期）。
  const controlsHandlersRef = useRef({
    openSettingsPanel,
    toggleChatPanel,
    handleToggleLive2D,
    toggleTransform,
    toggleFadeOnHover,
    toggleLock,
    handleClose,
    switchModel,
  });
  useEffect(() => {
    controlsHandlersRef.current = {
      openSettingsPanel,
      toggleChatPanel,
      handleToggleLive2D,
      toggleTransform,
      toggleFadeOnHover,
      toggleLock,
      handleClose,
      switchModel,
    };
  });
  useEffect(() => {
    if (!isTauriEnv()) return;
    let unlisten: (() => void) | undefined;
    listen<ControlsActionPayload>('controls:action', (e) => {
      const a = e.payload;
      const h = controlsHandlersRef.current;
      console.log('[MainPetApp] received controls:action ->', a.type, a);
      switch (a.type) {
        case 'settings':
          h.openSettingsPanel();
          break;
        case 'chat':
          h.toggleChatPanel();
          try {
            localStorage.setItem('deskpet_chat_unread', '0');
          } catch {
            /* ignore */
          }
          break;
        case 'hidepet':
          h.handleToggleLive2D();
          break;
        case 'transform':
          h.toggleTransform();
          break;
        case 'fade':
          h.toggleFadeOnHover();
          break;
        case 'lock':
          h.toggleLock();
          break;
        case 'exit':
          h.handleClose();
          break;
        case 'switchModel':
          if (a.payload) h.switchModel(a.payload);
          break;
      }
    })
      .then((u) => {
        unlisten = u;
      })
      .catch(() => {});
    return () => {
      unlisten?.();
    };
  }, []);

  // 跨窗通信：状态变更时把最新快照广播给悬浮球窗口
  useEffect(() => {
    if (!isTauriEnv()) return;
    const payload: ControlsStatePayload = {
      petVisible: appearance.petVisible,
      isLocked,
      isTransforming,
      fadeOnHover,
      currentModelId,
      availableModels,
    };
    emit('controls:state', payload).catch(() => {});
  }, [
    appearance.petVisible,
    isLocked,
    isTransforming,
    fadeOnHover,
    currentModelId,
    availableModels,
  ]);

  // 跨窗通信：悬浮球窗口挂载后请求一次当前状态，立即回发
  useEffect(() => {
    if (!isTauriEnv()) return;
    let unlisten: (() => void) | undefined;
    listen<null>('controls:request-state', () => {
      const payload: ControlsStatePayload = {
        petVisible: appearance.petVisible,
        isLocked,
        isTransforming,
        fadeOnHover,
        currentModelId,
        availableModels,
      };
      emit('controls:state', payload).catch(() => {});
    })
      .then((u) => {
        unlisten = u;
      })
      .catch(() => {});
    return () => {
      unlisten?.();
    };
  }, [
    appearance.petVisible,
    isLocked,
    isTransforming,
    fadeOnHover,
    currentModelId,
    availableModels,
  ]);

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

  // 权限网关：注册 Gateway 下发的前端工具执行器（经权限确认），
  // 并在应用启动时清空"本次会话全部允许"（仅限本次会话，重启即失效）
  useEffect(() => {
    permissionManager.resetSessionTrustOnLaunch();
    const unsub = registerGatewayToolExecutor((id, name, content, isError) =>
      getHermesGatewayClient().sendToolResult(id, name, content, isError),
    );
    return () => unsub();
  }, []);

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
      {/* 角色隐藏 / 2D 未加载完成时隐藏气泡；锁定态不隐藏——气泡随窗口级穿透一起可点击穿透（与角色一致），
          悬停淡出时由 .fading 类跟随角色一起透明 */}
      {appearance.petVisible && petModelReady && (
        <div
          className={`bubble-zone ${appearance.bubblePosition === 'bottom' ? 'bubble-zone--bottom' : ''} ${fadeOnHover && isHovering ? 'fading' : ''}`}
        >
          <ChatBubble message={bubble} onComplete={() => setBubble(null)} />
        </div>
      )}

      {/* 顶部中央「刘海位」字幕 + 声波层（唤醒/聊天回复/语音通话全场景共用） */}
      <SubtitleNotch />

      {/* 常驻状态角标：语音聆听(右上) / 一起看截屏(左上) */}
      <StatusIndicators
        wakeState={wakeState}
        voiceState={voiceState}
        isWatching={isWatching}
        voiceManual={voiceManualStop}
        vadEnabled={voiceAutoListen}
        vadSpeaking={vadIsSpeaking}
      />

      {/* 权限确认卡（工具执行前的授权弹窗） */}
      <ConsentGate />

      <div
        className={`pet-zone ${isLocked ? 'locked' : ''} ${isTransforming ? 'moving' : ''} ${fadeOnHover && isHovering ? 'fading' : ''}`}
        style={{
          transform: appearance.mirror ? 'scaleX(-1)' : undefined,
          // ★ 整个 pet-zone 不拦截鼠标（空白区域穿透到桌面/下方窗口）
          //   仅 .pet-model（实际角色渲染区）设 pointerEvents:auto 捕获交互
          //   旧版这里设 auto 导致整个窗口矩形都捕获点击——包括角色周围大量空白
          pointerEvents: 'none',
        }}
      >
        {/* 隐藏角色：直接卸载 Live2D，把 2D 图像从桌面彻底移除（而非仅设 opacity:0 透明留 DOM） */}
        {appearance.petVisible && (
          <div
            className="pet-model"
            onMouseDown={handlePetMouseDown}
            onMouseEnter={() => !isLocked && setIsHovering(true)}
            onMouseLeave={() => !isLocked && setIsHovering(false)}
            style={{ pointerEvents: 'auto' }}
          >
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
              onModelLoaded={onPetModelLoaded}
              headYRatio={modelConfig.headYRatio ?? 0.35}
            />
          </div>
        )}
      </div>
    </div>
  );
}

export default MainPetApp;
