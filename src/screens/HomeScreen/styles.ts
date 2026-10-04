import type { ThemeColors, ThemeShadows } from '../../theme';
import { TYPOGRAPHY, SPACING } from '../../constants';
const createLayoutStyles = (colors: ThemeColors) => ({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.xxl,
    gap: SPACING.xs,
  },
  header: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    marginBottom: SPACING.md,
  },
  headerLeft: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: SPACING.sm,
  },
  appLogo: {
    width: SPACING.xxl + SPACING.sm,
    height: SPACING.xxl + SPACING.sm,
  },
  headerActions: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
  },
  crownButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.primary,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  title: {
    ...TYPOGRAPHY.h2,
    color: colors.text,
  },
});
const createModelCardStyles = (colors: ThemeColors, shadows: ThemeShadows) => ({
  modelsRow: {
    flexDirection: 'row' as const,
    gap: 16,
    marginBottom: 20,
  },
  modelCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 16,
    ...shadows.small,
  },
  modelCardHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    marginBottom: 8,
  },
  modelCardLabel: {
    ...TYPOGRAPHY.labelSmall,
    flex: 1,
    color: colors.textMuted,
    textTransform: 'uppercase' as const,
  },
  modelCardName: {
    ...TYPOGRAPHY.h3,
    color: colors.text,
    flex: 1,
  },
  modelCardNameRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
  },
  remoteBadge: {
    backgroundColor: colors.surfaceLight,
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  modelCardMeta: {
    ...TYPOGRAPHY.meta,
    color: colors.textMuted,
    marginTop: 3,
  },
  modelCardEmpty: {
    ...TYPOGRAPHY.h3,
    color: colors.textMuted,
  },
  modelCardLoading: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.primary,
    marginTop: 2,
  },
  ejectAllButton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 8,
    paddingVertical: 12,
    marginBottom: 20,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  ejectAllText: {
    fontSize: 14,
    color: colors.error,
    fontWeight: '500' as const,
  },
  newChatButton: {
    marginBottom: SPACING.md,
  },
});
const createSectionStyles = (colors: ThemeColors, shadows: ThemeShadows) => ({
  galleryCard: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: colors.surface,
    borderRadius: 12,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    marginBottom: SPACING.md,
    gap: SPACING.md,
    ...shadows.small,
  },
  galleryCardInfo: {
    flex: 1,
  },
  galleryCardTitle: {
    ...TYPOGRAPHY.body,
    fontWeight: '600' as const,
    color: colors.text,
  },
  galleryCardMeta: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textMuted,
    marginTop: 2,
  },
  dayRecRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    marginTop: 3,
  },
  dayRecDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.error,
  },
  dayRecText: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.error,
  },
  desktopCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    borderWidth: 1,
    borderColor: colors.primary,
    gap: SPACING.sm,
    ...shadows.small,
  },
  desktopCardHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
  },
  desktopCardTitle: {
    ...TYPOGRAPHY.body,
    fontWeight: '600' as const,
    color: colors.text,
    flex: 1,
  },
  desktopBadge: {
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  desktopBadgeText: {
    ...TYPOGRAPHY.metaSmall,
    color: colors.primary,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  },
  desktopCardBody: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textSecondary,
  },
  desktopCardCtaRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
  },
  desktopCardCta: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
  },
  desktopCardCtaText: {
    ...TYPOGRAPHY.bodySmall,
    fontWeight: '600' as const,
    color: colors.primary,
  },
  desktopCardCopy: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
  },
  desktopCardCopyText: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textSecondary,
  },
  supportCard: {
    marginBottom: SPACING.md,
    gap: SPACING.md,
  },
  supportHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: SPACING.sm,
  },
  supportTitle: {
    ...TYPOGRAPHY.h3,
    color: colors.text,
    flex: 1,
  },
  supportDescription: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textSecondary,
  },
  setupCard: {
    alignItems: 'center' as const,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    marginBottom: SPACING.md,
    gap: SPACING.sm,
  },
  setupActions: {
    flexDirection: 'row' as const,
    gap: 10,
  },
  setupText: {
    ...TYPOGRAPHY.body,
    color: colors.textMuted,
    textAlign: 'center' as const,
  },
  section: {
    marginBottom: SPACING.md,
  },
  sectionHeader: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    marginBottom: SPACING.sm + SPACING.xs,
  },
  sectionTitle: {
    ...TYPOGRAPHY.h3,
    color: colors.text,
  },
  seeAll: {
    ...TYPOGRAPHY.meta,
    color: colors.textMuted,
  },
  conversationItem: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: colors.surface,
    borderRadius: 10,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm + 2,
    marginBottom: SPACING.sm + SPACING.xs,
    ...shadows.small,
  },
  conversationInfo: {
    flex: 1,
  },
  conversationHeader: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
  },
  conversationTitle: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.text,
    flex: 1,
    marginRight: SPACING.sm,
  },
  conversationMeta: {
    ...TYPOGRAPHY.metaSmall,
    color: colors.textMuted,
  },
  conversationPreview: {
    ...TYPOGRAPHY.meta,
    color: colors.textSecondary,
    marginTop: 1,
  },
  deleteAction: {
    backgroundColor: colors.errorBackground,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    width: 44,
    borderRadius: 10,
    marginBottom: SPACING.sm + SPACING.xs,
    marginLeft: SPACING.sm,
  },
  statsRow: {
    flexDirection: 'row' as const,
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 16,
    ...shadows.small,
  },
  statItem: {
    flex: 1,
    alignItems: 'center' as const,
  },
  statValue: {
    ...TYPOGRAPHY.display,
    color: colors.text,
  },
  statLabel: {
    ...TYPOGRAPHY.labelSmall,
    color: colors.textMuted,
    marginTop: SPACING.xs,
    textTransform: 'uppercase' as const,
  },
  statDivider: {
    width: 1,
    backgroundColor: colors.border,
  },
  swipeableContainer: {
    overflow: 'visible' as const,
  },
});
const createPickerStyles = (colors: ThemeColors) => ({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end' as const,
  },
  modalContent: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '70%' as const,
  },
  modalHeader: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  modalTitle: {
    ...TYPOGRAPHY.h2,
    color: colors.text,
  },
  modalScroll: {
    padding: 16,
  },
  pickerItem: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: colors.surface,
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
  },
  pickerItemActive: {
    backgroundColor: colors.surfaceLight,
  },
  pickerItemInfo: {
    flex: 1,
  },
  pickerItemName: {
    ...TYPOGRAPHY.body,
    fontSize: 15,
    fontWeight: '500' as const,
    color: colors.text,
  },
  pickerItemMeta: {
    ...TYPOGRAPHY.h3,
    color: colors.textMuted,
    marginTop: 2,
  },
  pickerItemMemory: {
    ...TYPOGRAPHY.meta,
    color: colors.textMuted,
    marginTop: 2,
  },
  pickerItemMemoryWarning: {
    color: colors.warning,
  },
  pickerItemWarning: {
    borderWidth: 1,
    borderColor: colors.warning,
  },
  unloadButton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    padding: 12,
    marginBottom: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 8,
  },
  unloadButtonText: {
    ...TYPOGRAPHY.body,
    color: colors.error,
  },
  emptyPicker: {
    alignItems: 'center' as const,
    padding: 24,
    gap: 12,
  },
  emptyPickerText: {
    ...TYPOGRAPHY.body,
    color: colors.textMuted,
  },
  sectionLabel: {
    ...TYPOGRAPHY.labelSmall,
    color: colors.textMuted,
    textTransform: 'uppercase' as const,
    marginTop: 12,
    marginBottom: 8,
  },
  browseMoreButton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: 8,
  },
  browseMoreText: {
    ...TYPOGRAPHY.body,
    color: colors.textMuted,
  },
});
export const createStyles = (colors: ThemeColors, shadows: ThemeShadows) => ({
  ...createLayoutStyles(colors),
  ...createModelCardStyles(colors, shadows),
  ...createSectionStyles(colors, shadows),
  ...createPickerStyles(colors),
});
