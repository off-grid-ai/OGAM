import { StyleSheet } from 'react-native';
import type { ThemeColors } from '../theme';
import { TYPOGRAPHY, SPACING } from '../constants';

export const createStyles = (colors: ThemeColors) => StyleSheet.create({
  bar: {
    position: 'absolute', left: SPACING.lg, right: SPACING.lg,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 4,
    paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm,
  },
  text: { ...TYPOGRAPHY.body, color: colors.text, flex: 1, marginRight: SPACING.md },
  undo: { ...TYPOGRAPHY.label, color: colors.primary, letterSpacing: 1, paddingVertical: SPACING.xs },
});
