/** The layout the three picks steps share: a full-screen scroll and a footer with one main action. */
import { FONTS, SPACING, TYPOGRAPHY } from '../../constants';
import type { ThemeColors, ThemeShadows } from '../../theme';

export const createPicksStyles = (
  colors: ThemeColors,
  _shadows: ThemeShadows,
) => ({
  container: { flex: 1, backgroundColor: colors.background },
  content: {
    paddingHorizontal: SPACING.xl,
    paddingTop: SPACING.xl,
    paddingBottom: SPACING.xl,
    gap: SPACING.sm,
  },
  eyebrow: {
    ...TYPOGRAPHY.label,
    fontFamily: FONTS.mono,
    textTransform: 'uppercase' as const,
    letterSpacing: 1.2,
    color: colors.textMuted,
  },
  title: { ...TYPOGRAPHY.h1, fontWeight: '300' as const, color: colors.text },
  description: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textSecondary,
    marginBottom: SPACING.md,
  },
  section: {
    ...TYPOGRAPHY.label,
    fontFamily: FONTS.mono,
    textTransform: 'uppercase' as const,
    letterSpacing: 1.2,
    color: colors.textMuted,
    marginTop: SPACING.lg,
  },
  group: { gap: SPACING.sm },
  offer: { gap: SPACING.sm, marginTop: SPACING.lg },
  note: { ...TYPOGRAPHY.bodySmall, color: colors.textSecondary },
  footer: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: SPACING.sm,
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.sm,
  },
  footerMain: { flex: 1 },
});
