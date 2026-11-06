import type { ThemeColors, ThemeShadows } from '../../theme';
import { SPACING, TYPOGRAPHY } from '../../constants';
import { createRemoteStyles } from './remoteStyles';

const createStyles = (colors: ThemeColors, _shadows: ThemeShadows) => ({
  tabBar: {
    flexDirection: 'row' as const,
    paddingHorizontal: SPACING.xl,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.xs,
    gap: SPACING.sm,
  },
  tab: {
    flex: 1,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    borderRadius: 10,
    backgroundColor: colors.surface,
    gap: 8,
  },
  tabActive: {
    backgroundColor: `${colors.primary}20`,
  },
  tabText: {
    ...TYPOGRAPHY.body,
    color: colors.textMuted,
  },
  tabTextActive: {
    color: colors.primary,
  },
  tabBadge: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: `${colors.primary}30`,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  tabBadgeDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.primary,
  },
  // The same gutter as the transcription and voice pickers (hand test 88: 12 pt here, 24 pt there).
  content: {
    paddingHorizontal: SPACING.xl,
    paddingTop: SPACING.sm,
  },
  contentContainer: {
    paddingBottom: SPACING.md,
  },
  loadedSection: {
    marginBottom: SPACING.md,
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: SPACING.md,
    borderWidth: 1,
    borderColor: `${colors.primary}40`,
  },
  loadedSectionImage: {
    borderColor: `${colors.info}40`,
  },
  loadedHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    marginBottom: SPACING.sm,
  },
  loadedLabel: {
    ...TYPOGRAPHY.label,
    color: colors.success,
    textTransform: 'uppercase' as const,
  },
  loadedModelItem: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
  },
  loadedModelInfo: {
    flex: 1,
  },
  loadedModelName: {
    ...TYPOGRAPHY.body,
    color: colors.text,
    marginBottom: 2,
  },
  loadedModelMeta: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textSecondary,
  },
  // A plain icon button: unloading frees memory and loses nothing, so it is not red (hand test 89).
  unloadButton: {
    width: 44,
    height: 44,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  sectionTitle: {
    ...TYPOGRAPHY.label,
    color: colors.textMuted,
    marginBottom: SPACING.sm,
    textTransform: 'uppercase' as const,
  },
  emptyState: {
    alignItems: 'center' as const,
    paddingVertical: 40,
    gap: 12,
  },
  emptyTitle: {
    ...TYPOGRAPHY.h2,
    color: colors.text,
  },
  emptyText: {
    ...TYPOGRAPHY.body,
    color: colors.textSecondary,
    textAlign: 'center' as const,
  },
  modelItem: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    borderRadius: 12,
    marginBottom: SPACING.sm,
    backgroundColor: colors.surface,
  },
  modelItemSelected: {
    backgroundColor: `${colors.primary}15`,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  modelItemSelectedImage: {
    backgroundColor: `${colors.info}15`,
    borderWidth: 1,
    borderColor: colors.info,
  },
  modelInfo: {
    flex: 1,
  },
  modelName: {
    ...TYPOGRAPHY.body,
    color: colors.text,
    marginBottom: SPACING.xs,
  },
  modelNameSelected: {
    color: colors.primary,
  },
  modelNameSelectedImage: {
    color: colors.info,
  },
  modelMeta: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
  },
  modelSize: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textSecondary,
  },
  metaSeparator: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textMuted,
    marginHorizontal: 6,
  },
  modelQuant: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textMuted,
  },
  modelStyle: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textMuted,
  },
  visionBadge: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: `${colors.info}20`,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    gap: 4,
  },
  visionBadgeText: {
    ...TYPOGRAPHY.label,
    color: colors.info,
  },
  checkmark: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.primary,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  checkmarkImage: {
    backgroundColor: colors.info,
  },
});

export const createAllStyles = (colors: ThemeColors, shadows: ThemeShadows) => ({
  ...createStyles(colors, shadows),
  ...createRemoteStyles(colors, shadows),
});
