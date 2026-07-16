import { StyleSheet, Dimensions } from 'react-native';
import type { ThemeColors, ThemeShadows } from '../../theme';
import { TYPOGRAPHY, SPACING } from '../../constants';

const { width: screenWidth } = Dimensions.get('window');
export const COLUMN_COUNT = 3;
const GRID_SPACING = 4;
const CELL_SIZE = (screenWidth - GRID_SPACING * (COLUMN_COUNT + 1)) / COLUMN_COUNT;

const createHeaderStyles = (colors: ThemeColors, shadows: ThemeShadows) => ({
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
  closeButton: {
    padding: SPACING.xs,
    marginRight: SPACING.md,
  },
  title: {
    ...TYPOGRAPHY.h2,
    color: colors.text,
    flex: 1,
  },
  countBadge: {
    ...TYPOGRAPHY.meta,
    color: colors.textMuted,
    marginRight: SPACING.sm,
  },
  headerButton: {
    padding: SPACING.sm,
    marginLeft: SPACING.xs,
  },
  headerButtonDisabled: {
    opacity: 0.5,
  },
  headerButtonText: {
    ...TYPOGRAPHY.body,
    color: colors.primary,
  },
});

const createGridStyles = (colors: ThemeColors) => ({
  genBanner: {
    backgroundColor: colors.surface,
    marginHorizontal: SPACING.md,
    marginTop: SPACING.md,
    borderRadius: SPACING.md,
    padding: SPACING.md,
  },
  genBannerRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: SPACING.sm + 2,
  },
  genPreview: {
    width: 40,
    height: 40,
    borderRadius: SPACING.sm,
    backgroundColor: colors.surfaceLight,
  },
  genBannerInfo: { flex: 1 },
  genBannerTitle: { ...TYPOGRAPHY.body, color: colors.text, marginTop: 0 },
  genBannerPrompt: { ...TYPOGRAPHY.meta, color: colors.textMuted, marginTop: 2 },
  genProgressBar: {
    height: 4,
    backgroundColor: colors.surfaceLight,
    borderRadius: 2,
    marginTop: 6,
    overflow: 'hidden' as const,
  },
  genProgressFill: { height: '100%' as const, backgroundColor: colors.primary, borderRadius: 2 },
  genSteps: { ...TYPOGRAPHY.meta, color: colors.textMuted },
  genCancelButton: { padding: SPACING.sm - 2 },
  gridContainer: { padding: GRID_SPACING },
  gridRow: { gap: GRID_SPACING, marginBottom: GRID_SPACING },
  gridItem: {
    width: CELL_SIZE,
    height: CELL_SIZE,
    borderRadius: SPACING.sm,
    overflow: 'hidden' as const,
    backgroundColor: colors.surfaceLight,
  },
  gridImage: { width: '100%' as const, height: '100%' as const },
  selectionOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-start' as const,
    alignItems: 'flex-end' as const,
    padding: SPACING.sm - 2,
  },
  selectionOverlaySelected: { backgroundColor: 'rgba(99, 102, 241, 0.25)' },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: '#fff',
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  checkboxSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    padding: SPACING.xxl,
  },
  emptyTitle: { ...TYPOGRAPHY.body, color: colors.text, marginTop: SPACING.lg },
  emptyText: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textMuted,
    textAlign: 'center' as const,
    marginTop: SPACING.sm,
  },
});

const createViewerStyles = (colors: ThemeColors) => ({
  viewerContainer: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.95)',
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  viewerBackdrop: { ...StyleSheet.absoluteFillObject },
  viewerContent: {
    width: '100%' as const,
    height: '100%' as const,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  fullscreenImage: {
    width: Dimensions.get('window').width,
    height: Dimensions.get('window').height * 0.65,
  },
  viewerActions: {
    flexDirection: 'row' as const,
    position: 'absolute' as const,
    bottom: 60,
    gap: SPACING.lg + 4,
  },
  viewerButton: {
    alignItems: 'center' as const,
    padding: SPACING.md + 2,
    backgroundColor: colors.surface,
    borderRadius: SPACING.md + 2,
    minWidth: 70,
  },
  viewerButtonActive: { borderWidth: 1, borderColor: colors.primary },
  viewerButtonText: { ...TYPOGRAPHY.meta, color: colors.text, marginTop: SPACING.xs },
  viewerButtonTextPrimary: { ...TYPOGRAPHY.meta, color: colors.primary, marginTop: SPACING.xs },
  viewerButtonTextError: { ...TYPOGRAPHY.meta, color: colors.error, marginTop: SPACING.xs },
  detailsSheet: {
    flex: 1,
    width: '100%' as const,
    backgroundColor: colors.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    marginTop: 60,
    overflow: 'hidden' as const,
  },
  detailsSheetHeader: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  detailsSheetTitle: { ...TYPOGRAPHY.h3, color: colors.text },
  detailsSheetClose: { ...TYPOGRAPHY.body, color: colors.primary },
  detailsPreview: { width: '100%' as const, height: 200, backgroundColor: colors.background },
  detailsContent: { padding: SPACING.lg },
  detailRow: { marginBottom: SPACING.sm + 2 },
  detailLabel: { ...TYPOGRAPHY.meta, color: colors.textMuted, marginBottom: 2 },
  detailValue: { ...TYPOGRAPHY.body, color: colors.text, lineHeight: 20 },
  detailsMetaRow: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: SPACING.sm,
    marginTop: SPACING.xs,
  },
  detailChip: {
    backgroundColor: colors.surfaceLight,
    paddingHorizontal: SPACING.sm + 2,
    paddingVertical: SPACING.xs,
    borderRadius: SPACING.sm,
  },
  detailChipText: { ...TYPOGRAPHY.meta, color: colors.textSecondary },
  detailDate: { ...TYPOGRAPHY.meta, color: colors.textMuted, marginTop: SPACING.sm + 2 },
});

export const createStyles = (colors: ThemeColors, shadows: ThemeShadows) => ({
  ...createHeaderStyles(colors, shadows),
  ...createGridStyles(colors),
  ...createViewerStyles(colors),
});
