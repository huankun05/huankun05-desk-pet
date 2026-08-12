import { useEffect, useRef } from 'react';
import {
  pluginRegistry,
  createPluginContext,
  PomodoroPlugin,
  DailyGreetingPlugin,
  WaterReminderPlugin,
  SedentaryReminderPlugin,
  EyeCarePlugin,
} from '../services/skills';
import { WatchTogetherPlugin } from '../plugins/watch-together';
import { createStorage } from '../services/storage';
import { settingsStorage } from '../services/storage/settingsStorage';
import { triggerTapMotion } from '../lib/live2d';
import { addJob, removeJob } from '../services/cron/manager';
import type { EmotionState, EmotionType, MoodType } from './useEmotion';

export interface UsePluginSystemOptions {
  emotionState: EmotionState;
  applyAdminUpdate: (update: Partial<EmotionState>) => void;
  handleSendMessage: (message: string) => void;
  /** 注入助手消息（不走 LLM），插件 say() 应走此路径 */
  injectAssistantMessage?: (content: string) => void;
  showBubble: (text: string, duration?: number) => void;
}

export function usePluginSystem({
  emotionState,
  applyAdminUpdate,
  handleSendMessage,
  injectAssistantMessage,
  showBubble,
}: UsePluginSystemOptions): void {
  // 用 ref 持有所有外部依赖，避免 effect 反复重建插件上下文
  // （emotionState 每 120s 衰减更新 + 每次互动更新，旧实现会导致插件被 shutdown 再重新注册）
  const refs = useRef({
    emotionState,
    applyAdminUpdate,
    handleSendMessage,
    injectAssistantMessage,
    showBubble,
  });
  useEffect(() => {
    refs.current = { emotionState, applyAdminUpdate, handleSendMessage, injectAssistantMessage, showBubble };
  });

  useEffect(() => {
    pluginRegistry.register(new PomodoroPlugin());
    pluginRegistry.register(new DailyGreetingPlugin());
    pluginRegistry.register(new WaterReminderPlugin());
    pluginRegistry.register(new SedentaryReminderPlugin());
    pluginRegistry.register(new EyeCarePlugin());
    pluginRegistry.register(new WatchTogetherPlugin());

    const pluginCtx = createPluginContext({
      say: (message) => {
        // 插件说话应显示为角色（assistant）消息，而非用户消息
        // 优先走 injectAssistantMessage；降级到 handleSendMessage（兼容旧调用方）
        if (refs.current.injectAssistantMessage) {
          refs.current.injectAssistantMessage(message);
        } else {
          refs.current.handleSendMessage(message);
        }
      },
      showBubble: (message, duration) => {
        refs.current.showBubble(message, duration);
      },
      playAnimation: () => {
        triggerTapMotion();
      },
      getEmotion: () => {
        const s = refs.current.emotionState;
        return {
          mood: s.mood,
          moodIntensity: s.moodIntensity,
          emotion: s.emotion,
          emotionIntensity: s.emotionIntensity,
          favorability: s.favorability,
        };
      },
      setEmotion: (e) => {
        if (e.mood) refs.current.applyAdminUpdate({ mood: e.mood as MoodType });
        if (e.emotion) refs.current.applyAdminUpdate({ emotion: e.emotion as EmotionType });
      },
      getConfig: (key: string, defaultVal: unknown) => {
        const cfg = settingsStorage.get() as Record<string, unknown>;
        return cfg[key] ?? defaultVal;
      },
      setConfig: (key: string, value: unknown) => {
        settingsStorage.set({ ...settingsStorage.get(), [key]: value });
      },
      saveData: (key: string, data: unknown) => {
        const customStorage = createStorage(key, data, { location: 'project', subdir: 'plugins' });
        customStorage.set(data);
      },
      loadData: (key: string, defaultVal: unknown) => {
        const customStorage = createStorage(key, defaultVal, {
          location: 'project',
          subdir: 'plugins',
        });
        return customStorage.get();
      },
      notify: (title, message) => {
        refs.current.showBubble(`${title}: ${message}`, 4000);
      },
      scheduleJob: (options) => {
        return addJob(options);
      },
      cancelJob: (jobId) => {
        removeJob(jobId);
      },
    });

    pluginRegistry.setContext(pluginCtx);
    pluginRegistry.loadPluginStates().catch(() => {});

    return () => {
      pluginRegistry.shutdown();
    };
    // 只在挂载时初始化一次；所有动态依赖通过 ref 读取
  }, []);
}
