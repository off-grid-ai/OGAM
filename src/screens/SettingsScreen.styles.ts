import { StyleSheet } from 'react-native';
import { SPACING, TYPOGRAPHY } from '../constants';
import type { ThemeColors, ThemeShadows } from '../theme';
import { cardSurface } from '../theme/surface';

// Split out of SettingsScreen, which was 723 lines against a 500-line cap: two hundred of them were
// this style sheet. Same pattern the Storage and Remote Servers screens already use.
// Settings follows brand's Mobile profile: 24px screen padding, groups on the one card surface with
// hairlines between rows, and emerald only for what is chosen (desktop's selected state).
export const createStyles = (colors: ThemeColors, _shadows: ThemeShadows) => ({
  container: { flex: 1, backgroundColor: colors.background },
  scrollView: { flex: 1 },
  content: {
    paddingHorizontal: SPACING.xl,
    paddingTop: SPACING.lg,
    paddingBottom: SPACING.xxl,
  },
  themeToggleRow: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    ...cardSurface(colors),
    padding: SPACING.md,
    marginBottom: SPACING.lg,
  },
  themeToggleLabel: { ...TYPOGRAPHY.body, color: colors.text },
  themeSelector: {
    flexDirection: 'row' as const,
    backgroundColor: colors.surfaceLight,
    borderRadius: 8,
    padding: 3,
    gap: 2,
  },
  themeSelectorOption: {
    width: 34,
    height: 30,
    borderRadius: 6,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  themeSelectorOptionActive: {
    backgroundColor: colors.selectedFill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.heroBorder,
  },
  navSection: {
    ...cardSurface(colors),
    marginBottom: SPACING.lg,
    overflow: 'hidden' as const,
  },
  navItem: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    padding: SPACING.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderLight,
  },
  navItemLast: { borderBottomWidth: 0 },
  navItemIcon: {
    width: 28,
    height: 28,
    borderRadius: 6,
    backgroundColor: 'transparent',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginRight: SPACING.md,
  },
  navItemContent: { flex: 1 },
  navItemTitle: {
    ...TYPOGRAPHY.body,
    fontWeight: '400' as const,
    color: colors.text,
  },
  navItemDesc: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textMuted,
    marginTop: 2,
  },
  followSection: {
    ...cardSurface(colors),
    marginBottom: SPACING.lg,
    overflow: 'hidden' as const,
  },
  followHeader: {
    padding: SPACING.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderLight,
  },
  followHeaderTitle: {
    ...TYPOGRAPHY.body,
    fontWeight: '400' as const,
    color: colors.text,
  },
  followHeaderDesc: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textMuted,
    marginTop: 4,
    lineHeight: 18,
  },
  followItemIcon: {
    width: 28,
    height: 28,
    borderRadius: 6,
    backgroundColor: 'transparent',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginRight: SPACING.md,
  },
  section: { marginBottom: SPACING.lg },
  aboutRow: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    marginBottom: SPACING.sm,
  },
  aboutLabel: { ...TYPOGRAPHY.body, color: colors.textSecondary },
  aboutValue: {
    ...TYPOGRAPHY.body,
    fontWeight: '400' as const,
    color: colors.text,
  },
  aboutText: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textMuted,
    lineHeight: 18,
  },
  sectionLabel: {
    ...TYPOGRAPHY.label,
    // brand/DESIGN_PHILOSOPHY.md: labels are quiet uppercase whispers.
    textTransform: 'uppercase' as const,
    letterSpacing: 0.3,
    color: colors.textMuted,
    marginBottom: SPACING.sm,
    marginLeft: SPACING.xs,
  },
  devButton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: SPACING.sm,
    paddingVertical: SPACING.md,
    marginTop: SPACING.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed' as const,
    borderRadius: 6,
  },
  devButtonGroup: { gap: 12 },
  devButtonText: { ...TYPOGRAPHY.bodySmall, color: colors.textMuted },
  proCardText: { flex: 1 },
  proTitleRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: SPACING.sm,
    marginBottom: 2,
  },
  proBadge: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderLight,
    borderRadius: 8,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 2,
  },
  proBadgeText: {
    ...TYPOGRAPHY.labelSmall,
    color: colors.textSecondary,
    letterSpacing: 0.5,
  },
  proDesc: { ...TYPOGRAPHY.bodySmall, color: colors.textSecondary },
  proIconContainer: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'transparent',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  proNavButton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    ...cardSurface(colors),
    padding: SPACING.md,
    gap: SPACING.md,
    marginBottom: SPACING.lg,
  },
  proNavTitle: {
    ...TYPOGRAPHY.body,
    color: colors.text,
  },
});
