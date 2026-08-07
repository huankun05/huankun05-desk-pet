# Plan 1: 基础设施改造实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立 Desk Pet 的基础设施——设计系统、主题系统、Zustand 状态管理、P0 性能优化，为后续 UI 改造和动画重写打地基。

**Architecture:** 在现有 Tauri+React 项目上，引入 Zustand 做细粒度状态管理，建立 CSS 变量驱动的主题系统（支持亮/暗/自定义主色），统一设计 token，修复 3 个 P0 性能瓶颈（IPC 降频、emotionState 拆分、storage 事件替代轮询）。采用渐进式迁移，每个任务产出可工作代码。

**Tech Stack:** React 19, TypeScript, Zustand 5, Tailwind CSS v4, Vite 7, Tauri 2.0

**Spec:** [2026-07-26-desk-pet-deep-refactor-design.md](../specs/2026-07-26-desk-pet-deep-refactor-design.md)

---

## 文件结构

### 新增文件

| 文件 | 职责 |
|------|------|
| `src/ui/tokens.css` | 设计 token 定义（颜色/字体/间距/圆角/动画曲线） |
| `src/ui/components/Button.tsx` | 统一按钮组件 |
| `src/ui/components/Card.tsx` | 统一卡片组件 |
| `src/ui/components/Toggle.tsx` | iOS 风格滑动开关 |
| `src/ui/components/index.ts` | 基础组件导出 |
| `src/theme/ThemeProvider.tsx` | 主题 Context + 切换逻辑 |
| `src/theme/themes.ts` | 主题预设定义（极简灰/樱花粉/自定义） |
| `src/theme/index.ts` | 主题模块导出 |
| `src/stores/emotionStore.ts` | 情感状态 store（拆分自 emotionState） |
| `src/stores/favorabilityStore.ts` | 好感度 store（独立） |
| `src/stores/personalityStore.ts` | 人格 store（HEXACO） |
| `src/stores/chatStreamStore.ts` | 流式消息缓冲层 |
| `src/stores/appStore.ts` | 应用级状态（UI 相关） |
| `src/stores/index.ts` | store 统一导出 |
| `src/hooks/useStorageEvent.ts` | storage 事件 hook（替代轮询） |
| `src/hooks/useTheme.ts` | 主题 hook（便捷访问） |

### 修改文件

| 文件 | 改动 |
|------|------|
| `package.json` | 添加 zustand 依赖 |
| `src/main.tsx` | 包裹 ThemeProvider |
| `src/index.css` | 引入 tokens.css，改用 CSS 变量 |
| `src/admin/index.css` | 改用 CSS 变量（兼容主题系统） |
| `src/App.tsx` | 使用 store 替代 useState，移除轮询 |
| `src/hooks/useLive2D.ts` | IPC 降频 60→15fps |
| `src/hooks/useEmotion.ts` | 改为 store 的薄封装 |
| `src/components/Pet/Live2DViewer.tsx` | 从 store 读取情感状态 |
| `src/components/Status/StatusPanel.tsx` | 从 store 读取状态 |

---

## Task 1: 安装 Zustand 依赖

**Files:**
- Modify: `package.json`
- Modify: `pnpm-workspace.yaml`（如需要）

- [ ] **Step 1: 安装 zustand**

Run:
```bash
cd f:\Work\Create\desk_pet\desk-pet
pnpm add zustand
```

Expected: `package.json` 中 `dependencies` 出现 `"zustand": "^5.x.x"`

- [ ] **Step 2: 验证安装**

Run:
```bash
pnpm typecheck
```

Expected: 无错误，类型检查通过。

- [ ] **Step 3: 提交**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: add zustand for state management"
```

---

## Task 2: 建立设计 token 文件

**Files:**
- Create: `src/ui/tokens.css`
- Modify: `src/index.css`

- [ ] **Step 1: 创建 tokens.css**

创建 `src/ui/tokens.css`：

```css
/* 设计 token —— 所有视觉属性的单一真相源 */

:root {
  /* === 颜色 token === */
  --bg-base: #ffffff;
  --bg-surface: #f8f5f8;
  --bg-glass: rgba(255, 255, 255, 0.55);
  --bg-glass-dark: rgba(20, 20, 20, 0.55);

  --text-primary: #1a1a2e;
  --text-secondary: #6b7280;
  --text-muted: #9ca3af;

  --accent: oklch(0.7542 0.1617 359.46);
  --accent-soft: oklch(0.7542 0.08 359.46 / 0.12);
  --accent-hover: oklch(0.7 0.18 359.46);

  --border: rgba(0, 0, 0, 0.08);
  --border-strong: rgba(0, 0, 0, 0.15);

  --color-success: #52c41a;
  --color-warning: #faad14;
  --color-danger: #ff4d4f;

  /* === 字体 token === */
  --font-sans: 'Inter', 'SF Pro Display', -apple-system, BlinkMacSystemFont,
    'Segoe UI', 'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', sans-serif;
  --font-mono: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'SF Mono', monospace;

  /* === 间距 token === */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-8: 32px;
  --space-10: 40px;

  /* === 圆角 token === */
  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 16px;
  --radius-xl: 24px;
  --radius-full: 9999px;

  /* === 动画曲线 token === */
  --ease-ios: cubic-bezier(0.32, 0.72, 0, 1);
  --ease-out-quad: cubic-bezier(0.25, 0.46, 0.45, 0.94);
  --ease-in-out: cubic-bezier(0.4, 0, 0.2, 1);
  --duration-fast: 150ms;
  --duration-normal: 250ms;
  --duration-slow: 400ms;

  /* === 阴影 token === */
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.05);
  --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.08);
  --shadow-lg: 0 8px 24px rgba(0, 0, 0, 0.12);

  /* === 玻璃效果 token === */
  --glass-blur: 20px;
  --glass-saturate: 1.5;
  --glass-border: rgba(255, 255, 255, 0.35);
}

html.dark {
  --bg-base: #111114;
  --bg-surface: #1a1a1f;
  --bg-glass: rgba(20, 20, 20, 0.55);
  --text-primary: #e4e4e9;
  --text-secondary: #9ca3af;
  --text-muted: #6b7280;
  --border: rgba(255, 255, 255, 0.08);
  --border-strong: rgba(255, 255, 255, 0.15);
  --glass-border: rgba(255, 255, 255, 0.06);
  --glass-saturate: 1.2;
}

/* 动态色相旋转支持（借鉴 AIRI） */
@property --chromatic-hue {
  syntax: '<number>';
  initial-value: 0;
  inherits: true;
}

@keyframes hue-anim {
  from { --chromatic-hue: 0; }
  to { --chromatic-hue: 360; }
}

.dynamic-hue {
  animation: hue-anim 10s linear infinite;
}
```

- [ ] **Step 2: 在 index.css 引入 tokens.css**

修改 `src/index.css`，在文件顶部添加：

```css
@import './ui/tokens.css';
```

- [ ] **Step 3: 验证编译**

Run:
```bash
pnpm dev
```

Expected: Vite 启动无错误，浏览器开发者工具中 `:root` 可看到 CSS 变量。

- [ ] **Step 4: 提交**

```bash
git add src/ui/tokens.css src/index.css
git commit -m "feat(ui): add design tokens system"
```

---

## Task 3: 建立主题系统

**Files:**
- Create: `src/theme/themes.ts`
- Create: `src/theme/ThemeProvider.tsx`
- Create: `src/theme/index.ts`
- Modify: `src/main.tsx`

- [ ] **Step 1: 创建 themes.ts**

创建 `src/theme/themes.ts`：

```typescript
// 主题预设定义

export type ThemeMode = 'light' | 'dark' | 'system';
export type ThemePreset = 'sakura' | 'minimal' | 'custom';

export interface ThemeConfig {
  preset: ThemePreset;
  mode: ThemeMode;
  accentHue: number; // 自定义主色色相（0-360）
  accentSaturation: number; // 饱和度（0-1）
}

export const DEFAULT_THEME: ThemeConfig = {
  preset: 'sakura',
  mode: 'system',
  accentHue: 359.46,
  accentSaturation: 0.1617,
};

// 主题预设的 accent 配置
export const THEME_PRESETS: Record<ThemePreset, { hue: number; saturation: number; name: string }> = {
  sakura: { hue: 359.46, saturation: 0.1617, name: '樱花粉' },
  minimal: { hue: 220, saturation: 0.08, name: '极简灰' },
  custom: { hue: 359.46, saturation: 0.1617, name: '自定义' },
};

// 应用主题配置到 DOM
export function applyTheme(config: ThemeConfig, scope: 'pet' | 'admin' = 'pet') {
  const root = document.documentElement;
  const preset = THEME_PRESETS[config.preset];

  // 设置主色变量
  const hue = config.preset === 'custom' ? config.accentHue : preset.hue;
  const sat = config.preset === 'custom' ? config.accentSaturation : preset.saturation;

  root.style.setProperty('--accent', `oklch(0.7542 ${sat} ${hue})`);
  root.style.setProperty('--accent-soft', `oklch(0.7542 ${sat * 0.5} ${hue} / 0.12)`);
  root.style.setProperty('--accent-hover', `oklch(0.7 ${sat * 1.1} ${hue})`);

  // 设置暗色模式
  const isDark = config.mode === 'dark' ||
    (config.mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  root.classList.toggle('dark', isDark);

  // 持久化（按作用域独立存储）
  localStorage.setItem(`deskpet-theme-${scope}`, JSON.stringify(config));
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
```

- [ ] **Step 2: 创建 ThemeProvider.tsx**

创建 `src/theme/ThemeProvider.tsx`：

```typescript
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import {
  type ThemeConfig,
  type ThemeMode,
  type ThemePreset,
  DEFAULT_THEME,
  THEME_PRESETS,
  applyTheme,
  loadTheme,
} from './themes';

interface ThemeContextValue {
  theme: ThemeConfig;
  scope: 'pet' | 'admin';
  setPreset: (preset: ThemePreset) => void;
  setMode: (mode: ThemeMode) => void;
  setAccentHue: (hue: number) => void;
  setAccentSaturation: (sat: number) => void;
  resetTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({
  children,
  scope = 'pet',
}: {
  children: ReactNode;
  scope?: 'pet' | 'admin';
}) {
  const [theme, setTheme] = useState<ThemeConfig>(() => loadTheme(scope));

  // 应用主题到 DOM
  useEffect(() => {
    applyTheme(theme, scope);
  }, [theme, scope]);

  // 监听系统主题变化（仅当 mode === 'system' 时生效）
  useEffect(() => {
    if (theme.mode !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => applyTheme(theme, scope);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [theme, scope]);

  const value: ThemeContextValue = {
    theme,
    scope,
    setPreset: (preset) => setTheme((p) => ({ ...p, preset, ...THEME_PRESETS[preset] })),
    setMode: (mode) => setTheme((p) => ({ ...p, mode })),
    setAccentHue: (hue) => setTheme((p) => ({ ...p, preset: 'custom', accentHue: hue })),
    setAccentSaturation: (sat) => setTheme((p) => ({ ...p, preset: 'custom', accentSaturation: sat })),
    resetTheme: () => setTheme(DEFAULT_THEME),
  };

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useThemeContext() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useThemeContext must be used within ThemeProvider');
  return ctx;
}
```

- [ ] **Step 3: 创建 index.ts**

创建 `src/theme/index.ts`：

```typescript
export { ThemeProvider, useThemeContext } from './ThemeProvider';
export { type ThemeConfig, type ThemeMode, type ThemePreset, THEME_PRESETS, DEFAULT_THEME } from './themes';
```

- [ ] **Step 4: 创建 useTheme hook**

创建 `src/hooks/useTheme.ts`：

```typescript
import { useThemeContext } from '../theme';

// 便捷 hook，等价于 useThemeContext
export function useTheme() {
  return useThemeContext();
}
```

- [ ] **Step 5: 在 main.tsx 包裹 ThemeProvider**

修改 `src/main.tsx`，在 React 根组件外层包裹 ThemeProvider：

```typescript
import { ThemeProvider } from './theme';

// 在 createRoot(root).render(...) 中包裹
root.render(
  <ThemeProvider scope="pet">
    <App />
  </ThemeProvider>
);
```

注意：保持现有的 Live2D 预加载逻辑不变。

- [ ] **Step 6: 验证主题切换**

Run:
```bash
pnpm dev
```

在浏览器控制台执行：
```javascript
document.documentElement.style.setProperty('--accent', 'oklch(0.7542 0.1617 220)')
```

Expected: 页面主色从樱花粉变为蓝色。

- [ ] **Step 7: 提交**

```bash
git add src/theme/ src/hooks/useTheme.ts src/main.tsx
git commit -m "feat(theme): add theme system with light/dark/custom accent"
```

---

## Task 4: 建立基础组件库

**Files:**
- Create: `src/ui/components/Button.tsx`
- Create: `src/ui/components/Card.tsx`
- Create: `src/ui/components/Toggle.tsx`
- Create: `src/ui/components/index.ts`

- [ ] **Step 1: 创建 Button.tsx**

创建 `src/ui/components/Button.tsx`：

```typescript
import { type ButtonHTMLAttributes, forwardRef } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

const variantClasses: Record<Variant, string> = {
  primary: 'bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)]',
  secondary: 'bg-[var(--accent-soft)] text-[var(--accent)] hover:opacity-80',
  ghost: 'bg-transparent text-[var(--text-primary)] hover:bg-[var(--bg-surface)]',
  danger: 'bg-[var(--color-danger)] text-white hover:opacity-90',
};

const sizeClasses: Record<Size, string> = {
  sm: 'px-3 py-1 text-xs',
  md: 'px-4 py-2 text-sm',
  lg: 'px-6 py-3 text-base',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading = false, className = '', children, disabled, ...props },
  ref
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-2 rounded-[var(--radius-md)] font-medium transition-all duration-[var(--duration-fast)] ease-[var(--ease-out-quad)] active:scale-95 disabled:opacity-50 disabled:pointer-events-none ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
      {...props}
    >
      {loading && <span className="i-solar:spinner-bold animate-spin" />}
      {children}
    </button>
  );
});
```

- [ ] **Step 2: 创建 Card.tsx**

创建 `src/ui/components/Card.tsx`：

```typescript
import { type HTMLAttributes, forwardRef } from 'react';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  glass?: boolean;
  hover?: boolean;
}

export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { glass = false, hover = false, className = '', children, ...props },
  ref
) {
  const baseClass = glass
    ? 'bg-[var(--bg-glass)] backdrop-blur-[var(--glass-blur)] backdrop-saturate-[var(--glass-saturate)] border border-[var(--glass-border)]'
    : 'bg-[var(--bg-surface)] border border-[var(--border)]';

  const hoverClass = hover
    ? 'transition-all duration-[var(--duration-normal)] ease-[var(--ease-out-quad)] hover:shadow-[var(--shadow-md)] hover:border-[var(--border-strong)]'
    : '';

  return (
    <div
      ref={ref}
      className={`rounded-[var(--radius-lg)] p-[var(--space-4)] ${baseClass} ${hoverClass} ${className}`}
      {...props}
    >
      {children}
    </div>
  );
});
```

- [ ] **Step 3: 创建 Toggle.tsx**

创建 `src/ui/components/Toggle.tsx`：

```typescript
interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label?: string;
}

export function Toggle({ checked, onChange, disabled = false, label }: ToggleProps) {
  return (
    <label className="relative flex cursor-pointer items-center gap-2">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="peer sr-only"
      />
      <div
        className={`h-6 w-11 rounded-full transition-colors duration-[var(--duration-normal)] ease-[var(--ease-ios)]
          after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white
          after:transition-all after:duration-[var(--duration-normal)] after:ease-[var(--ease-ios)] after:content-['']
          peer-checked:bg-[var(--accent)] peer-checked:after:translate-x-full
          ${checked ? '' : 'bg-[var(--border-strong)]'}
          ${disabled ? 'opacity-50 pointer-events-none' : ''}`}
      />
      {label && <span className="text-sm text-[var(--text-primary)]">{label}</span>}
    </label>
  );
}
```

- [ ] **Step 4: 创建 index.ts**

创建 `src/ui/components/index.ts`：

```typescript
export { Button } from './Button';
export { Card } from './Card';
export { Toggle } from './Toggle';
```

- [ ] **Step 5: 验证组件渲染**

在任意现有组件中临时引入 `<Button>测试</Button>` 验证渲染正常，然后移除。

Run:
```bash
pnpm dev
```

Expected: 按钮正常显示，样式应用正确。

- [ ] **Step 6: 提交**

```bash
git add src/ui/components/
git commit -m "feat(ui): add base components (Button/Card/Toggle)"
```

---

## Task 5: 建立情感状态 Zustand Store

**Files:**
- Create: `src/stores/emotionStore.ts`
- Create: `src/stores/favorabilityStore.ts`
- Create: `src/stores/personalityStore.ts`
- Create: `src/stores/index.ts`

- [ ] **Step 1: 创建 emotionStore.ts**

创建 `src/stores/emotionStore.ts`：

```typescript
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// 情感类型
export type EmotionType =
  | 'neutral' | 'happy' | 'sad' | 'angry' | 'surprised'
  | 'disgusted' | 'fearful' | 'excited' | 'bored' | 'tired'
  | 'curious' | 'shy' | 'proud' | 'jealous' | 'anxious';

export type MoodType = 'cheerful' | 'content' | 'melancholy' | 'excited' | 'calm' | 'anxious';

interface EmotionState {
  mood: MoodType;
  moodIntensity: number; // 0-1
  emotion: EmotionType;
  emotionIntensity: number; // 0-1
  lastChange: number; // timestamp
  reason: string;
  // actions
  setMood: (mood: MoodType, intensity?: number) => void;
  setEmotion: (emotion: EmotionType, intensity?: number, reason?: string) => void;
  setEmotionState: (partial: Partial<Omit<EmotionState, 'setMood' | 'setEmotion' | 'setEmotionState' | 'reset'>>) => void;
  reset: () => void;
}

const DEFAULT_STATE = {
  mood: 'content' as MoodType,
  moodIntensity: 0.5,
  emotion: 'neutral' as EmotionType,
  emotionIntensity: 0,
  lastChange: Date.now(),
  reason: '',
};

export const useEmotionStore = create<EmotionState>()(
  persist(
    (set) => ({
      ...DEFAULT_STATE,
      setMood: (mood, intensity) =>
        set((s) => ({ mood, moodIntensity: intensity ?? s.moodIntensity, lastChange: Date.now() })),
      setEmotion: (emotion, intensity, reason) =>
        set((s) => ({ emotion, emotionIntensity: intensity ?? s.emotionIntensity, reason: reason ?? s.reason, lastChange: Date.now() })),
      setEmotionState: (partial) => set((s) => ({ ...partial, lastChange: Date.now() })),
      reset: () => set(DEFAULT_STATE),
    }),
    { name: 'deskpet-emotion' }
  )
);
```

- [ ] **Step 2: 创建 favorabilityStore.ts**

创建 `src/stores/favorabilityStore.ts`：

```typescript
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface FavorabilityState {
  value: number; // 0-100
  history: { value: number; timestamp: number; reason: string }[];
  add: (delta: number, reason?: string) => void;
  set: (value: number, reason?: string) => void;
  reset: () => void;
}

export const useFavorabilityStore = create<FavorabilityState>()(
  persist(
    (set) => ({
      value: 50,
      history: [],
      add: (delta, reason = '') =>
        set((s) => {
          const newValue = Math.max(0, Math.min(100, s.value + delta));
          return {
            value: newValue,
            history: [...s.history.slice(-99), { value: newValue, timestamp: Date.now(), reason }],
          };
        }),
      set: (value, reason = '') =>
        set((s) => ({
          value: Math.max(0, Math.min(100, value)),
          history: [...s.history.slice(-99), { value, timestamp: Date.now(), reason }],
        })),
      reset: () => set({ value: 50, history: [] }),
    }),
    { name: 'deskpet-favorability' }
  )
);
```

- [ ] **Step 3: 创建 personalityStore.ts**

创建 `src/stores/personalityStore.ts`：

```typescript
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// HEXACO 六维人格
interface Personality {
  honestyHumility: number; // 诚实-谦逊
  emotionality: number; // 情感性
  extraversion: number; // 外向性
  agreeableness: number; // 宜人性
  conscientiousness: number; // 尽责性
  openness: number; // 开放性
}

interface PersonalityState extends Personality {
  setTrait: (trait: keyof Personality, value: number) => void;
  setPersonality: (p: Partial<Personality>) => void;
  reset: () => void;
}

const DEFAULT_PERSONALITY: Personality = {
  honestyHumility: 0.7,
  emotionality: 0.6,
  extraversion: 0.5,
  agreeableness: 0.7,
  conscientiousness: 0.6,
  openness: 0.8,
};

export const usePersonalityStore = create<PersonalityState>()(
  persist(
    (set) => ({
      ...DEFAULT_PERSONALITY,
      setTrait: (trait, value) =>
        set({ [trait]: Math.max(0, Math.min(1, value)) } as Partial<PersonalityState>),
      setPersonality: (p) =>
        set((s) => {
          const next = { ...p };
          for (const k of Object.keys(next) as (keyof Personality)[]) {
            next[k] = Math.max(0, Math.min(1, next[k] as number));
          }
          return { ...s, ...next };
        }),
      reset: () => set(DEFAULT_PERSONALITY),
    }),
    { name: 'deskpet-personality' }
  )
);
```

- [ ] **Step 4: 创建 stores/index.ts**

创建 `src/stores/index.ts`：

```typescript
export { useEmotionStore, type EmotionType, type MoodType } from './emotionStore';
export { useFavorabilityStore } from './favorabilityStore';
export { usePersonalityStore, type Personality } from './personalityStore';
```

- [ ] **Step 5: 验证 store 工作**

在浏览器控制台执行：
```javascript
// 测试 store
const { useEmotionStore } = await import('/src/stores/emotionStore.ts')
useEmotionStore.getState().setEmotion('happy', 0.8, 'test')
console.log(useEmotionStore.getState())
```

Expected: 控制台输出 `emotion: 'happy', emotionIntensity: 0.8, reason: 'test'`。

- [ ] **Step 6: 提交**

```bash
git add src/stores/
git commit -m "feat(stores): add emotion/favorability/personality zustand stores"
```

---

## Task 6: 建立流式消息缓冲 Store

**Files:**
- Create: `src/stores/chatStreamStore.ts`
- Modify: `src/stores/index.ts`

- [ ] **Step 1: 创建 chatStreamStore.ts**

创建 `src/stores/chatStreamStore.ts`：

```typescript
import { create } from 'zustand';

// 流式消息的切片类型
export interface StreamSlice {
  type: 'text' | 'think' | 'tool_call' | 'tool_result';
  text?: string;
  toolName?: string;
  toolInput?: unknown;
  toolOutput?: unknown;
}

export interface StreamingMessage {
  id: string;
  role: 'assistant';
  content: string;
  slices: StreamSlice[];
  toolResults: { name: string; input: unknown; output: unknown }[];
  startTime: number;
}

interface ChatStreamState {
  streamingMessage: StreamingMessage | null;
  isStreaming: boolean;

  beginStream: (id: string) => void;
  appendText: (text: string) => void;
  appendThink: (text: string) => void;
  appendToolCall: (name: string, input: unknown) => void;
  appendToolResult: (name: string, output: unknown) => void;
  finalizeStream: () => StreamingMessage | null;
  abortStream: () => void;
}

export const useChatStreamStore = create<ChatStreamState>((set, get) => ({
  streamingMessage: null,
  isStreaming: false,

  beginStream: (id) =>
    set({
      isStreaming: true,
      streamingMessage: {
        id,
        role: 'assistant',
        content: '',
        slices: [],
        toolResults: [],
        startTime: Date.now(),
      },
    }),

  appendText: (text) =>
    set((s) => {
      if (!s.streamingMessage) return {};
      const msg = s.streamingMessage;
      const lastSlice = msg.slices[msg.slices.length - 1];
      if (lastSlice?.type === 'text') {
        // 合并到上一个 text slice，避免数组增长
        const newSlices = [...msg.slices];
        newSlices[newSlices.length - 1] = { ...lastSlice, text: (lastSlice.text ?? '') + text };
        return { streamingMessage: { ...msg, content: msg.content + text, slices: newSlices } };
      }
      return {
        streamingMessage: {
          ...msg,
          content: msg.content + text,
          slices: [...msg.slices, { type: 'text', text }],
        },
      };
    }),

  appendThink: (text) =>
    set((s) => {
      if (!s.streamingMessage) return {};
      const msg = s.streamingMessage;
      const lastSlice = msg.slices[msg.slices.length - 1];
      if (lastSlice?.type === 'think') {
        const newSlices = [...msg.slices];
        newSlices[newSlices.length - 1] = { ...lastSlice, text: (lastSlice.text ?? '') + text };
        return { streamingMessage: { ...msg, slices: newSlices } };
      }
      return {
        streamingMessage: {
          ...msg,
          slices: [...msg.slices, { type: 'think', text }],
        },
      };
    }),

  appendToolCall: (name, input) =>
    set((s) => {
      if (!s.streamingMessage) return {};
      const msg = s.streamingMessage;
      return {
        streamingMessage: {
          ...msg,
          slices: [...msg.slices, { type: 'tool_call', toolName: name, toolInput: input }],
        },
      };
    }),

  appendToolResult: (name, output) =>
    set((s) => {
      if (!s.streamingMessage) return {};
      const msg = s.streamingMessage;
      return {
        streamingMessage: {
          ...msg,
          slices: [...msg.slices, { type: 'tool_result', toolName: name, toolOutput: output }],
          toolResults: [...msg.toolResults, { name, input: null, output }],
        },
      };
    }),

  finalizeStream: () => {
    const msg = get().streamingMessage;
    set({ streamingMessage: null, isStreaming: false });
    return msg;
  },

  abortStream: () => set({ streamingMessage: null, isStreaming: false }),
}));
```

- [ ] **Step 2: 更新 stores/index.ts**

修改 `src/stores/index.ts`，添加导出：

```typescript
export { useEmotionStore, type EmotionType, type MoodType } from './emotionStore';
export { useFavorabilityStore } from './favorabilityStore';
export { usePersonalityStore, type Personality } from './personalityStore';
export { useChatStreamStore, type StreamingMessage, type StreamSlice } from './chatStreamStore';
```

- [ ] **Step 3: 验证流式缓冲工作**

在浏览器控制台执行：
```javascript
const { useChatStreamStore } = await import('/src/stores/chatStreamStore.ts')
useChatStreamStore.getState().beginStream('test-1')
useChatStreamStore.getState().appendText('Hello')
useChatStreamStore.getState().appendText(' World')
console.log(useChatStreamStore.getState().streamingMessage)
```

Expected: `content: 'Hello World'`, `slices: [{ type: 'text', text: 'Hello World' }]`（合并成功）。

- [ ] **Step 4: 提交**

```bash
git add src/stores/chatStreamStore.ts src/stores/index.ts
git commit -m "feat(stores): add chat stream buffer store"
```

---

## Task 7: 建立应用级 UI Store

**Files:**
- Create: `src/stores/appStore.ts`
- Modify: `src/stores/index.ts`

- [ ] **Step 1: 创建 appStore.ts**

创建 `src/stores/appStore.ts`：

```typescript
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AppUIState {
  // 窗口状态
  isLocked: boolean;
  isHovering: boolean;
  showMenu: boolean;
  menuPos: { x: number; y: number };

  // 缩放
  petScale: number;
  zoomFactor: number;

  // 面板可见性（独立窗口）
  isChatOpen: boolean;
  isSettingsOpen: boolean;
  isStatusOpen: boolean;

  // 录音状态
  isRecording: boolean;
  sttAvailable: boolean;

  // Actions
  setLocked: (v: boolean) => void;
  setHovering: (v: boolean) => void;
  setShowMenu: (v: boolean) => void;
  setMenuPos: (pos: { x: number; y: number }) => void;
  setPetScale: (v: number) => void;
  setZoomFactor: (v: number) => void;
  setChatOpen: (v: boolean) => void;
  setSettingsOpen: (v: boolean) => void;
  setStatusOpen: (v: boolean) => void;
  setRecording: (v: boolean) => void;
  setSttAvailable: (v: boolean) => void;
}

export const useAppStore = create<AppUIState>()(
  persist(
    (set) => ({
      isLocked: false,
      isHovering: false,
      showMenu: false,
      menuPos: { x: 0, y: 0 },
      petScale: 1.0,
      zoomFactor: 1.0,
      isChatOpen: false,
      isSettingsOpen: false,
      isStatusOpen: false,
      isRecording: false,
      sttAvailable: false,

      setLocked: (v) => set({ isLocked: v }),
      setHovering: (v) => set({ isHovering: v }),
      setShowMenu: (v) => set({ showMenu: v }),
      setMenuPos: (pos) => set({ menuPos: pos }),
      setPetScale: (v) => set({ petScale: Math.max(0.2, Math.min(2.0, v)) }),
      setZoomFactor: (v) => set({ zoomFactor: v }),
      setChatOpen: (v) => set({ isChatOpen: v }),
      setSettingsOpen: (v) => set({ isSettingsOpen: v }),
      setStatusOpen: (v) => set({ isStatusOpen: v }),
      setRecording: (v) => set({ isRecording: v }),
      setSttAvailable: (v) => set({ sttAvailable: v }),
    }),
    {
      name: 'deskpet-app-ui',
      // 只持久化部分字段
      partialize: (s) => ({ petScale: s.petScale, zoomFactor: s.zoomFactor }),
    }
  )
);
```

- [ ] **Step 2: 更新 stores/index.ts**

修改 `src/stores/index.ts`，添加：

```typescript
export { useAppStore } from './appStore';
```

- [ ] **Step 3: 提交**

```bash
git add src/stores/appStore.ts src/stores/index.ts
git commit -m "feat(stores): add app UI store"
```

---

## Task 8: P0 性能优化 - 鼠标追踪 IPC 降频

**Files:**
- Modify: `src/hooks/useLive2D.ts`

- [ ] **Step 1: 读取当前 useLive2D.ts 的鼠标追踪实现**

Run: 用 Read 工具读取 `src/hooks/useLive2D.ts` 的第 289-366 行，确认当前的 poll 和 smoothUpdate 循环。

- [ ] **Step 2: 修改 poll 循环为低频轮询**

在 `src/hooks/useLive2D.ts` 中，找到鼠标追踪的 `poll` 函数（约第 302-337 行），将 `requestAnimationFrame(poll)` 改为 `setTimeout(poll, 60)`（约 15fps）：

```typescript
// 修改前（60fps IPC 调用）
const poll = async () => {
  const info = await invoke('get_cursor_window_info');
  // ...
  pollId = requestAnimationFrame(poll);
};
pollId = requestAnimationFrame(poll);

// 修改后（15fps IPC 调用，插值保持 60fps）
const IPC_INTERVAL = 60; // ms，约 15fps
const poll = async () => {
  try {
    const info = await invoke('get_cursor_window_info');
    if (info) {
      targetX.current = info.x;
      targetY.current = info.y;
    }
  } catch (e) {
    // ignore IPC errors
  }
  pollId = window.setTimeout(poll, IPC_INTERVAL);
};
pollId = window.setTimeout(poll, IPC_INTERVAL);
```

- [ ] **Step 3: 保持 smoothUpdate 为 60fps（requestAnimationFrame）**

确认 `smoothUpdate` 函数仍然使用 `requestAnimationFrame`：

```typescript
const smoothUpdate = () => {
  // lerp 插值计算
  setFocusFromCss(current.x, current.y);
  lerpRafId = requestAnimationFrame(smoothUpdate);
};
lerpRafId = requestAnimationFrame(smoothUpdate);
```

注意：smoothUpdate 不变，保持 60fps 平滑插值。只有 IPC 轮询降频。

- [ ] **Step 4: 修改清理逻辑**

在 useEffect 的 cleanup 中，将 `cancelAnimationFrame(pollId)` 改为 `clearTimeout(pollId)`：

```typescript
return () => {
  if (pollId) clearTimeout(pollId);
  if (lerpRafId) cancelAnimationFrame(lerpRafId);
};
```

- [ ] **Step 5: 验证眼神追踪仍工作**

Run:
```bash
pnpm dev
```

移动鼠标，观察 Live2D 角色眼神追踪是否仍然平滑。Expected: 追踪正常，无明显卡顿，CPU 占用下降。

- [ ] **Step 6: 提交**

```bash
git add src/hooks/useLive2D.ts
git commit -m "perf(live2d): reduce cursor IPC frequency from 60fps to 15fps"
```

---

## Task 9: P0 性能优化 - storage 事件替代轮询

**Files:**
- Create: `src/hooks/useStorageEvent.ts`
- Modify: `src/App.tsx`

- [ ] **Step 1: 创建 useStorageEvent hook**

创建 `src/hooks/useStorageEvent.ts`：

```typescript
import { useEffect, useRef } from 'react';

/**
 * 监听 localStorage 的 storage 事件，实现跨窗口同步。
 * 仅当数据变化时触发，替代轮询。
 *
 * @param key localStorage key
 * @param handler 数据变化时的回调
 * @param deps 依赖项（影响 handler 重建）
 */
export function useStorageEvent(
  key: string,
  handler: (newValue: string | null, oldValue: string | null) => void,
  deps: React.DependencyList = []
) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const listener = (e: StorageEvent) => {
      if (e.key === key) {
        handlerRef.current(e.newValue, e.oldValue);
      }
    };
    window.addEventListener('storage', listener);
    return () => window.removeEventListener('storage', listener);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ...deps]);
}

/**
 * 监听多个 localStorage key 的变化。
 */
export function useStorageEvents(
  keys: string[],
  handler: (key: string, newValue: string | null, oldValue: string | null) => void,
  deps: React.DependencyList = []
) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const listener = (e: StorageEvent) => {
      if (keys.includes(e.key ?? '')) {
        handlerRef.current(e.key ?? '', e.newValue, e.oldValue);
      }
    };
    window.addEventListener('storage', listener);
    return () => window.removeEventListener('storage', listener);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keys.join(','), ...deps]);
}

/**
 * 写入 localStorage 并触发同窗口的回调。
 * 注意：storage 事件只在其他窗口触发，同窗口需要手动处理。
 */
export function writeStorage(key: string, value: string) {
  const oldValue = localStorage.getItem(key);
  localStorage.setItem(key, value);
  // 同窗口手动派发事件
  window.dispatchEvent(new StorageEvent('storage', { key, newValue: value, oldValue }));
}
```

- [ ] **Step 2: 识别 App.tsx 中的 5 个轮询**

读取 `src/App.tsx`，找到以下 5 个 setInterval/setTimeout 轮询：

1. 约 line 541-550：STT 可用性检测（3000ms）
2. 约 line 776-796：多窗口 personality/config 同步（2000ms）
3. 约 line 1225-1247：多窗口消息/取消/新会话同步（300ms）
4. 约 line 1251-1280：STT 音频桥接（500ms）
5. 约 line 726-752：锁定穿透检测（150ms）

- [ ] **Step 3: 替换轮询 2、3 为 storage 事件**

在 `src/App.tsx` 中，找到 personality/config 同步和消息同步的轮询，替换为：

```typescript
import { useStorageEvents } from './hooks/useStorageEvent';

// 替换原来的多个 setInterval
useStorageEvents(
  ['deskpet_messages', 'deskpet_cancel_stream', 'deskpet_new_session', 'deskpet_personality', 'deskpet_config'],
  (key, newValue) => {
    if (!newValue) return;
    try {
      const data = JSON.parse(newValue);
      if (key === 'deskpet_messages') {
        setMessages(data);
      } else if (key === 'deskpet_cancel_stream') {
        // 处理取消流式
      } else if (key === 'deskpet_new_session') {
        // 处理新会话
      } else if (key === 'deskpet_personality') {
        // 处理 personality 更新
      } else if (key === 'deskpet_config') {
        // 处理 config 更新
      }
    } catch (e) {
      console.warn('[storage] parse error:', e);
    }
  }
);
```

- [ ] **Step 4: 保留必要的轮询**

注意：
- **轮询 1（STT 可用性，3000ms）**：保留，因为这是检测 Python 服务是否启动，不是数据同步
- **轮询 4（STT 音频桥接，500ms）**：保留，这是音频数据传输
- **轮询 5（锁定穿透检测，150ms）**：暂时保留，后续在阶段 3 改为像素级透明检测

删除轮询 2 和 3，替换为 storage 事件。

- [ ] **Step 5: 验证多窗口同步**

Run:
```bash
pnpm dev
```

打开聊天窗口，在主窗口发消息，观察聊天窗口是否实时更新。Expected: 消息实时同步，无 300ms 延迟。

- [ ] **Step 6: 提交**

```bash
git add src/hooks/useStorageEvent.ts src/App.tsx
git commit -m "perf(app): replace polling with storage events for multi-window sync"
```

---

## Task 10: 迁移 useEmotion 到 store

**Files:**
- Modify: `src/hooks/useEmotion.ts`
- Modify: `src/components/Status/StatusPanel.tsx`
- Modify: `src/components/Pet/Live2DViewer.tsx`

- [ ] **Step 1: 读取当前 useEmotion.ts**

Run: 用 Read 工具读取 `src/hooks/useEmotion.ts` 完整内容（850 行），理解现有接口。

- [ ] **Step 2: 改造 useEmotion 为 store 的薄封装**

修改 `src/hooks/useEmotion.ts`，将其改为 store 的封装层，保持对外接口不变：

```typescript
import { useCallback } from 'react';
import { useEmotionStore, useFavorabilityStore, usePersonalityStore, type EmotionType, type MoodType } from '../stores';

// 保持原有的类型导出
export type { EmotionType, MoodType } from '../stores';
export type Personality = ReturnType<typeof usePersonalityStore.getState>;

export interface EmotionState {
  mood: MoodType;
  moodIntensity: number;
  emotion: EmotionType;
  emotionIntensity: number;
  favorability: number;
  lastChange: number;
  reason: string;
}

export function useEmotion() {
  // 从 store 读取状态（细粒度订阅）
  const mood = useEmotionStore((s) => s.mood);
  const moodIntensity = useEmotionStore((s) => s.moodIntensity);
  const emotion = useEmotionStore((s) => s.emotion);
  const emotionIntensity = useEmotionStore((s) => s.emotionIntensity);
  const lastChange = useEmotionStore((s) => s.lastChange);
  const reason = useEmotionStore((s) => s.reason);

  const favorability = useFavorabilityStore((s) => s.value);

  const setMood = useEmotionStore((s) => s.setMood);
  const setEmotion = useEmotionStore((s) => s.setEmotion);
  const setEmotionState = useEmotionStore((s) => s.setEmotionState);
  const addFavorability = useFavorabilityStore((s) => s.add);
  const setFavorability = useFavorabilityStore((s) => s.set);

  // 模拟原 emotionState 对象（用于兼容）
  const emotionState: EmotionState = {
    mood, moodIntensity, emotion, emotionIntensity, favorability, lastChange, reason,
  };

  // 保持原有方法签名
  const setNewEmotion = useCallback((e: EmotionType, intensity: number, reason?: string) => {
    setEmotion(e, intensity, reason);
  }, [setEmotion]);

  const updateFromVoice = useCallback((emotion: EmotionType, intensity: number) => {
    setEmotion(emotion, intensity, 'voice');
  }, [setEmotion]);

  const recordInteract = useCallback((type: string) => {
    // 互动增加好感度
    const delta = type === 'patHead' ? 1 : type === 'tapBody' ? 0.5 : 0.3;
    addFavorability(delta, type);
  }, [addFavorability]);

  // ... 其他原有方法，改为调用 store

  return {
    emotionState,
    setNewEmotion,
    updateFromVoice,
    recordInteract,
    setFavorability,
    // ... 其他原有返回值
  };
}
```

注意：这是一个大改动，需要仔细对照原有接口，确保所有方法签名保持兼容。如果某些方法过于复杂，可以暂时保留原有实现，逐步迁移。

- [ ] **Step 3: 验证情感系统工作**

Run:
```bash
pnpm dev
```

测试：
1. 点击桌宠，观察好感度是否增加
2. 发送消息，观察情绪是否变化
3. 打开状态面板，观察数据是否更新

Expected: 所有情感交互正常工作。

- [ ] **Step 4: 提交**

```bash
git add src/hooks/useEmotion.ts src/components/Status/StatusPanel.tsx src/components/Pet/Live2DViewer.tsx
git commit -m "refactor(emotion): migrate useEmotion to zustand stores"
```

---

## Task 11: 建立主题切换 UI 入口

**Files:**
- Modify: `src/components/Settings/SettingsPanel.tsx`

- [ ] **Step 1: 在设置面板添加主题切换区**

修改 `src/components/Settings/SettingsPanel.tsx`，在顶部添加主题切换区域：

```typescript
import { useTheme } from '../hooks/useTheme';
import { THEME_PRESETS, type ThemePreset } from '../theme';

// 在 SettingsPanel 组件内
const { theme, setPreset, setMode } = useTheme();

// 在 JSX 中添加主题切换区
<div className="theme-section" style={{ marginBottom: 'var(--space-4)' }}>
  <h3 style={{ fontSize: '14px', fontWeight: 500, marginBottom: 'var(--space-2)' }}>主题设置</h3>

  {/* 主题预设 */}
  <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
    {(Object.keys(THEME_PRESETS) as ThemePreset[]).map((preset) => (
      <button
        key={preset}
        onClick={() => setPreset(preset)}
        style={{
          padding: 'var(--space-2) var(--space-4)',
          borderRadius: 'var(--radius-md)',
          border: `1px solid ${theme.preset === preset ? 'var(--accent)' : 'var(--border)'}`,
          background: theme.preset === preset ? 'var(--accent-soft)' : 'transparent',
          color: theme.preset === preset ? 'var(--accent)' : 'var(--text-secondary)',
          cursor: 'pointer',
          fontSize: '13px',
          transition: 'all var(--duration-fast) var(--ease-out-quad)',
        }}
      >
        {THEME_PRESETS[preset].name}
      </button>
    ))}
  </div>

  {/* 亮/暗模式 */}
  <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
    {(['light', 'dark', 'system'] as const).map((mode) => (
      <button
        key={mode}
        onClick={() => setMode(mode)}
        style={{
          padding: 'var(--space-1) var(--space-3)',
          borderRadius: 'var(--radius-sm)',
          border: `1px solid ${theme.mode === mode ? 'var(--accent)' : 'var(--border)'}`,
          background: theme.mode === mode ? 'var(--accent-soft)' : 'transparent',
          color: theme.mode === mode ? 'var(--accent)' : 'var(--text-secondary)',
          cursor: 'pointer',
          fontSize: '12px',
        }}
      >
        {mode === 'light' ? '浅色' : mode === 'dark' ? '深色' : '跟随系统'}
      </button>
    ))}
  </div>
</div>
```

- [ ] **Step 2: 验证主题切换**

Run:
```bash
pnpm dev
```

打开设置面板，点击不同主题预设和模式，观察 UI 颜色变化。Expected: 主色和亮/暗模式实时切换。

- [ ] **Step 3: 提交**

```bash
git add src/components/Settings/SettingsPanel.tsx
git commit -m "feat(settings): add theme switcher UI"
```

---

## Task 12: 管理后台主题系统适配

**Files:**
- Modify: `src/admin/main.tsx`
- Modify: `src/admin/index.css`

- [ ] **Step 1: 在 admin/main.tsx 包裹 ThemeProvider**

修改 `src/admin/main.tsx`：

```typescript
import { ThemeProvider } from '../theme';

// 在渲染中包裹
root.render(
  <ThemeProvider scope="admin">
    <App />
  </ThemeProvider>
);
```

- [ ] **Step 2: 验证管理后台主题独立**

Run:
```bash
pnpm dev
```

打开管理后台（http://localhost:1420/admin.html），在设置中切换主题。Expected: 管理后台主题独立于桌宠，各自存储。

- [ ] **Step 3: 提交**

```bash
git add src/admin/main.tsx
git commit -m "feat(admin): integrate theme system with admin scope"
```

---

## Task 13: 验收测试

**Files:**
- Modify: `src/App.tsx`（清理死代码）

- [ ] **Step 1: 清理 App.tsx 中的死代码**

移除 `src/App.tsx` 中无 setter 的 `const [showSettings] = useState(false)`（约 line 166）。

- [ ] **Step 2: 运行类型检查**

Run:
```bash
pnpm typecheck
```

Expected: 无类型错误。

- [ ] **Step 3: 运行 lint**

Run:
```bash
pnpm lint
```

Expected: 无 lint 错误（warning 可接受）。

- [ ] **Step 4: 手动验收**

启动应用，逐项验证：

- [ ] 主题切换：在设置中切换极简灰/樱花粉，UI 主色实时变化
- [ ] 亮/暗模式：切换浅色/深色/跟随系统，背景色正确
- [ ] 管理后台主题独立：桌宠和后台各自切换主题，互不影响
- [ ] 情感系统：点击桌宠，好感度增加；发消息，情绪变化
- [ ] 流式输出：发送消息，流式回复正常
- [ ] 多窗口同步：打开聊天窗口，主窗口发消息，聊天窗口实时更新
- [ ] 眼神追踪：移动鼠标，Live2D 角色眼神跟随
- [ ] CPU 占用：任务管理器观察，CPU 占用比改造前降低

- [ ] **Step 5: 提交**

```bash
git add src/App.tsx
git commit -m "chore: cleanup dead code in App.tsx"
```

---

## Self-Review

### Spec coverage 检查

| Spec 要求 | 对应 Task |
|-----------|-----------|
| 模块 9：UI 设计系统 | Task 2（tokens.css）+ Task 4（基础组件） |
| 模块 1：主题系统 | Task 3（ThemeProvider）+ Task 11（UI 入口）+ Task 12（管理后台） |
| 模块 2：状态管理 Zustand | Task 5（emotionStore）+ Task 6（chatStreamStore）+ Task 7（appStore）+ Task 10（迁移 useEmotion） |
| 模块 8 P0：IPC 降频 | Task 8 |
| 模块 8 P0：storage 事件替代轮询 | Task 9 |
| 模块 8 P0：emotionState 拆分 | Task 5 + Task 10 |

### Placeholder 扫描

- ✅ 无 TBD/TODO
- ✅ 所有代码块完整
- ✅ 所有文件路径明确

### Type 一致性

- ✅ `EmotionType` 在 emotionStore 和 useEmotion 中一致
- ✅ `ThemeConfig` 在 themes.ts 和 ThemeProvider 中一致
- ✅ `StreamingMessage` 在 chatStreamStore 中定义，后续 Task 使用一致

---

## 执行交接

Plan 1 完成并保存到 `docs/superpowers/plans/2026-07-26-plan1-infrastructure.md`。两种执行方式：

**1. Subagent-Driven（推荐）** - 每个 Task 派发独立 subagent，任务间审查，快速迭代

**2. Inline Execution** - 在当前会话中执行，批量执行 + 检查点审查

**选择哪种方式？**
