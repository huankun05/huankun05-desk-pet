import { useThemeContext } from '../theme';

// 便捷 hook，等价于 useThemeContext
export function useTheme() {
  return useThemeContext();
}
