import { StyleSheet } from 'react-native';
import type { ThemeColors } from './palettes';

// Desktop blurs what sits behind a card, so its glass hides the dot lattice. React Native has no
// cheap backdrop blur, so a 4% glass showed every dot through the text (hand test 65). Mostly
// opaque surface keeps the breathing light faintly and drops the dots.
const CARD_OPACITY = 0.9;

function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = [1, 3, 5].map(i => Number.parseInt(hex.slice(i, i + 2), 16));
  return `rgba(${r},${g},${b},${alpha})`;
}

/**
 * The one card surface: a hairline edge and a faint top highlight over a mostly opaque surface.
 * Card, ListGroup and Home's cards all use it, so they change together.
 */
export function cardSurface(colors: ThemeColors) {
  return {
    backgroundColor: colors.surface.startsWith('#') ? withAlpha(colors.surface, CARD_OPACITY) : colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderLight,
    borderRadius: 12,
    boxShadow: 'inset 0px 1px 0px rgba(255,255,255,0.06)',
  };
}
