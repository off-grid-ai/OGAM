import type { ThemeColors, ThemeShadows } from '../theme';
import { TYPOGRAPHY, SPACING } from '../constants';

export const createStyles = (colors: ThemeColors, _shadows: ThemeShadows) => ({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.md,
    borderBottomWidth: 0.5,
    borderBottomColor: colors.borderLight,
  },
  backButton: {
    padding: SPACING.xs,
    marginRight: SPACING.md,
  },
  headerCenter: {
    flex: 1,
  },
  headerTitle: {
    ...TYPOGRAPHY.h2,
    color: colors.text,
    fontWeight: '500' as const,
  },
  addButton: {
    padding: SPACING.sm,
  },
  errorCard: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    gap: SPACING.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.error,
  },
  errorTextWrap: {
    flex: 1,
  },
  errorTitle: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.text,
  },
  errorMessage: {
    ...TYPOGRAPHY.labelSmall,
    color: colors.textSecondary,
    marginTop: 2,
  },
  errorRetry: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 6,
  },
  errorRetryText: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.primary,
    fontWeight: '400' as const,
  },
  centered: {
    flex: 1,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    paddingHorizontal: SPACING.xxl,
  },
  emptyText: {
    ...TYPOGRAPHY.h3,
    color: colors.text,
    marginTop: SPACING.md,
  },
  emptySubtext: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textMuted,
    marginTop: SPACING.xs,
    marginBottom: SPACING.lg,
  },
  addFirstButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    borderRadius: 6,
  },
  addFirstButtonText: {
    ...TYPOGRAPHY.body,
    color: colors.surface,
    fontWeight: '500' as const,
  },
  listContent: {
    paddingBottom: SPACING.xxl,
  },
  list: {
    flex: 1,
  },
  transferIcon: {
    marginRight: SPACING.sm,
  },
});