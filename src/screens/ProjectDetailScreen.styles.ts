import type { ThemeColors, ThemeShadows } from '../theme';
import { TYPOGRAPHY, SPACING } from '../constants';

export const createStyles = (colors: ThemeColors, shadows: ThemeShadows) => ({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  swipeableContainer: { overflow: 'visible' as const },
  header: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
    ...shadows.small,
    zIndex: 1,
  },
  backButton: {
    padding: SPACING.xs,
    marginRight: SPACING.md,
  },
  headerCenter: {
    flex: 1,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
  },
  projectIcon: {
    width: 28,
    height: 28,
    borderRadius: 6,
    backgroundColor: colors.surface,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginRight: SPACING.sm,
  },
  projectIconText: {
    ...TYPOGRAPHY.body,
    color: colors.textMuted,
    fontWeight: '400' as const,
  },
  headerTitle: {
    ...TYPOGRAPHY.h2,
    color: colors.text,
    fontWeight: '400' as const,
    flex: 1,
  },
  editButton: {
    padding: SPACING.sm,
  },
  projectInfo: {
    padding: SPACING.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  projectDescription: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textSecondary,
    lineHeight: 18,
    marginBottom: SPACING.md,
  },
  projectStats: {
    flexDirection: 'row' as const,
  },
  statItem: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: SPACING.xs,
  },
  statText: {
    ...TYPOGRAPHY.label,
    color: colors.textMuted,
  },
  sectionHeader: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
  },
  sectionTitleRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: SPACING.sm,
  },
  sectionTitle: {
    ...TYPOGRAPHY.h3,
    color: colors.text,
    fontWeight: '400' as const,
  },
  sectionCount: {
    ...TYPOGRAPHY.labelSmall,
    color: colors.textMuted,
    backgroundColor: colors.surfaceLight,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 2,
    borderRadius: 8,
  },
  sectionActions: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: SPACING.sm,
  },
  navIcon: {
    marginLeft: SPACING.xs,
  },
  sectionList: {
    flex: 1,
  },
  sectionsContainer: {
    flex: 1,
  },
  sectionHalf: {
    flex: 1,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  sectionContent: {
    flex: 1,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    paddingVertical: SPACING.xl,
  },
  emptyStateText: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textMuted,
    marginTop: SPACING.sm,
  },
  emptyStateButton: {
    marginTop: SPACING.md,
  },
  chatList: {
    paddingHorizontal: SPACING.lg,
  },
  chatItem: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    padding: SPACING.md,
    borderRadius: 6,
    marginBottom: SPACING.sm,
    ...shadows.small,
  },
  chatItemWrapper: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.sm,
  },
  chatIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.surface,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginRight: SPACING.md,
  },
  chatContent: {
    flex: 1,
  },
  chatHeader: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    marginBottom: SPACING.xs,
  },
  chatTitle: {
    ...TYPOGRAPHY.body,
    color: colors.text,
    fontWeight: '400' as const,
    flex: 1,
    marginRight: SPACING.sm,
  },
  chatDate: {
    ...TYPOGRAPHY.labelSmall,
    color: colors.textMuted,
  },
  chatPreview: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textSecondary,
  },
  footer: {
    padding: SPACING.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  errorText: {
    ...TYPOGRAPHY.body,
    color: colors.textSecondary,
    marginBottom: SPACING.md,
  },
  errorLink: {
    ...TYPOGRAPHY.body,
    color: colors.primary,
    fontWeight: '400' as const,
  },
  deleteAction: {
    backgroundColor: colors.errorBackground,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    width: 50,
    borderRadius: 12,
    marginBottom: SPACING.sm,
    marginLeft: 10,
  },
  kbIndexing: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    gap: SPACING.sm,
  },
  kbIndexingText: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textSecondary,
    flex: 1,
  },
  kbDocRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  kbDocInfo: {
    flex: 1,
    marginRight: SPACING.sm,
  },
  kbDocName: {
    ...TYPOGRAPHY.body,
    color: colors.text,
  },
  kbDocSize: {
    ...TYPOGRAPHY.labelSmall,
    color: colors.textMuted,
  },
  kbDocDelete: {
    padding: SPACING.sm,
    marginLeft: SPACING.sm,
  },
});
