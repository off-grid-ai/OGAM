import { StyleSheet } from 'react-native';
import { COLORS_DARK, type ThemeColors } from './palettes';

/**
 * The card's fill alone, for a row or chip that draws its own surface without the card's edge.
 * Glass: the living field shows through (Mac, 2026-11-06: "the transparent glass thing much much
 * better ... more modern"). An opaque fill tried after hand test 65 read as flat; it was undone.
 */
export function cardFill(colors: ThemeColors): string {
  return colors.surfaceGlass;
}

/**
 * A card is a sheet laid on the page: a faint top highlight, and a small, soft, wide shadow under it,
 * so cards read as paper stacked on the field, not as outlines drawn on it (Mac, 2026-11-19: "think
 * material design concepts where everything is a paper stacked on each other"). Inside the brand's
 * bar: soft and wide, never hard or dark-edged, at most a small shadow. On the dark field a shadow
 * barely shows, so the lift comes from the brighter top edge (layers of light).
 */
export function cardLift(colors: ThemeColors): string {
  return colors.background === COLORS_DARK.background
    ? 'inset 0px 1px 0px rgba(255,255,255,0.09), 0px 6px 16px -6px rgba(0,0,0,0.7)'
    : 'inset 0px 1px 0px rgba(255,255,255,0.6), 0px 1px 2px 0px rgba(0,0,0,0.05), 0px 6px 16px -6px rgba(0,0,0,0.14)';
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
    boxShadow: cardLift(colors),
  };
}
