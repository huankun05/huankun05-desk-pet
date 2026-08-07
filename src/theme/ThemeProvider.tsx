import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
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

  const setPreset = useCallback(
    (preset: ThemePreset) => setTheme((p) => ({ ...p, preset, ...THEME_PRESETS[preset] })),
    [],
  );
  const setMode = useCallback((mode: ThemeMode) => setTheme((p) => ({ ...p, mode })), []);
  const setAccentHue = useCallback(
    (hue: number) => setTheme((p) => ({ ...p, preset: 'custom', accentHue: hue })),
    [],
  );
  const setAccentSaturation = useCallback(
    (sat: number) => setTheme((p) => ({ ...p, preset: 'custom', accentSaturation: sat })),
    [],
  );
  const resetTheme = useCallback(() => setTheme(DEFAULT_THEME), []);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      scope,
      setPreset,
      setMode,
      setAccentHue,
      setAccentSaturation,
      resetTheme,
    }),
    [theme, scope, setPreset, setMode, setAccentHue, setAccentSaturation, resetTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useThemeContext() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useThemeContext must be used within ThemeProvider');
  return ctx;
}
