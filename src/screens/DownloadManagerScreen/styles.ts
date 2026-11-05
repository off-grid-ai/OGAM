import { StyleSheet } from 'react-native';
import type { ThemeColors, ThemeShadows } from '../../theme';
import { TYPOGRAPHY, SPACING } from '../../constants';

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
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderLight,
    zIndex: 1,
    gap: SPACING.sm,
  },
  backButton: {
    padding: SPACING.xs,
  },
  title: {
    ...TYPOGRAPHY.h2,
    color: colors.text,
    flex: 1,
  },
  content: {
    flex: 1,
  },
  listContent: {
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.xxl,
  },
  section: {
    marginBottom: SPACING.sm,
  },
  downloadCardInset: {
    marginHorizontal: SPACING.xl,
  },
  sectionHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingHorizontal: SPACING.xl,
    marginTop: SPACING.md,
    marginBottom: SPACING.sm,
    gap: SPACING.sm,
  },
  sectionTitle: {
    ...TYPOGRAPHY.label,
    textTransform: 'uppercase' as const,
    color: colors.textMuted,
    flex: 1,
  },
  countBadge: {
    backgroundColor: colors.surfaceLight,
    paddingHorizontal: SPACING.sm + 2,
    paddingVertical: SPACING.xs,
    borderRadius: 12,
  },
  countText: {
    ...TYPOGRAPHY.meta,
    color: colors.textSecondary,
  },
  downloadCard: {
    marginHorizontal: SPACING.md,
    marginBottom: SPACING.sm,
    padding: SPACING.md,
    borderRadius: SPACING.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  downloadHeader: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    marginBottom: SPACING.sm,
  },
  completedHeader: {
    alignItems: 'center' as const,
    marginBottom: 0,
  },
  modelTypeIcon: {
    width: 28,
    height: 28,
    borderRadius: 6,
    backgroundColor: colors.surfaceLight,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginRight: SPACING.sm + 2,
  },
  downloadInfo: {
    flex: 1,
  },
  fileName: {
    ...TYPOGRAPHY.body,
    color: colors.text,
    marginBottom: SPACING.xs / 2,
  },
  modelId: {
    ...TYPOGRAPHY.meta,
    color: colors.textSecondary,
  },
  cancelButton: {
    padding: SPACING.sm,
    marginRight: -SPACING.sm,
    marginTop: -SPACING.xs,
  },
  repairButton: {
    padding: SPACING.sm,
    marginTop: -SPACING.xs,
  },
  deleteButton: {
    padding: SPACING.sm,
    marginRight: -SPACING.sm,
    marginTop: -SPACING.xs,
  },
  progressContainer: {
    marginBottom: SPACING.sm,
  },
  transferRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: SPACING.sm,
  },
  transferProgressBar: {
    flex: 1,
    marginBottom: 0,
  },
  transferActions: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
  },
  transferCaptionRow: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    marginTop: SPACING.xs,
  },
  progressBarBackground: {
    height: 6,
    backgroundColor: colors.surfaceLight,
    borderRadius: 3,
    marginBottom: SPACING.xs + 2,
    overflow: 'hidden' as const,
  },
  progressBarFill: {
    height: '100%' as const,
    backgroundColor: colors.primary,
    borderRadius: 3,
  },
  progressText: {
    ...TYPOGRAPHY.meta,
    color: colors.textMuted,
  },
  downloadMeta: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: SPACING.sm,
  },
  quantBadge: {
    backgroundColor: colors.surfaceLight,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    borderRadius: 6,
  },
  quantText: {
    ...TYPOGRAPHY.meta,
    color: colors.textSecondary,
  },
  imageBadge: {
    backgroundColor: `${colors.info}25`,
  },
  imageQuantText: {
    color: colors.info,
  },
  // A status can be a sentence ("Something went wrong while downloading."): Geist, not Mono.
  statusText: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textSecondary,
  },
  sizeText: {
    ...TYPOGRAPHY.meta,
    color: colors.textSecondary,
  },
  dateText: {
    ...TYPOGRAPHY.meta,
    color: colors.textMuted,
  },
  emptyCard: {
    marginHorizontal: SPACING.lg,
    alignItems: 'center' as const,
    paddingVertical: SPACING.xl,
    gap: SPACING.xs,
  },
  emptyText: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textMuted,
    marginTop: SPACING.xs,
  },
  emptySubtext: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textMuted,
    textAlign: 'center' as const,
  },
  repairingBadge: {
    backgroundColor: `${colors.primary}20`,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    borderRadius: 6,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: SPACING.xs,
  },
  repairingBadgeText: {
    ...TYPOGRAPHY.meta,
    color: colors.primary,
  },
  filterBarContent: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.xs,
    gap: SPACING.xs,
  },
  filterChip: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingHorizontal: SPACING.sm + 2,
    paddingVertical: 5,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  filterChipActive: {
    borderColor: colors.primary,
    backgroundColor: `${colors.primary}15`,
  },
  filterChipText: {
    ...TYPOGRAPHY.meta,
    color: colors.textSecondary,
  },
  filterChipTextActive: {
    color: colors.primary,
  },
  storageSection: {
    paddingHorizontal: SPACING.xl,
  },
  storageRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: SPACING.sm,
    paddingVertical: SPACING.md,
  },
  storageText: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textSecondary,
  },
  failedActionsRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: SPACING.sm,
    marginLeft: SPACING.sm,
  },
  transferIconButton: {
    width: 32,
    height: 32,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  statusIconRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: SPACING.xs,
  },
});
