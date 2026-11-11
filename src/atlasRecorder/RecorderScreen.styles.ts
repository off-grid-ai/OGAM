import type { ThemeColors, ThemeShadows } from '../theme';
import { TYPOGRAPHY, SPACING } from '../constants';

export const createStyles = (colors: ThemeColors, _shadows: ThemeShadows) => ({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: SPACING.md,
    paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  backButton: { padding: SPACING.xs },
  title: { ...TYPOGRAPHY.h2, flex: 1, color: colors.text },
  content: { padding: SPACING.lg, paddingBottom: SPACING.xxl, gap: SPACING.md },
  body: { ...TYPOGRAPHY.body, color: colors.text },
  desc: { ...TYPOGRAPHY.bodySmall, color: colors.textSecondary, marginTop: SPACING.xs },
  meta: { ...TYPOGRAPHY.meta, color: colors.textMuted },
  error: { ...TYPOGRAPHY.bodySmall, color: colors.error, marginTop: SPACING.xs },
  actions: { marginTop: SPACING.md, gap: SPACING.sm },
  recordRow: { alignItems: 'center' as const, gap: SPACING.md, paddingVertical: SPACING.md },
  recordButton: {
    width: 88, height: 88, borderRadius: 44, alignItems: 'center' as const, justifyContent: 'center' as const,
    backgroundColor: colors.error,
  },
  indicator: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: SPACING.sm },
  dot: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.error },
  indicatorText: { ...TYPOGRAPHY.h3, color: colors.error },
  progressRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: SPACING.md, marginTop: SPACING.sm },
  progressText: { ...TYPOGRAPHY.body, color: colors.text, flex: 1 },
  row: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: SPACING.md,
    paddingVertical: SPACING.sm, borderTopWidth: 1, borderTopColor: colors.border,
  },
  rowText: { flex: 1 },
});
