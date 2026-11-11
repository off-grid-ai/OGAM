import type { ThemeColors, ThemeShadows } from '../theme';
import { TYPOGRAPHY, SPACING } from '../constants';
import { createStyles as recorderStyles } from './RecorderScreen.styles';

export const createStyles = (colors: ThemeColors, shadows: ThemeShadows) => ({
  ...recorderStyles(colors, shadows),
  titleInput: {
    ...TYPOGRAPHY.h3, color: colors.text, borderBottomWidth: 1, borderBottomColor: colors.border,
    paddingVertical: SPACING.xs,
  },
  nameInput: {
    ...TYPOGRAPHY.body, flex: 1, color: colors.text, borderWidth: 1, borderColor: colors.border,
    borderRadius: 8, paddingHorizontal: SPACING.sm, paddingVertical: SPACING.xs,
  },
  speakerRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: SPACING.sm, marginTop: SPACING.sm },
  speakerLabel: { ...TYPOGRAPHY.label, color: colors.primary },
  utterance: { paddingVertical: SPACING.sm, borderTopWidth: 1, borderTopColor: colors.border },
  utteranceHead: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: SPACING.sm },
  chips: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: SPACING.sm, marginTop: SPACING.sm },
  actions: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: SPACING.sm, marginTop: SPACING.md },
  chip: {
    paddingHorizontal: SPACING.md, paddingVertical: SPACING.xs + 2, borderRadius: 16,
    borderWidth: 1, borderColor: colors.border,
  },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { ...TYPOGRAPHY.bodySmall, color: colors.text },
  chipTextOn: { ...TYPOGRAPHY.bodySmall, color: colors.background },
});
