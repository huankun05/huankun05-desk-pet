// 主题预设定义

export type ThemeMode = 'light' | 'dark' | 'system';
export type ThemePreset =
  'sakura' | 'minimal' | 'forest' | 'sky' | 'lavender' | 'sunset' | 'mint' | 'rose' | 'custom';

export interface ThemeConfig {
  preset: ThemePreset;
  mode: ThemeMode;
  accentHue: number; // 自定义主色色相（0-360）
  accentSaturation: number; // 饱和度（0-1）
}

/** 用户保存的自定义预设 */
export interface CustomPreset {
  id: string;
  name: string;
  hue: number;
  saturation: number;
}

export const DEFAULT_THEME: ThemeConfig = {
  preset: 'sakura',
  mode: 'system',
  accentHue: 359.46,
  accentSaturation: 0.1617,
};

// 主题预设的 accent 配置
export const THEME_PRESETS: Record<ThemePreset, { hue: number; saturation: number; name: string }> =
  {
    sakura: { hue: 359.46, saturation: 0.1617, name: '樱花粉' },
    minimal: { hue: 220, saturation: 0.08, name: '极简灰' },
    forest: { hue: 145, saturation: 0.17, name: '森林绿' },
    sky: { hue: 210, saturation: 0.18, name: '天空蓝' },
    lavender: { hue: 270, saturation: 0.14, name: '薰衣草' },
    sunset: { hue: 35, saturation: 0.2, name: '暖阳橙' },
    mint: { hue: 175, saturation: 0.16, name: '薄荷青' },
    rose: { hue: 340, saturation: 0.18, name: '玫瑰红' },
    custom: { hue: 359.46, saturation: 0.1617, name: '自定义' },
  };

/**
 * 用 oklch 色相 + 饱和度生成 primary 色阶
 * 300 = 浅色（高亮度、低饱和）, 600 = 深色（低亮度、高饱和）
 */
function primaryScale(hue: number, sat: number) {
  return {
    300: `oklch(0.82 ${sat * 0.7} ${hue})`,
    400: `oklch(0.75 ${sat * 0.85} ${hue})`,
    500: `oklch(0.65 ${sat} ${hue})`,
    600: `oklch(0.55 ${sat * 1.15} ${hue})`,
  };
}

// 应用主题配置到 DOM
export function applyTheme(config: ThemeConfig, scope: 'pet' | 'admin' = 'pet') {
  const root = document.documentElement;
  const preset = THEME_PRESETS[config.preset];

  // 设置主色变量
  const hue = config.preset === 'custom' ? config.accentHue : preset.hue;
  const sat = config.preset === 'custom' ? config.accentSaturation : preset.saturation;

  // Primary 色阶（统一控制整个 UI 主色调）
  const scale = primaryScale(hue, sat);
  root.style.setProperty('--primary-300', scale[300]);
  root.style.setProperty('--primary-400', scale[400]);
  root.style.setProperty('--primary-500', scale[500]);
  root.style.setProperty('--primary-600', scale[600]);

  // Accent 变量（聊天、状态等使用）
  root.style.setProperty('--accent', `oklch(0.7542 ${sat} ${hue})`);
  root.style.setProperty('--accent-soft', `oklch(0.7542 ${sat * 0.5} ${hue} / 0.12)`);
  root.style.setProperty('--accent-hover', `oklch(0.7 ${sat * 1.1} ${hue})`);

  // 设置暗色模式
  const isDark =
    config.mode === 'dark' ||
    (config.mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  root.classList.toggle('dark', isDark);

  // 背景色
  root.style.setProperty('--bg-color', isDark ? '#111114' : '#ffffff');

  // 持久化（按作用域独立存储）
  try {
    localStorage.setItem(`deskpet-theme-${scope}`, JSON.stringify(config));
  } catch (e) {
    console.warn('[theme] failed to persist theme:', e);
  }
}

// 从 localStorage 读取主题配置
export function loadTheme(scope: 'pet' | 'admin' = 'pet'): ThemeConfig {
  try {
    const stored = localStorage.getItem(`deskpet-theme-${scope}`);
    if (stored) return { ...DEFAULT_THEME, ...JSON.parse(stored) };
  } catch (e) {
    console.warn('[theme] failed to load theme:', e);
  }
  return DEFAULT_THEME;
}

// ═══════════════════════════════════════════════════════════════
// 自定义预设持久化
// ═══════════════════════════════════════════════════════════════
const CUSTOM_PRESETS_KEY = 'deskpet-custom-presets';

export function loadCustomPresets(): CustomPreset[] {
  try {
    const stored = localStorage.getItem(CUSTOM_PRESETS_KEY);
    if (stored) return JSON.parse(stored);
  } catch {
    // ignore
  }
  return [];
}

export function saveCustomPresets(presets: CustomPreset[]): void {
  try {
    localStorage.setItem(CUSTOM_PRESETS_KEY, JSON.stringify(presets));
  } catch (e) {
    console.warn('[theme] failed to persist custom presets:', e);
  }
}

export function addCustomPreset(name: string, hue: number, saturation: number): CustomPreset {
  const presets = loadCustomPresets();
  const id = `custom_${Date.now()}`;
  const newPreset: CustomPreset = { id, name, hue, saturation };
  presets.push(newPreset);
  saveCustomPresets(presets);
  return newPreset;
}

export function deleteCustomPreset(id: string): void {
  const presets = loadCustomPresets().filter((p) => p.id !== id);
  saveCustomPresets(presets);
}
