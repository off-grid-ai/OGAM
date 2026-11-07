import { StyleSheet } from 'react-native';
import type { ThemeColors } from './palettes';

/**
 * The card's fill alone, for a row or chip that draws its own surface without the card's edge.
 * Glass: the living field shows through (Mac, 2026-11-06: "the transparent glass thing much much
 * better ... more modern"). An opaque fill tried after hand test 65 read as flat; it was undone.
 */
export function cardFill(colors: ThemeColors): string {
  return colors.surfaceGlass;
}

/**
 * The one card surface, glass as desktop draws it: the living field shows through, a hairline edge
 * and a faint top highlight.
 * Card, ListGroup and Home's cards all use it, so they change together.
 */
export function cardSurface(colors: ThemeColors) {
  return {
    backgroundColor: cardFill(colors),
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderLight,
    borderRadius: 12,
    boxShadow: 'inset 0px 1px 0px rgba(255,255,255,0.06)',
  };
}
