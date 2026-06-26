import type { ThemeColors, ThemeShadows } from '../theme';
import { TYPOGRAPHY } from '../constants';

export const createStyles = (colors: ThemeColors, shadows: ThemeShadows) => ({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    ...shadows.small,
  },
  cardCompact: {
    padding: 12,
    marginBottom: 12,
    borderRadius: 12,
  },
  compactTopRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    marginBottom: 4,
    gap: 6,
  },
  compactNameGroup: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    flex: 1,
    gap: 6,
    minWidth: 0,
  },
  compactName: {
    flexShrink: 1,
  },
  authorTag: {
    backgroundColor: colors.surfaceLight,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    flexShrink: 0,
  },
  authorTagText: {
    ...TYPOGRAPHY.metaSmall,
    color: colors.textSecondary,
  },
  cardActive: {
    borderWidth: 2,
    borderColor: colors.primary,
  },
  cardIncompatible: {
    opacity: 0.6,
  },
  header: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'flex-start' as const,
    marginBottom: 8,
  },
  headerCompact: {
    marginBottom: 4,
  },
  titleContainer: {
    flex: 1,
  },
  name: {
    ...TYPOGRAPHY.h3,
    color: colors.text,
  },
  author: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textSecondary,
  },
  authorRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    marginTop: 4,
    marginBottom: 6,
    gap: 8,
  },
  credibilityBadge: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    gap: 3,
  },
  credibilityIcon: {
    ...TYPOGRAPHY.meta,
    fontSize: 10,
  },
  credibilityText: {
    ...TYPOGRAPHY.meta,
  },
  activeBadge: {
    backgroundColor: colors.primary,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  activeBadgeText: {
    ...TYPOGRAPHY.meta,
    color: colors.text,
  },
  description: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textSecondary,
    marginBottom: 12,
  },
  descriptionCompact: {
    marginBottom: 4,
    ...TYPOGRAPHY.meta,
    color: colors.textSecondary,
  },
  cardRow: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    marginTop: 2,
  },
  cardContent: {
    flex: 1,
  },
  infoRow: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: 6,
  },
  infoRowCompact: {
    marginTop: 4,
    marginBottom: 6,
  },
  infoBadge: {
    backgroundColor: colors.surfaceLight,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  sizeBadge: {
    backgroundColor: `${colors.primary}20`,
  },
  infoText: {
    ...TYPOGRAPHY.meta,
    color: colors.textSecondary,
  },
  recommendedBadge: {
    backgroundColor: `${colors.info}30`,
  },
  recommendedText: {
    color: colors.info,
  },
  recommendedPill: {
    backgroundColor: colors.primary,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  recommendedPillText: {
    ...TYPOGRAPHY.metaSmall,
    color: colors.surface,
  },
  cardRecommended: {
    padding: 16,
    marginBottom: 20,
    marginTop: 4,
    borderRadius: 14,
  },
  compactNameRecommended: {
    ...TYPOGRAPHY.h3,
    color: colors.text,
  },
  recommendedHighlight: {
    ...TYPOGRAPHY.meta,
    color: colors.primary,
    marginTop: -4,
    marginBottom: 12,
  },
  recommendedChip: {
    backgroundColor: `${colors.primary}20`,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  recommendedChipText: {
    ...TYPOGRAPHY.meta,
    color: colors.primary,
  },
  recommendedHighlightCompact: {
    ...TYPOGRAPHY.meta,
    color: colors.primary,
    marginTop: 6,
  },
  warningBadge: {
    backgroundColor: `${colors.warning}30`,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  warningText: {
    ...TYPOGRAPHY.meta,
    color: colors.warning,
  },
  visionBadge: {
    backgroundColor: `${colors.info}30`,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  visionText: {
    ...TYPOGRAPHY.meta,
    color: colors.info,
  },
  codeBadge: {
    backgroundColor: `${colors.warning}30`,
  },
  codeText: {
    ...TYPOGRAPHY.meta,
    color: colors.warning,
  },
  statsRow: {
    flexDirection: 'row' as const,
    gap: 16,
    marginBottom: 12,
  },
  statsText: {
    ...TYPOGRAPHY.meta,
    color: colors.textMuted,
  },
  progressSection: {
    marginBottom: 12,
  },
  progressContainer: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 12,
  },
  progressBar: {
    flex: 1,
    height: 8,
    backgroundColor: colors.surfaceLight,
    borderRadius: 4,
    overflow: 'hidden' as const,
  },
  progressFill: {
    height: '100%' as const,
    backgroundColor: colors.primary,
    borderRadius: 4,
  },
  progressText: {
    ...TYPOGRAPHY.meta,
    color: colors.textSecondary,
    width: 40,
    textAlign: 'right' as const,
  },
  // LiteRT card only: tighten the gap and hug the percentage to the bar so it
  // doesn't appear to float. Other model cards keep the default spacing.
  progressContainerTight: {
    gap: 8,
  },
  progressTextTight: {
    textAlign: 'left' as const,
  },
  progressBytesText: {
    ...TYPOGRAPHY.meta,
    color: colors.textMuted,
    marginTop: 4,
  },
  iconButton: {
    padding: 4,
    flexShrink: 0,
  },
  failedSection: {
    marginTop: 8,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  failedProgressFill: {
    height: '100%' as const,
    backgroundColor: colors.error,
    borderRadius: 4,
  },
  failedMessageRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    marginTop: 8,
    marginBottom: 10,
  },
  failedMessageText: {
    ...TYPOGRAPHY.meta,
    color: colors.error,
    flex: 1,
  },
  failedActionsRow: {
    flexDirection: 'row' as const,
    gap: 8,
  },
  retryButton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: `${colors.primary}15` as const,
    borderWidth: 1,
    borderColor: `${colors.primary}40` as const,
  },
  retryButtonText: {
    ...TYPOGRAPHY.meta,
    color: colors.primary,
  },
  removeButton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: `${colors.error}12` as const,
    borderWidth: 1,
    borderColor: `${colors.error}30` as const,
  },
  removeButtonText: {
    ...TYPOGRAPHY.meta,
    color: colors.error,
  },
});
