import { useMemo } from 'react';
import { StyleSheet } from 'react-native';
import { useTheme } from './useTheme';
import type { ThemeColors, ThemeShadows } from './palettes';
import type { SkinShape } from './appearance';

/**
 * Applies a skin's shape to one style: corner radius scaled, borders at least as heavy as the skin wants, and a shadow on
 * boxes (a background with rounded corners). Pure, so it is tested without a device.
 */
export function reshapeStyle(style: Record<string, unknown>, shape: SkinShape, glow: string): Record<string, unknown> {
  const out: Record<string, unknown> = { ...style };
  const radius = style.borderRadius;
  if (typeof radius === 'number' && radius > 0 && shape.radius !== 1) out.borderRadius = Math.round(radius * shape.radius);
  if (shape.minBorder > 0 && typeof style.borderWidth === 'number' && style.borderWidth > 0 && style.borderWidth < shape.minBorder) out.borderWidth = shape.minBorder;
  const isBox = typeof radius === 'number' && radius >= 6 && radius < 100 && style.backgroundColor !== undefined && style.shadowOpacity === undefined;
  if (isBox && shape.shadow === 'soft') Object.assign(out, { shadowColor: '#000000', shadowOpacity: 0.2, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 3 });
  if (isBox && shape.shadow === 'glow') Object.assign(out, { shadowColor: glow, shadowOpacity: 0.7, shadowRadius: 8, shadowOffset: { width: 0, height: 0 }, elevation: 4 });
  return out;
}

/**
 * Creates memoized StyleSheet from a factory that receives theme colors & shadows.
 * Re-computes when the theme changes (light ↔ dark, palette, accent, font or text size).
 *
 * Usage:
 *   const styles = useThemedStyles(createStyles);
 *   ...
 *   const createStyles = (colors: ThemeColors, shadows: ThemeShadows) => ({ ... });
 */
export function useThemedStyles<T extends StyleSheet.NamedStyles<T>>(
  factory: (colors: ThemeColors, shadows: ThemeShadows) => T,
): T {
  const { colors, shadows, typographyKey, densityScale, shape } = useTheme();
  return useMemo(
    () => {
      const made = factory(colors, shadows);
      const plainShape = shape.radius === 1 && shape.minBorder === 0 && shape.shadow === 'none';
      const original = plainShape ? made : (Object.fromEntries(Object.entries(made).map(([name, value]) => [
        name, value && typeof value === 'object' && !Array.isArray(value) ? reshapeStyle(value as Record<string, unknown>, shape, colors.primary) : value,
      ])) as T);
      if (densityScale === 1) return StyleSheet.create(original);
      const compacted = Object.fromEntries(Object.entries(original).map(([name, value]) => {
        if (!value || typeof value !== 'object') return [name, value];
        const scaled = Object.fromEntries(Object.entries(value).map(([key, amount]) => [
          key, /^(padding|margin|gap$|rowGap$|columnGap$)/.test(key) && typeof amount === 'number'
            ? Math.round(amount * densityScale) : amount,
        ]));
        return [name, scaled];
      }));
      return StyleSheet.create(compacted as T);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- factory is a stable module-level function
    [colors, shadows, typographyKey, densityScale, shape],
  );
}
