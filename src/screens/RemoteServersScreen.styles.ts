import type { ThemeColors, ThemeShadows } from '../theme/palettes';
import { SPACING, TYPOGRAPHY } from '../constants';

export function createStyles(colors: ThemeColors, _shadows: ThemeShadows) {
  return {
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    header: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    backButton: {
      padding: 8,
      marginRight: 8,
    },
    title: {
      fontSize: 20,
      fontWeight: '600' as const,
      color: colors.text,
      flex: 1,
    },
    scrollView: {
      flex: 1,
    },
    content: {
      padding: 16,
    },
    emptyState: {
      alignItems: 'center' as const,
      paddingVertical: 40,
      gap: 12,
    },
    emptyIcon: {
      width: 64,
      height: 64,
      borderRadius: 32,
      backgroundColor: colors.surfaceLight,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
    },
    emptyTitle: {
      fontSize: 18,
      fontWeight: '600' as const,
      color: colors.text,
    },
    emptyText: {
      fontSize: 14,
      color: colors.textSecondary,
      textAlign: 'center' as const,
      paddingHorizontal: 32,
    },
    desktopLink: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: SPACING.sm,
      marginTop: SPACING.md,
      paddingVertical: SPACING.xs,
    },
    desktopLinkText: {
      ...TYPOGRAPHY.body,
      color: colors.primary,
    },
    serverItem: {
      backgroundColor: colors.surface,
      borderRadius: 12,
      padding: 16,
      marginBottom: 12,
    },
    serverHeader: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      justifyContent: 'space-between' as const,
    },
    serverInfo: {
      flex: 1,
    },
    serverName: {
      fontSize: 16,
      fontWeight: '600' as const,
      color: colors.text,
      marginBottom: 4,
    },
    serverEndpoint: {
      fontSize: 13,
      color: colors.textSecondary,
    },
    statusContainer: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      marginTop: 8,
      gap: 6,
    },
    statusDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
    },
    statusDotActive: {
      backgroundColor: colors.success,
    },
    statusDotInactive: {
      backgroundColor: colors.error,
    },
    statusDotUnknown: {
      backgroundColor: colors.textMuted,
    },
    statusText: {
      fontSize: 12,
      color: colors.textSecondary,
    },
    serverActions: {
      flexDirection: 'row' as const,
      marginTop: 12,
      gap: 8,
    },
    actionButton: {
      flex: 1,
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      paddingVertical: 8,
      paddingHorizontal: 12,
      borderRadius: 8,
      backgroundColor: colors.surfaceLight,
      gap: 6,
    },
    actionButtonText: {
      fontSize: 13,
      color: colors.text,
    },
    deleteButton: {
      backgroundColor: colors.errorBackground,
    },
    deleteButtonText: {
      color: colors.error,
    },
    selectButton: {
      padding: 8,
      borderRadius: 8,
      backgroundColor: colors.surfaceLight,
    },
    selectButtonActive: {
      backgroundColor: colors.primary,
    },
    addButton: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      backgroundColor: colors.primary,
      paddingVertical: 14,
      paddingHorizontal: 20,
      borderRadius: 12,
      marginTop: 16,
      gap: 8,
    },
    addButtonText: {
      fontSize: 16,
      fontWeight: '600' as const,
      color: colors.background,
    },
    scanButton: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      backgroundColor: colors.surfaceLight,
      paddingVertical: 14,
      paddingHorizontal: 20,
      borderRadius: 12,
      marginTop: 12,
      gap: 8,
    },
    scanButtonText: {
      fontSize: 16,
      fontWeight: '600' as const,
      color: colors.text,
    },
    infoCard: {
      backgroundColor: colors.surfaceLight,
      borderRadius: 12,
      padding: 16,
      marginTop: 16,
    },
    infoTitle: {
      fontSize: 14,
      fontWeight: '600' as const,
      color: colors.text,
      marginBottom: 8,
    },
    infoText: {
      fontSize: 13,
      color: colors.textSecondary,
      lineHeight: 20,
    },
  };
}
