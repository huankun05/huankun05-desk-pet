import { readStorage, writeStorage } from '../hooks/useStorageEvent';
import { isTauriEnv } from '../utils/tauriEnv';

/**
 * 聊天外观变更广播事件名。
 *
 * localStorage 在多个 webview 之间是共享的，但 `storage` 事件不会跨 webview 传播，
 * 所以设置窗改完聊天外观后，必须再发一个 Tauri 事件，聊天窗才能实时刷新。
 */
export const CHAT_APPEARANCE_EVENT = 'chat-appearance-changed';

/**
 * 外观相关的「展示类」配置（与角色模型参数、窗口置顶等解耦，集中管理避免散落）。
 * 这些配置由 App 主窗读取并实时生效，设置窗通过 writeStorage 跨窗口同步。
 *
 * 注意：刻意不在此处重复角色模型参数（缩放/气泡高度/闲置超时等已在 Live2D 页）、
 * 窗口置顶（已在系统→常规页）。
 */

export const APPEARANCE_KEYS = {
  bubbleFontSize: 'deskpet_bubble_font_size',
  bubbleRadius: 'deskpet_bubble_radius',
  bubbleTheme: 'deskpet_bubble_theme',
  bubbleDuration: 'deskpet_bubble_duration',
  bubblePosition: 'deskpet_bubble_position',
  chatFontSize: 'deskpet_chat_font_size',
  chatBackgroundImage: 'deskpet_chat_background_image',
  chatTheme: 'deskpet_chat_theme',
  chatAccent: 'deskpet_chat_accent',
  chatBubbleRadius: 'deskpet_chat_bubble_radius',
  chatBubbleTail: 'deskpet_chat_bubble_tail',
  chatShowAvatar: 'deskpet_chat_show_avatar',
  chatUserAvatar: 'deskpet_chat_user_avatar',
  chatAiAvatar: 'deskpet_chat_ai_avatar',
  mirror: 'deskpet_mirror',
  petVisible: 'deskpet_pet_visible',
  clickFeedback: 'deskpet_click_feedback',
  dragEnabled: 'deskpet_drag_enabled',
  windowPosMemory: 'deskpet_window_pos_memory',
  orbPosMemory: 'deskpet_orb_pos_memory',
  showFps: 'deskpet_show_fps',
  fadeOpacity: 'deskpet_fadeOpacity',
  targetFps: 'deskpet_target_fps',
  adaptiveFps: 'deskpet_adaptive_fps',
} as const;

/** 可选的目标帧率档位（0 = 不限制，跟随屏幕刷新率）。 */
export const FPS_TIERS = [60, 45, 30, 24, 15] as const;

export type BubbleTheme = 'follow' | 'light' | 'dark';
export type BubblePosition = 'top' | 'bottom';
/** 聊天窗口配色（与桌宠气泡配色互不影响） */
export type ChatTheme = 'follow' | 'light' | 'dark';

/** 聊天气泡主色预设（QQ 蓝为默认） */
export const CHAT_ACCENT_PRESETS = [
  { value: '#12b7f5', label: 'QQ 蓝' },
  { value: '#22c55e', label: '薄荷绿' },
  { value: '#f472b6', label: '樱花粉' },
  { value: '#8b5cf6', label: '暗夜紫' },
  { value: '#f59e0b', label: '琥珀橙' },
] as const;

export interface AppearanceConfig {
  /** 气泡字号 (px) */
  bubbleFontSize: number;
  /** 气泡圆角 (px) */
  bubbleRadius: number;
  /** 气泡配色：跟随当前主题 / 浅色 / 深色 */
  bubbleTheme: BubbleTheme;
  /** 气泡默认显示时长 (ms) */
  bubbleDuration: number;
  /** 气泡位置：顶部 / 底部 */
  bubblePosition: BubblePosition;
  /** 聊天区域基础字号 (px) */
  chatFontSize: number;
  /** 聊天背景图（data URL 或可访问 URL） */
  chatBackgroundImage?: string;
  /** 聊天窗口配色：跟随系统 / 浅色 / 深色 */
  chatTheme: ChatTheme;
  /** 聊天气泡主色（十六进制） */
  chatAccent: string;
  /** 聊天气泡圆角 (px) */
  chatBubbleRadius: number;
  /** 是否显示气泡尾巴 */
  chatBubbleTail: boolean;
  /** 是否在消息旁显示头像 */
  chatShowAvatar: boolean;
  /** 用户头像（data URL，空 = 默认占位） */
  chatUserAvatar?: string;
  /** AI 头像（data URL，空 = 使用桌宠形象） */
  chatAiAvatar?: string;
  /** 角色水平镜像翻转 */
  mirror: boolean;
  /** 显示/隐藏角色 */
  petVisible: boolean;
  /** 点击角色是否触发互动反馈 */
  clickFeedback: boolean;
  /** 是否允许拖拽角色移动窗口 */
  dragEnabled: boolean;
  /** 是否记忆窗口位置（开机恢复上次位置） */
  windowPosMemory: boolean;
  /** 是否记忆悬浮球位置（开机恢复上次位置，与 windowPosMemory 一致） */
  orbPosMemory: boolean;
  /** 是否显示 FPS 悬浮指示 */
  showFps: boolean;
  /** 鼠标悬停时角色的淡出透明度 (0~1)，驱动 CSS 变量 --fade-opacity */
  fadeOpacity: number;
  /** 角色渲染的目标帧率上限；0 = 不限制（跟随屏幕刷新率） */
  targetFps: number;
  /** 是否根据设备实际负载自动下调帧率（上限不超过 targetFps） */
  adaptiveFps: boolean;
}

export const DEFAULT_APPEARANCE: AppearanceConfig = {
  bubbleFontSize: 13,
  bubbleRadius: 14,
  bubbleTheme: 'follow',
  bubbleDuration: 4000,
  bubblePosition: 'top',
  chatFontSize: 14,
  chatTheme: 'light',
  chatAccent: '#12b7f5',
  chatBubbleRadius: 12,
  chatBubbleTail: true,
  chatShowAvatar: true,
  mirror: false,
  petVisible: true,
  clickFeedback: true,
  dragEnabled: true,
  windowPosMemory: true,
  orbPosMemory: true,
  showFps: false,
  fadeOpacity: 0.15,
  targetFps: 60,
  adaptiveFps: true,
};

const num = (key: string, def: number): number => {
  const v = readStorage<string>(key, String(def));
  const n = Number(v);
  return Number.isNaN(n) ? def : n;
};

const bool = (key: string, def: boolean): boolean =>
  readStorage<string>(key, String(def)) === 'true';

const str = <T extends string>(key: string, def: T): T => readStorage<string>(key, def) as T;

export function readAppearance(): AppearanceConfig {
  return {
    bubbleFontSize: num(APPEARANCE_KEYS.bubbleFontSize, DEFAULT_APPEARANCE.bubbleFontSize),
    bubbleRadius: num(APPEARANCE_KEYS.bubbleRadius, DEFAULT_APPEARANCE.bubbleRadius),
    bubbleTheme: str<BubbleTheme>(APPEARANCE_KEYS.bubbleTheme, DEFAULT_APPEARANCE.bubbleTheme),
    bubbleDuration: num(APPEARANCE_KEYS.bubbleDuration, DEFAULT_APPEARANCE.bubbleDuration),
    bubblePosition: str<BubblePosition>(
      APPEARANCE_KEYS.bubblePosition,
      DEFAULT_APPEARANCE.bubblePosition,
    ),
    chatFontSize: num(APPEARANCE_KEYS.chatFontSize, DEFAULT_APPEARANCE.chatFontSize),
    chatBackgroundImage: readStorage<string>(APPEARANCE_KEYS.chatBackgroundImage, ''),
    chatTheme: str<ChatTheme>(APPEARANCE_KEYS.chatTheme, DEFAULT_APPEARANCE.chatTheme),
    chatAccent: readStorage<string>(APPEARANCE_KEYS.chatAccent, DEFAULT_APPEARANCE.chatAccent),
    chatBubbleRadius: num(APPEARANCE_KEYS.chatBubbleRadius, DEFAULT_APPEARANCE.chatBubbleRadius),
    chatBubbleTail: bool(APPEARANCE_KEYS.chatBubbleTail, DEFAULT_APPEARANCE.chatBubbleTail),
    chatShowAvatar: bool(APPEARANCE_KEYS.chatShowAvatar, DEFAULT_APPEARANCE.chatShowAvatar),
    chatUserAvatar: readStorage<string>(APPEARANCE_KEYS.chatUserAvatar, ''),
    chatAiAvatar: readStorage<string>(APPEARANCE_KEYS.chatAiAvatar, ''),
    mirror: bool(APPEARANCE_KEYS.mirror, DEFAULT_APPEARANCE.mirror),
    petVisible: bool(APPEARANCE_KEYS.petVisible, DEFAULT_APPEARANCE.petVisible),
    clickFeedback: bool(APPEARANCE_KEYS.clickFeedback, DEFAULT_APPEARANCE.clickFeedback),
    dragEnabled: bool(APPEARANCE_KEYS.dragEnabled, DEFAULT_APPEARANCE.dragEnabled),
    windowPosMemory: bool(APPEARANCE_KEYS.windowPosMemory, DEFAULT_APPEARANCE.windowPosMemory),
    orbPosMemory: bool(APPEARANCE_KEYS.orbPosMemory, DEFAULT_APPEARANCE.orbPosMemory),
    showFps: bool(APPEARANCE_KEYS.showFps, DEFAULT_APPEARANCE.showFps),
    fadeOpacity: num(APPEARANCE_KEYS.fadeOpacity, DEFAULT_APPEARANCE.fadeOpacity),
    targetFps: num(APPEARANCE_KEYS.targetFps, DEFAULT_APPEARANCE.targetFps),
    adaptiveFps: bool(APPEARANCE_KEYS.adaptiveFps, DEFAULT_APPEARANCE.adaptiveFps),
  };
}

export function writeAppearanceConfig(patch: Partial<AppearanceConfig>): void {
  const next = { ...readAppearance(), ...patch };
  writeStorage(APPEARANCE_KEYS.bubbleFontSize, String(next.bubbleFontSize));
  writeStorage(APPEARANCE_KEYS.bubbleRadius, String(next.bubbleRadius));
  writeStorage(APPEARANCE_KEYS.bubbleTheme, next.bubbleTheme);
  writeStorage(APPEARANCE_KEYS.bubbleDuration, String(next.bubbleDuration));
  writeStorage(APPEARANCE_KEYS.bubblePosition, next.bubblePosition);
  // 聊天窗口外观（此前漏写，导致字号/背景在设置页调完就丢）
  writeStorage(APPEARANCE_KEYS.chatFontSize, String(next.chatFontSize));
  writeStorage(APPEARANCE_KEYS.chatBackgroundImage, next.chatBackgroundImage ?? '');
  writeStorage(APPEARANCE_KEYS.chatTheme, next.chatTheme);
  writeStorage(APPEARANCE_KEYS.chatAccent, next.chatAccent);
  writeStorage(APPEARANCE_KEYS.chatBubbleRadius, String(next.chatBubbleRadius));
  writeStorage(APPEARANCE_KEYS.chatBubbleTail, String(next.chatBubbleTail));
  writeStorage(APPEARANCE_KEYS.chatShowAvatar, String(next.chatShowAvatar));
  writeStorage(APPEARANCE_KEYS.chatUserAvatar, next.chatUserAvatar ?? '');
  writeStorage(APPEARANCE_KEYS.chatAiAvatar, next.chatAiAvatar ?? '');
  writeStorage(APPEARANCE_KEYS.mirror, String(next.mirror));
  writeStorage(APPEARANCE_KEYS.petVisible, String(next.petVisible));
  writeStorage(APPEARANCE_KEYS.clickFeedback, String(next.clickFeedback));
  writeStorage(APPEARANCE_KEYS.dragEnabled, String(next.dragEnabled));
  writeStorage(APPEARANCE_KEYS.windowPosMemory, String(next.windowPosMemory));
  writeStorage(APPEARANCE_KEYS.orbPosMemory, String(next.orbPosMemory));
  writeStorage(APPEARANCE_KEYS.showFps, String(next.showFps));
  writeStorage(APPEARANCE_KEYS.fadeOpacity, String(next.fadeOpacity));
  writeStorage(APPEARANCE_KEYS.targetFps, String(next.targetFps));
  writeStorage(APPEARANCE_KEYS.adaptiveFps, String(next.adaptiveFps));

  // 通知其他 webview（聊天面板窗口）刷新外观
  if (isTauriEnv()) {
    void import('@tauri-apps/api/event')
      .then(({ emit }) => emit(CHAT_APPEARANCE_EVENT))
      .catch(() => {
        /* 广播失败不影响本地写入 */
      });
  }
}

/** 当前系统是否为深色外观（用于气泡配色的「跟随」模式）。 */
export function isSystemDark(): boolean {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return true;
  }
}

/**
 * 根据气泡配色模式返回背景与文字色（CSS 值）。
 *
 * `follow` 会跟随系统深浅色；显式指定 `light` / `dark` 时忽略系统设置。
 */
export function bubbleThemeColors(
  theme: BubbleTheme,
  systemDark: boolean = isSystemDark(),
): { bg: string; color: string } {
  const dark = theme === 'dark' || (theme === 'follow' && systemDark);
  return dark
    ? { bg: 'rgba(30, 30, 45, 0.92)', color: '#ffffff' }
    : { bg: 'rgba(255, 255, 255, 0.95)', color: '#1e1e2d' };
}
