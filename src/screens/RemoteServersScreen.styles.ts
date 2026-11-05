import type { ThemeColors, ThemeShadows } from '../theme/palettes';
import { SPACING, TYPOGRAPHY } from '../constants';

/**
 * Remote Servers, on the same tokens as the rest of the app.
 *
 * Every text style here used to carry a hardcoded fontSize and no fontFamily, so all of it
 * rendered in the platform sans while the app around it is Menlo - which is why the screen read
 * as belonging to a different product. TYPOGRAPHY tokens carry the family, so using them fixes
 * the typeface and the size at once. Cards use the shared surface, border, and subtle
 * elevation so this screen has the same depth as the other settings screens.
 */
export function createStyles(colors: ThemeColors, shadows: ThemeShadows) {
  const card = {
    padding: SPACING.md,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    ...shadows.small,
  };

  return {
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    scrollView: {
      flex: 1,
    },
    content: {
      padding: SPACING.lg,
      paddingBottom: SPACING.xxl,
      gap: SPACING.md,
    },

    /* What this screen gets you, before any control. */
    intro: {
      ...TYPOGRAPHY.bodySmall,
      color: colors.textSecondary,
      lineHeight: 20,
    },

    card,
    cardRow: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: SPACING.md,
    },
    cardTextCol: {
      flex: 1,
    },
    scanKindRow: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      justifyContent: 'space-between' as const,
      minHeight: 44,
      gap: SPACING.md,
    },
    cardTitle: {
      ...TYPOGRAPHY.h3,
      color: colors.text,
      marginBottom: SPACING.xs,
    },
    cardDesc: {
      ...TYPOGRAPHY.meta,
      color: colors.textSecondary,
      lineHeight: 15,
    },

    /* Scan and Add sit side by side: they are two ways to do one job, not a ranked pair. */
    actionRow: {
      flexDirection: 'row' as const,
      gap: SPACING.sm,
    },
    actionButton: {
      flex: 1,
    },
    /* What the scan actually did, in place, instead of a modal that has to be dismissed. */
    scanNote: {
      ...TYPOGRAPHY.meta,
      color: colors.textMuted,
      lineHeight: 15,
    },

    sectionLabel: {
      ...TYPOGRAPHY.label,
      textTransform: 'uppercase' as const,
      color: colors.textMuted,
      marginTop: SPACING.sm,
    },

    empty: {
      ...card,
      alignItems: 'center' as const,
      gap: SPACING.sm,
      paddingVertical: SPACING.xl,
    },
    emptyTitle: {
      ...TYPOGRAPHY.h3,
      color: colors.text,
    },
    emptyText: {
      ...TYPOGRAPHY.meta,
      color: colors.textSecondary,
      textAlign: 'center' as const,
      lineHeight: 16,
    },
    desktopLink: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: SPACING.sm,
      paddingVertical: SPACING.xs,
    },
    desktopLinkText: {
      ...TYPOGRAPHY.meta,
      color: colors.primary,
    },

    serverCard: {
      ...card,
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: SPACING.sm,
    },
    /* The one in use is marked by its border, so the list reads at a glance. */
    serverCardActive: {
      borderColor: colors.primary,
    },
    serverIdentity: {
      flex: 1,
      gap: SPACING.xs,
    },
    serverTopRow: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: SPACING.sm,
    },
    statusDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
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
    serverName: {
      ...TYPOGRAPHY.body,
      color: colors.text,
      flex: 1,
    },
    activeBadge: {
      ...TYPOGRAPHY.label,
      textTransform: 'uppercase' as const,
      color: colors.primary,
    },
    useHint: {
      ...TYPOGRAPHY.label,
      textTransform: 'uppercase' as const,
      color: colors.textMuted,
    },
    serverEndpoint: {
      ...TYPOGRAPHY.meta,
      color: colors.textSecondary,
    },
    serverStatus: {
      ...TYPOGRAPHY.meta,
      color: colors.textMuted,
    },

    // The row's actions sit on its right edge as icon buttons.
    serverActions: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: SPACING.xs,
    },
    serverAction: {
      width: 36,
      height: 36,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
    },
  };
}
