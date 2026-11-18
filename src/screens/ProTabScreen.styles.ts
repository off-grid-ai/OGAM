import { StyleSheet } from 'react-native';
import type { ThemeColors } from '../theme';
import { cardSurface } from '../theme/surface';
import { SPACING, TYPOGRAPHY } from '../constants';

/** The Pro tab's cards for Off Grid AI beyond this phone: Boost, the desktop app, the extension. */
export const createCardStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    cards: { flexDirection: 'row', gap: SPACING.sm, marginBottom: SPACING.lg },
    card: { ...cardSurface(colors), flex: 1, padding: SPACING.md, gap: SPACING.xs },
    title: { ...TYPOGRAPHY.body, color: colors.text },
    line: { ...TYPOGRAPHY.bodySmall, color: colors.textMuted },
  });
