import type { ThemeColors, ThemeShadows } from '../../theme';
import { TYPOGRAPHY, SPACING } from '../../constants';

const createLayoutStyles = (_colors: ThemeColors) => ({
  flex1: {
    flex: 1,
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.lg,
  },
  bottomPadding: {
    height: 40,
  },
});

const createStatsStyles = (colors: ThemeColors) => ({
  statsBar: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    backgroundColor: colors.surface,
    paddingVertical: 10,
    paddingHorizontal: 20,
    gap: 6,
    flexWrap: 'wrap' as const,
  },
  statsLabel: {
    ...TYPOGRAPHY.meta,
    color: colors.textMuted,
  },
  statsValue: {
    ...TYPOGRAPHY.meta,
    color: colors.primary,
    fontWeight: '600' as const,
  },
  statsSeparator: {
    ...TYPOGRAPHY.meta,
    color: colors.textMuted,
  },
});

const createAccordionStyles = (colors: ThemeColors) => ({
  accordionHeaderNoMargin: {
    marginTop: 0,
  },
  accordionHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    marginTop: SPACING.xl,
    marginBottom: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  accordionTitle: {
    ...TYPOGRAPHY.label,
    color: colors.textMuted,
    textTransform: 'uppercase' as const,
    letterSpacing: 1,
  },
  sectionCard: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    padding: SPACING.lg,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: SPACING.lg,
  },
  sectionLabel: {
    ...TYPOGRAPHY.label,
    color: colors.textMuted,
    textTransform: 'uppercase' as const,
    letterSpacing: 1,
    marginTop: SPACING.xl,
    marginBottom: SPACING.md,
  },
});

const createSliderStyles = (colors: ThemeColors) => ({
  settingGroup: {
    marginBottom: SPACING.lg,
  },
  settingHeader: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    marginBottom: SPACING.sm,
  },
  settingLabel: {
    ...TYPOGRAPHY.body,
    color: colors.text,
  },
  settingValue: {
    ...TYPOGRAPHY.body,
    color: colors.primary,
    fontWeight: '400' as const,
  },
  settingDescription: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textSecondary,
    marginBottom: SPACING.md,
    lineHeight: 18,
  },
  settingWarning: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.warning,
    marginTop: SPACING.xs,
    lineHeight: 18,
  },
  slider: {
    width: '100%' as const,
    height: 40,
  },
  sliderLabels: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    marginTop: -4,
  },
  sliderMinMax: {
    ...TYPOGRAPHY.label,
    color: colors.textMuted,
  },
  clearCacheButton: {
    marginTop: 8,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 6,
  },
});

const createActionStyles = (colors: ThemeColors) => ({
  actionRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: colors.background,
    padding: SPACING.md,
    borderRadius: 8,
    marginBottom: SPACING.sm,
    gap: SPACING.md,
  },
  actionText: {
    ...TYPOGRAPHY.body,
    color: colors.text,
    flex: 1,
  },
  actionTextError: {
    ...TYPOGRAPHY.body,
    color: colors.error,
    flex: 1,
  },
  resetButton: {
    backgroundColor: colors.surface,
    padding: SPACING.md,
    borderRadius: 8,
    alignItems: 'center' as const,
    borderWidth: 1,
    borderColor: colors.border,
  },
  resetButtonText: {
    ...TYPOGRAPHY.body,
    color: colors.textSecondary,
  },
  remoteNotice: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    gap: 6,
    backgroundColor: colors.surface,
    borderRadius: 8,
    padding: SPACING.sm,
    marginBottom: SPACING.sm,
  },
  remoteNoticeText: {
    ...TYPOGRAPHY.meta,
    color: colors.textMuted,
    flex: 1,
  },
});

const createModelPickerStyles = (colors: ThemeColors) => ({
  modelPickerButton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    backgroundColor: colors.background,
    padding: SPACING.md,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: SPACING.sm,
  },
  modelPickerContent: {
    flex: 1,
  },
  modelPickerLabel: {
    ...TYPOGRAPHY.meta,
    color: colors.textMuted,
    marginBottom: 2,
  },
  modelPickerValue: {
    ...TYPOGRAPHY.bodySmall,
    fontWeight: '600' as const,
    color: colors.text,
  },
  modelPickerList: {
    backgroundColor: colors.background,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: SPACING.md,
    overflow: 'hidden' as const,
  },
  modelPickerItem: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    padding: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  modelPickerItemActive: {
    backgroundColor: `${colors.primary}25`,
  },
  modelPickerItemText: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.text,
  },
  modelPickerItemDesc: {
    ...TYPOGRAPHY.meta,
    color: colors.textMuted,
    marginTop: 2,
  },
  noModelsText: {
    padding: 14,
    ...TYPOGRAPHY.h3,
    color: colors.textMuted,
    textAlign: 'center' as const,
  },
  classifierNote: {
    ...TYPOGRAPHY.meta,
    color: colors.textMuted,
    fontStyle: 'italic' as const,
    marginTop: SPACING.sm,
  },
});

const createToggleStyles = (colors: ThemeColors) => ({
  modeToggleContainer: {
    marginBottom: SPACING.lg,
  },
  dimmed: { opacity: 0.5 },
  modeToggleInfo: {
    marginBottom: SPACING.md,
  },
  modeToggleLabel: {
    ...TYPOGRAPHY.body,
    color: colors.text,
    marginBottom: SPACING.sm,
  },
  modeToggleDesc: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  modeToggleButtons: {
    flexDirection: 'row' as const,
    gap: SPACING.sm,
  },
  modeButton: {
    flex: 1,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    borderRadius: 8,
    backgroundColor: 'transparent',
    alignItems: 'center' as const,
    borderWidth: 1,
    borderColor: colors.border,
  },
  modeButtonActive: {
    backgroundColor: 'transparent',
    borderColor: colors.primary,
  },
  modeButtonText: {
    ...TYPOGRAPHY.body,
    color: colors.textSecondary,
  },
  modeButtonTextActive: {
    color: colors.primary,
  },
  gpuLayersInline: {
    marginTop: SPACING.md,
    paddingTop: SPACING.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  advancedToggle: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    paddingVertical: SPACING.md,
    marginTop: SPACING.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: SPACING.xs,
  },
  advancedToggleText: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textMuted,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  },
});

export const createStyles = (colors: ThemeColors, _shadows: ThemeShadows) => ({
  ...createLayoutStyles(colors),
  ...createStatsStyles(colors),
  ...createAccordionStyles(colors),
  ...createSliderStyles(colors),
  ...createActionStyles(colors),
  ...createModelPickerStyles(colors),
  ...createToggleStyles(colors),
});
