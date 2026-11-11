import type { ThemeColors, ThemeShadows } from '../theme';
import { TYPOGRAPHY, SPACING } from '../constants';

export const createStyles = (colors: ThemeColors, _shadows: ThemeShadows) => ({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
    gap: SPACING.md,
  },
  backButton: { padding: SPACING.xs },
  title: { ...TYPOGRAPHY.h2, flex: 1, color: colors.text },
  content: { flex: 1, padding: SPACING.lg, gap: SPACING.md },
  label: { ...TYPOGRAPHY.label, color: colors.textSecondary },
  nameInput: {
    ...TYPOGRAPHY.body, color: colors.text, backgroundColor: colors.surface,
    borderRadius: 10, borderWidth: 1, borderColor: colors.border, padding: SPACING.md,
  },
  bodyInput: {
    ...TYPOGRAPHY.body, flex: 1, color: colors.text, backgroundColor: colors.surface,
    borderRadius: 10, borderWidth: 1, borderColor: colors.border, padding: SPACING.md,
    textAlignVertical: 'top' as const,
  },
  meta: { ...TYPOGRAPHY.meta, color: colors.textMuted },
  centered: { flex: 1, alignItems: 'center' as const, justifyContent: 'center' as const },
});
