/**
 * The theme model + hook. Lives in its own module (not the theme barrel) so sibling modules like
 * useThemedStyles can import useTheme WITHOUT importing the barrel — the barrel re-exports both, and
 * a submodule importing the barrel that re-exports it back is an import cycle. The barrel only
 * re-exports; it never defines a symbol a sibling imports.
 */
import { useMemo } from 'react';
import { useColorScheme } from 'react-native';
import { useAppStore } from '../stores/appStore';
import {
  COLORS_LIGHT,
  COLORS_DARK,
  SHADOWS_LIGHT,
  SHADOWS_DARK,
  createElevation,
} from './palettes';
import type { ThemeShadows } from './palettes';


export interface Theme {
  colors: typeof COLORS_LIGHT;
  shadows: ThemeShadows;
  elevation: ReturnType<typeof createElevation>;
  isDark: boolean;
}

/** Get theme for a given mode (non-hook, for use outside components) */
export function getTheme(mode: 'light' | 'dark'): Theme {
  const isDark = mode === 'dark';
  const colors = isDark ? COLORS_DARK : COLORS_LIGHT;
  const shadows = isDark ? SHADOWS_DARK : SHADOWS_LIGHT;
  const elevation = createElevation(colors);
  return { colors, shadows, elevation, isDark };
}

/** Hook that returns the current theme based on appStore themeMode */
export function useTheme(): Theme {
  const themeMode = useAppStore((s) => s.themeMode);
  const systemScheme = useColorScheme();
  let resolvedMode: 'light' | 'dark';
  if (themeMode === 'system') {
    resolvedMode = systemScheme === 'dark' ? 'dark' : 'light';
  } else {
    resolvedMode = themeMode;
  }
  return useMemo(() => getTheme(resolvedMode), [resolvedMode]);
}
