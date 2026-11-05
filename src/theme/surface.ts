import { StyleSheet } from 'react-native';
import type { ThemeColors } from './palettes';

/**
 * The one card surface, as desktop draws it: the living field shows through, a hairline edge and a
 * faint top highlight. Card, ListGroup and Home's cards all use it, so they change together.
 */
export function cardSurface(colors: ThemeColors) {
  return {
    backgroundColor: colors.surfaceGlass,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderLight,
    borderRadius: 12,
    boxShadow: 'inset 0px 1px 0px rgba(255,255,255,0.06)',
  };
}
