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
import { applyAppearanceColors, applyTypography, shapeOf, type Appearance, type SkinShape } from './appearance';


export interface Theme {
  colors: typeof COLORS_LIGHT;
  shadows: ThemeShadows;
  elevation: ReturnType<typeof createElevation>;
  isDark: boolean;
  /** Font + text size in effect; part of the theme so themed styles rebuild when it changes. */
  typographyKey: string;
  densityScale: number;
  /** How round, how bordered and how shadowed boxes are (the chosen skin). */
  shape: SkinShape;
  /** Set when the person chose a background picture: `solid` is the colour screens would have had. */
  backdrop?: { uri: string; dim: number; solid: string };
}

/** Get theme for a given mode (non-hook, for use outside components) */
function shapeWith(appearance?: Appearance): SkinShape {
  const base = shapeOf(appearance?.skin);
  const r = appearance?.cornerRadius ?? appearance?.custom?.cornerRadius;
  return r === undefined ? base : { ...base, radius: r };
}

export function getTheme(mode: 'light' | 'dark', appearance?: Appearance): Theme {
  const isDark = mode === 'dark';
  const themed = applyAppearanceColors(isDark ? COLORS_DARK : COLORS_LIGHT, isDark, appearance);
  const bg = appearance?.backgroundImage;
  const colors = bg ? { ...themed, background: 'transparent' } : themed;
  const shadows = isDark ? SHADOWS_DARK : SHADOWS_LIGHT;
  const elevation = createElevation(colors);
  const typographyKey = applyTypography(appearance);
  const density = appearance?.density ?? (appearance?.layoutMode === 'compact' ? 'compact' : appearance?.layoutMode === 'simple' ? 'spacious' : 'comfortable');
  const densityScale = density === 'compact' ? 0.8 : density === 'spacious' ? 1.15 : 1;
  return { colors, shadows, elevation, isDark, typographyKey, densityScale, shape: shapeWith(appearance), ...(bg ? { backdrop: { uri: bg.uri, dim: Math.min(0.9, Math.max(0, bg.dim)), solid: themed.background } } : {}) };
}

/** Hook that returns the current theme based on appStore themeMode */
export function useTheme(): Theme {
  const themeMode = useAppStore((s) => s.themeMode);
  const appearance = useAppStore((s) => s.settings?.appearance);
  const systemScheme = useColorScheme();
  let resolvedMode: 'light' | 'dark';
  if (themeMode === 'system') {
    resolvedMode = systemScheme === 'dark' ? 'dark' : 'light';
  } else {
    resolvedMode = themeMode;
  }
  return useMemo(() => getTheme(resolvedMode, appearance), [resolvedMode, appearance]);
}
