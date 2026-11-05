// Colours come from @offgrid/design, the one token source desktop also reads; shadows are
// React Native's form of the same look and stay here.
import { COLORS_LIGHT, COLORS_DARK, type ThemeColors } from '@offgrid/design';

export { COLORS_LIGHT, COLORS_DARK };
export type { ThemeColors };

interface ShadowStyle {
  boxShadow: string;
}

export type ThemeShadows = {
  small: ShadowStyle;
  medium: ShadowStyle;
  large: ShadowStyle;
  glow: ShadowStyle;
  /** A shadow along the bottom edge only: a fixed bar that content scrolls under. */
  edge: ShadowStyle;
};



// ── Light shadows ────────────────────────────────────────────────────
// Uses CSS boxShadow (RN 0.76+ with New Architecture) for cross-platform
// shadow rendering. Works identically on iOS and Android.
export const SHADOWS_LIGHT: ThemeShadows = {
  small: {
    boxShadow: '0px 1px 8px 0px rgba(0,0,0,0.18)',
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
  edge: {
    boxShadow: '0px 6px 6px -6px rgba(0,0,0,0.22)',
  },
};

// ── Dark shadows (crisp white glow for depth) ───────────────────────
export const SHADOWS_DARK: ThemeShadows = {
  small: {
    boxShadow: '0px 0px 6px 0px rgba(255,255,255,0.18)',
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
  edge: {
    boxShadow: '0px 6px 6px -6px rgba(0,0,0,0.6)',
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
