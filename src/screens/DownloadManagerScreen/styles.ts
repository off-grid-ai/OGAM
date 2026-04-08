import type { ThemeColors, ThemeShadows } from '../../theme';
import { TYPOGRAPHY, SPACING } from '../../constants';

export const createStyles = (colors: ThemeColors, shadows: ThemeShadows) => ({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
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
    padding: SPACING.sm,
    marginRight: SPACING.sm,
  },
  title: {
    ...TYPOGRAPHY.h2,
    flex: 1,
    color: colors.text,
  },
  headerSpacer: {
    width: 40,
  },
  content: {
    flex: 1,
  },
  listContent: {
    paddingTop: SPACING.md,
    paddingBottom: SPACING.xxl,
  },
  section: {
    marginBottom: SPACING.md,
  },
  sectionHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingHorizontal: SPACING.lg,
    marginBottom: SPACING.sm,
    gap: SPACING.sm,
  },
  sectionTitle: {
    ...TYPOGRAPHY.h3,
    color: colors.text,
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
    marginHorizontal: SPACING.lg,
    marginBottom: SPACING.sm,
  },
  downloadHeader: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    marginBottom: SPACING.md,
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
    marginBottom: SPACING.md,
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
    gap: SPACING.md,
  },
  quantBadge: {
    backgroundColor: `${colors.primary}25`,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    borderRadius: 6,
  },
  quantText: {
    ...TYPOGRAPHY.meta,
    color: colors.primary,
  },
  imageBadge: {
    backgroundColor: `${colors.info}25`,
  },
  imageQuantText: {
    color: colors.info,
  },
  statusText: {
    ...TYPOGRAPHY.meta,
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
    ...TYPOGRAPHY.meta,
    color: colors.textMuted,
    textAlign: 'center' as const,
  },
  filterBarContent: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
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
    paddingHorizontal: SPACING.lg,
  },
  storageRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: SPACING.sm,
    backgroundColor: colors.surface,
    padding: SPACING.lg,
    borderRadius: 12,
  },
  storageText: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textSecondary,
  },
});
