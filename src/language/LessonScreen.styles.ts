import type { ThemeColors, ThemeShadows } from '../theme';
import { TYPOGRAPHY, SPACING } from '../constants';

export const createStyles = (colors: ThemeColors, _shadows: ThemeShadows) => ({
  container: { flex: 1, backgroundColor: colors.background },
  top: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: SPACING.md, padding: SPACING.lg },
  bar: { flex: 1, height: 10, borderRadius: 5, backgroundColor: colors.surface, overflow: 'hidden' as const },
  barFill: { height: 10, borderRadius: 5, backgroundColor: colors.primary },
  body: { flexGrow: 1, padding: SPACING.lg, gap: SPACING.md },
  prompt: { ...TYPOGRAPHY.label, color: colors.textSecondary },
  big: { ...TYPOGRAPHY.h2, color: colors.text, flexShrink: 1, marginVertical: SPACING.xs },
  roman: { ...TYPOGRAPHY.body, color: colors.textMuted },
  sayRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: SPACING.md },
  // Text next to the play button wraps instead of running off the screen.
  sayText: { flex: 1, flexShrink: 1 },
  speaker: {
    width: 56, height: 56, borderRadius: 28, alignItems: 'center' as const, justifyContent: 'center' as const,
    backgroundColor: colors.primary,
  },
  columns: { flexDirection: 'row' as const, gap: SPACING.md },
  column: { flex: 1, flexShrink: 1, gap: SPACING.sm },
  tiles: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: SPACING.sm, minHeight: 52 },
  pool: { marginTop: SPACING.lg },
  typed: {
    ...TYPOGRAPHY.h3, color: colors.text, borderWidth: 1, borderColor: colors.border, borderRadius: 10,
    padding: SPACING.md, marginTop: SPACING.md,
  },
  bodyText: { ...TYPOGRAPHY.body, color: colors.text, marginVertical: SPACING.sm },
  tip: { ...TYPOGRAPHY.body, color: colors.text },
  answerLine: { borderBottomWidth: 1, borderBottomColor: colors.border, paddingBottom: SPACING.sm },
  selfRow: { flexDirection: 'row' as const, gap: SPACING.sm, marginTop: SPACING.sm },
  tile: { paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  tileText: { ...TYPOGRAPHY.body, color: colors.text, flexShrink: 1 },
  footer: { padding: SPACING.lg, gap: SPACING.sm, borderTopWidth: 1, borderTopColor: colors.border },
  feedback: { ...TYPOGRAPHY.body, color: colors.text },
  meta: { ...TYPOGRAPHY.meta, color: colors.textMuted },
  center: { flex: 1, alignItems: 'center' as const, justifyContent: 'center' as const, padding: SPACING.xl, gap: SPACING.md },
  starsRow: { flexDirection: 'row' as const, gap: SPACING.sm },
});
