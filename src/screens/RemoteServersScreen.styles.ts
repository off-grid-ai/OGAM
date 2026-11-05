import { listRowStyle } from '../components/ListGroup';
import { cardSurface } from '../theme/surface';
import type { ThemeColors, ThemeShadows } from '../theme/palettes';
import { SPACING, TYPOGRAPHY } from '../constants';

/**
 * Remote Servers, on the same tokens as the rest of the app.
 *
 * Every text style here used to carry a hardcoded fontSize and no fontFamily, so all of it
 * rendered in the platform sans while the rest of the app used its brand face. TYPOGRAPHY tokens
 * carry the family, so using them fixes the typeface and the size at once. Cards use the shared
 * card surface, so this screen has the same depth as the other settings screens.
 */
export function createStyles(colors: ThemeColors, _shadows: ThemeShadows) {
  // The one card surface (brand: translucent, hairline edge), not a shadowed box of its own.
  const card = {
    ...cardSurface(colors),
    padding: SPACING.md,
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
      padding: SPACING.xl,
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
      ...TYPOGRAPHY.bodySmall,
      color: colors.textSecondary,
      lineHeight: 18,
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
      ...TYPOGRAPHY.bodySmall,
      color: colors.textMuted,
      lineHeight: 18,
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
      ...TYPOGRAPHY.bodySmall,
      color: colors.textSecondary,
      textAlign: 'center' as const,
      lineHeight: 18,
    },
    desktopLink: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: SPACING.sm,
      paddingVertical: SPACING.xs,
    },
    desktopLinkText: {
      ...TYPOGRAPHY.bodySmall,
      color: colors.primary,
    },

    // A row of the servers group; the one in use says "In use" in emerald, so no border is needed.
    serverCard: {
      ...listRowStyle,
      gap: SPACING.sm,
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
    },
    // 44pt boxes side by side: full touch targets with no overlap between neighbours.
    serverAction: {
      width: 44,
      height: 44,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
    },
  };
}
