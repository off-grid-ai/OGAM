import { StyleSheet } from 'react-native';
import type { ThemeColors, ThemeShadows } from '../theme';
import { TYPOGRAPHY, SPACING } from '../constants';

export const createStyles = (colors: ThemeColors, _shadows: ThemeShadows) => ({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  swipeableContainer: { overflow: 'visible' as const },
  header: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.md,
    // On the living field like every header: no surface slab.
    zIndex: 2,
  },
  // 44pt targets for the header's controls.
  backButton: {
    minWidth: 44,
    minHeight: 44,
    justifyContent: 'center' as const,
    marginRight: SPACING.sm,
  },
  headerCenter: {
    flex: 1,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
  },
  projectIcon: { marginRight: SPACING.sm },
  headerTitle: {
    ...TYPOGRAPHY.h2,
    color: colors.text,
    fontWeight: '400' as const,
    flex: 1,
  },
  editButton: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
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
    paddingTop: SPACING.md,
  },
  sectionsContainer: {
    flex: 1,
  },
  // The Models screen's tabs: body text, muted until chosen, an emerald line under the open one.
  tabRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingHorizontal: SPACING.xl,
    // The tabs sit on the field under a hairline, not on a raised bar with a shadow.
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderLight,
    zIndex: 1,
  },
  tabs: {
    flex: 1,
    flexDirection: 'row' as const,
    gap: SPACING.lg,
  },
  tab: { paddingTop: SPACING.md, alignItems: 'center' as const },
  tabText: { ...TYPOGRAPHY.body, color: colors.textMuted },
  tabTextActive: { color: colors.text },
  tabCount: { ...TYPOGRAPHY.meta, color: colors.textMuted },
  tabIndicator: {
    height: 2,
    backgroundColor: colors.primary,
    marginTop: SPACING.sm,
    alignSelf: 'stretch' as const,
  },
  tabIndicatorOff: { backgroundColor: 'transparent' },
  tabAdd: { width: 44, height: 44, alignItems: 'center' as const, justifyContent: 'center' as const },
  hidden: { display: 'none' as const },
  // A tab names the section, so its header carries only the actions, on the right.
  sectionActionsHeader: {
    flexDirection: 'row' as const,
    justifyContent: 'flex-end' as const,
    alignItems: 'center' as const,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
  },
  sectionContent: {
    flex: 1,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    paddingVertical: SPACING.xl,
    paddingHorizontal: SPACING.xl,
  },
  emptyStateText: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textMuted,
    marginTop: SPACING.sm,
    textAlign: 'center' as const,
  },
  emptyStateButton: {
    marginTop: SPACING.md,
  },
  chatList: {
    paddingHorizontal: SPACING.xl,
  },
  chatItem: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    // A chat is a row on the field with a hairline under it, not a shadowed card.
    paddingVertical: SPACING.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderLight,
  },
  chatItemWrapper: {
    paddingHorizontal: SPACING.xl,
    paddingTop: SPACING.sm,
  },
  // A bare glyph, as on Chats: no grey disc behind it.
  chatIcon: {
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
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  kbDocInfo: {
    flex: 1,
    marginRight: SPACING.sm,
  },
  kbDocDelete: {
    padding: 13,
    marginLeft: SPACING.sm,
  },
  kbTransferIcon: {
    marginRight: SPACING.sm,
  },
});
