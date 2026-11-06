import { StyleSheet } from 'react-native';
import type { ThemeColors, ThemeShadows } from '../theme';
import { FONTS, TYPOGRAPHY, SPACING } from '../constants';

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
    borderBottomWidth: 0.5,
    borderBottomColor: colors.borderLight,
    zIndex: 1,
    gap: SPACING.md,
  },
  backButton: {
    padding: SPACING.xs,
  },
  title: {
    ...TYPOGRAPHY.h2,
    flex: 1,
    color: colors.text,
  },
  scrollView: {
    flex: 1,
  },
  // An action sized to its words, not a slab edge to edge.
  sizedToText: { alignSelf: 'flex-start' as const },
  content: {
    paddingHorizontal: SPACING.xl,
    paddingTop: SPACING.lg,
    paddingBottom: SPACING.xxl,
  },
  section: {
    marginBottom: SPACING.lg,
  },
  sectionTitle: {
    ...TYPOGRAPHY.label,
    textTransform: 'uppercase' as const,
    color: colors.textMuted,
    marginBottom: SPACING.md,
    letterSpacing: 0.3,
  },
  storageBar: {
    height: 12,
    backgroundColor: colors.surfaceLight,
    borderRadius: 6,
    overflow: 'hidden' as const,
    marginBottom: SPACING.md,
  },
  storageUsed: {
    height: '100%' as const,
    backgroundColor: colors.textSecondary,
    borderRadius: 6,
  },
  storageLegend: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
  },
  legendItem: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: SPACING.xs,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendText: {
    ...TYPOGRAPHY.meta,
    fontFamily: FONTS.mono,
    color: colors.textSecondary,
  },
  infoRow: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    paddingVertical: SPACING.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderLight,
  },
  lastRow: {
    borderBottomWidth: 0,
  },
  infoRowLeft: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: SPACING.sm,
  },
  infoLabel: {
    ...TYPOGRAPHY.body,
    color: colors.text,
  },
  // A size is a fact, not an accent (brand: emerald only for what is in use or chosen).
  infoValue: {
    ...TYPOGRAPHY.body,
    fontFamily: FONTS.mono,
    color: colors.text,
  },
  indented: { flex: 1, marginLeft: SPACING.xl + SPACING.xs, color: colors.textSecondary },
  modelRow: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  modelInfo: {
    flex: 1,
    marginRight: SPACING.md,
  },
  modelName: {
    ...TYPOGRAPHY.body,
    color: colors.text,
  },
  modelMeta: {
    ...TYPOGRAPHY.meta,
    color: colors.textMuted,
    marginTop: 2,
  },
  modelSize: {
    ...TYPOGRAPHY.body,
    color: colors.textSecondary,
  },
  hint: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textMuted,
    textAlign: 'center' as const,
    lineHeight: 18,
  },
  sectionHeader: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    marginBottom: SPACING.md,
  },
  clearAllButton: {
    padding: SPACING.sm,
  },
  clearAllText: {
    ...TYPOGRAPHY.body,
    color: colors.textSecondary,
  },
  orphanedRow: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  orphanedInfo: {
    flex: 1,
    marginRight: SPACING.md,
  },
  orphanedName: {
    ...TYPOGRAPHY.body,
    color: colors.text,
  },
  orphanedMeta: {
    ...TYPOGRAPHY.meta,
    color: colors.textMuted,
    marginTop: 2,
  },
  // A 44px target around the 16-18px glyph.
  deleteButton: {
    padding: 13,
  },
  deleteAllButton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: SPACING.sm,
    marginTop: SPACING.md,
    paddingVertical: SPACING.md,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.error,
    borderRadius: 8,
  },
  deleteAllText: {
    ...TYPOGRAPHY.body,
    color: colors.error,
  },
});
