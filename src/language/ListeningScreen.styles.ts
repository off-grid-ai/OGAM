import type { ThemeColors, ThemeShadows } from '../theme';
import { TYPOGRAPHY, SPACING } from '../constants';

export const createStyles = (colors: ThemeColors, _shadows: ThemeShadows) => ({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: SPACING.md,
    paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  backButton: { padding: SPACING.xs },
  title: { ...TYPOGRAPHY.h2, flex: 1, color: colors.text },
  content: { padding: SPACING.lg, paddingBottom: SPACING.xxl, gap: SPACING.md },
  body: { ...TYPOGRAPHY.body, color: colors.text },
  meta: { ...TYPOGRAPHY.meta, color: colors.textMuted, marginTop: SPACING.sm },
  error: { ...TYPOGRAPHY.bodySmall, color: colors.error },
  input: {
    ...TYPOGRAPHY.body, color: colors.text, borderWidth: 1, borderColor: colors.border, borderRadius: 10,
    padding: SPACING.md, marginVertical: SPACING.md,
  },
  progressRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: SPACING.md },
  line: { marginBottom: SPACING.md },
  speaker: { ...TYPOGRAPHY.label, color: colors.primary },
  target: { ...TYPOGRAPHY.h3, color: colors.text },
  english: { ...TYPOGRAPHY.bodySmall, color: colors.textSecondary },
  link: { ...TYPOGRAPHY.bodySmall, color: colors.primary, marginBottom: SPACING.md },
  question: { marginVertical: SPACING.md, gap: SPACING.xs },
  pieceText: { flex: 1 },
  word: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: SPACING.md, paddingVertical: SPACING.sm, borderTopWidth: 1, borderTopColor: colors.border },
});
