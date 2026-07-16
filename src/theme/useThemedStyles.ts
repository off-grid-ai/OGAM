import { useMemo } from 'react';
import { StyleSheet } from 'react-native';
import { useTheme } from './useTheme';
import type { ThemeColors, ThemeShadows } from './palettes';

/**
 * Creates memoized StyleSheet from a factory that receives theme colors & shadows.
 * Re-computes only when the theme mode changes (light ↔ dark).
 *
 * Usage:
 *   const styles = useThemedStyles(createStyles);
 *   ...
 *   const createStyles = (colors: ThemeColors, shadows: ThemeShadows) => ({ ... });
 */
export function useThemedStyles<T extends StyleSheet.NamedStyles<T>>(
  factory: (colors: ThemeColors, shadows: ThemeShadows) => T,
): T {
  const { colors, shadows, isDark } = useTheme();
  return useMemo(
    () => StyleSheet.create(factory(colors, shadows)),

    [isDark],
  );
}
