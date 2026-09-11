import type { ThemeColors, ThemeShadows } from '../theme/palettes';
import { SPACING, TYPOGRAPHY } from '../constants';

/**
 * Remote Servers, on the same tokens as the rest of the app.
 *
 * Every text style here used to carry a hardcoded fontSize and no fontFamily, so all of it
 * rendered in the platform sans while the app around it is Menlo - which is why the screen read
 * as belonging to a different product. TYPOGRAPHY tokens carry the family, so using them fixes
 * the typeface and the size at once. Cards are the bordered kind the advice cards use (1px
 * border, radius 8, surface fill), not filled rounded slabs.
 */
export function createStyles(colors: ThemeColors, _shadows: ThemeShadows) {
  const card = {
    padding: SPACING.md,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
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
  /** The kind toggles under the auto-discover row: room between switches, and a rule above the group. */
  kindRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    paddingVertical: 8,
  },
  kindGroup: {
    marginTop: 12,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
    cardTextCol: {
      flex: 1,
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
      gap: SPACING.sm,
    },
    /* The one in use is marked by its border, so the list reads at a glance. */
    serverCardActive: {
      borderColor: colors.primary,
    },
    serverIdentity: {
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

    serverActions: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: SPACING.lg,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      paddingTop: SPACING.sm,
    },
    serverAction: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: SPACING.xs,
      paddingVertical: SPACING.xs,
    },
    serverActionText: {
      ...TYPOGRAPHY.meta,
      color: colors.textSecondary,
    },
    /* Destructive, so it sits at the far end and is the only coloured one. */
    serverActionDanger: {
      marginLeft: 'auto' as const,
    },
    serverActionDangerText: {
      color: colors.error,
    },
  };
}
