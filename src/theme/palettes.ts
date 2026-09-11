// Light and dark color palettes + shadow definitions

export type ThemeColors = typeof COLORS_LIGHT;

interface ShadowStyle {
  boxShadow: string;
}

export type ThemeShadows = {
  small: ShadowStyle;
  bottom: ShadowStyle;
  medium: ShadowStyle;
  large: ShadowStyle;
  glow: ShadowStyle;
};

// ── Light palette ──────────────────────────────────────────────────
export const COLORS_LIGHT = {
  // Primary accent
  primary: '#059669',
  primaryDark: '#047857',
  primaryLight: '#34D399',

  // Backgrounds
  background: '#FFFFFF',
  surface: '#F5F5F5',
  surfaceLight: '#EBEBEB',
  surfaceHover: '#E0E0E0',

  // Text hierarchy
  text: '#0A0A0A',
  textSecondary: '#525252',
  textMuted: '#8A8A8A',
  textDisabled: '#BFBFBF',

  // Borders
  border: '#E5E5E5',
  borderLight: '#D4D4D4',
  borderFocus: '#059669',

  // Semantic colors
  success: '#525252',
  warning: '#0A0A0A',
  error: '#DC2626',
  trending: '#D97706',
  errorBackground: 'rgba(220, 38, 38, 0.10)',
  info: '#525252',

  // Special
  overlay: 'rgba(0, 0, 0, 0.4)',
  divider: '#EBEBEB',
};

// ── Dark palette ───────────────────────────────────────────────────
export const COLORS_DARK = {
  // Primary accent
  primary: '#34D399',
  primaryDark: '#10B981',
  primaryLight: '#6EE7B7',

  // Backgrounds
  background: '#0A0A0A',
  surface: '#141414',
  surfaceLight: '#1E1E1E',
  surfaceHover: '#252525',

  // Text hierarchy
  text: '#FFFFFF',
  textSecondary: '#B0B0B0',
  textMuted: '#808080',
  textDisabled: '#4A4A4A',

  // Borders
  border: '#1E1E1E',
  borderLight: '#2A2A2A',
  borderFocus: '#34D399',

  // Semantic colors
  success: '#B0B0B0',
  warning: '#FFFFFF',
  error: '#C75050',
  trending: '#F59E0B',
  errorBackground: 'rgba(239, 68, 68, 0.15)',
  info: '#B0B0B0',

  // Special
  overlay: 'rgba(0, 0, 0, 0.7)',
  divider: '#1A1A1A',
};

// ── Light shadows ────────────────────────────────────────────────────
// Uses CSS boxShadow (RN 0.76+ with New Architecture) for cross-platform
// shadow rendering. Works identically on iOS and Android.
export const SHADOWS_LIGHT: ThemeShadows = {
  small: {
    boxShadow: '0px 1px 8px 0px rgba(0,0,0,0.18)',
  },
  bottom: {
    boxShadow: '0px 8px 8px -8px rgba(0,0,0,0.24)',
  },
  medium: {
    boxShadow: '0px 2px 10px 0px rgba(0,0,0,0.22)',
  },
  large: {
    boxShadow: '0px 4px 18px 0px rgba(0,0,0,0.35)',
  },
  glow: {
    boxShadow: '0px 0px 12px 0px rgba(5,150,105,0.25)',
  },
};

// ── Dark shadows (crisp white glow for depth) ───────────────────────
export const SHADOWS_DARK: ThemeShadows = {
  small: {
    boxShadow: '0px 0px 6px 0px rgba(255,255,255,0.18)',
  },
  bottom: {
    boxShadow: '0px 8px 8px -8px rgba(255,255,255,0.18)',
  },
  medium: {
    boxShadow: '0px 0px 6px 0px rgba(255,255,255,0.20)',
  },
  large: {
    boxShadow: '0px 0px 10px 0px rgba(255,255,255,0.25)',
  },
  glow: {
    boxShadow: '0px 0px 8px 0px rgba(52,211,153,0.30)',
  },
};

// ── Elevation factory ──────────────────────────────────────────────
export function createElevation(colors: ThemeColors) {
  return {
    level0: {
      backgroundColor: colors.background,
      borderWidth: 0,
      borderColor: 'transparent',
    },
    level1: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    level2: {
      backgroundColor: colors.surfaceLight,
      borderWidth: 1,
      borderColor: colors.borderLight,
    },
    level3: {
      backgroundColor: `${colors.surface}F2`,
      borderTopWidth: 1,
      borderColor: colors.borderLight,
      borderRadius: 16,
      blur: {
        ios: { blurAmount: 10, blurType: colors.background === '#0A0A0A' ? 'dark' : 'light' },
        android: { overlayColor: colors.overlay },
      },
    },
    level4: {
      backgroundColor: `${colors.surface}FA`,
      borderTopWidth: 1,
      borderColor: colors.primary,
      borderRadius: 16,
      blur: {
        ios: { blurAmount: 15, blurType: colors.background === '#0A0A0A' ? 'dark' : 'light' },
        android: { overlayColor: colors.overlay },
      },
    },
    handle: {
      width: 40,
      height: 4,
      backgroundColor: colors.textMuted,
      borderRadius: 2,
      alignSelf: 'center' as const,
    },
  } as const;
}
