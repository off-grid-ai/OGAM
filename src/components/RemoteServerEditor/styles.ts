import type { ThemeColors, ThemeShadows } from '../../theme/palettes';
import { SPACING, TYPOGRAPHY } from '../../constants';

/**
 * The full-screen server editor, on the same tokens as the rest of the app.
 *
 * This file named no token at all before: fourteen hardcoded font sizes with no family, seven
 * weights of 500 or 600 against a bar of 400, and about thirty magic spacings. So the sheet drew
 * itself in the platform sans, heavier than anything around it, and read as another product's
 * form. Fields are bordered now, the way every other surface here is, rather than filled slabs
 * with a 12pt radius.
 */
export function createStyles(colors: ThemeColors, _shadows: ThemeShadows) {
  return {
    screen: {
      flex: 1,
      backgroundColor: colors.background,
    },
    container: {
      flex: 1,
    },
    content: {
      // The 24 pt gutter every pushed screen uses; 16 put the fields almost at the glass edge.
      paddingHorizontal: SPACING.xl,
      paddingVertical: SPACING.lg,
      paddingBottom: SPACING.xxl,
    },

    /* Field labels are the terminal's small uppercase key, not a heavier version of the value. */
    label: {
      ...TYPOGRAPHY.label,
      textTransform: 'uppercase' as const,
      color: colors.textMuted,
      marginBottom: SPACING.sm,
      // Room above each label so it does not read as the end of the help text before it.
      marginTop: SPACING.xl,
    },
    input: {
      ...TYPOGRAPHY.body,
      color: colors.text,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.md,
    },
    inputError: {
      borderColor: colors.error,
    },
    errorText: {
      ...TYPOGRAPHY.meta,
      color: colors.error,
      marginTop: SPACING.xs,
    },

    warningContainer: {
      flexDirection: 'row' as const,
      alignItems: 'flex-start' as const,
      gap: SPACING.sm,
      borderWidth: 1,
      borderColor: colors.error,
      borderRadius: 8,
      padding: SPACING.md,
      marginTop: SPACING.md,
    },
    warningIcon: {
      marginTop: 1,
    },
    warningText: {
      ...TYPOGRAPHY.bodySmall,
      color: colors.error,
      flex: 1,
      lineHeight: 18,
    },

    helperText: {
      ...TYPOGRAPHY.bodySmall,
      color: colors.textMuted,
      marginTop: SPACING.sm,
      lineHeight: 18,
    },

    buttonRow: {
      flexDirection: 'row' as const,
      gap: SPACING.sm,
      marginTop: SPACING.lg,
    },
    buttonHalf: {
      flex: 1,
    },

    modelList: {
      marginTop: SPACING.sm,
    },
    modelScroll: {
      maxHeight: 81,
    },
    modelItem: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 4,
      paddingVertical: SPACING.xs,
      paddingHorizontal: SPACING.sm,
      marginBottom: SPACING.xs,
    },
    modelName: {
      ...TYPOGRAPHY.meta,
      color: colors.text,
    },

    statusContainer: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: SPACING.sm,
      marginTop: SPACING.md,
    },
    statusDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
    },
    statusDotSuccess: {
      backgroundColor: colors.success,
    },
    statusDotError: {
      backgroundColor: colors.error,
    },
    statusText: {
      ...TYPOGRAPHY.meta,
      color: colors.textSecondary,
      flex: 1,
    },

    sectionHeader: {
      ...TYPOGRAPHY.label,
      textTransform: 'uppercase' as const,
      color: colors.textMuted,
      marginTop: SPACING.xl,
      marginBottom: SPACING.xs,
    },
    notesInput: {
      minHeight: 80,
      textAlignVertical: 'top' as const,
    },
    apiKeyContainer: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: SPACING.sm,
    },
    apiKeyInput: {
      flex: 1,
    },
    apiKeyToggle: {
      padding: SPACING.md,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
    },
  };
}
