import { cardSurface } from '../../theme/surface';
import { StyleSheet, Dimensions } from 'react-native';
import type { ThemeColors, ThemeShadows } from '../../theme';
import { TYPOGRAPHY, SPACING } from '../../constants';

/** Light ink for controls over the black image viewer, in either theme. */
export const VIEWER_INK = 'rgba(255,255,255,0.88)';

const { width: screenWidth } = Dimensions.get('window');
export const COLUMN_COUNT = 3;
// The 24 pt screen gutter at the sides, a small gap between tiles.
const GRID_GUTTER = SPACING.xl;
const GRID_SPACING = SPACING.sm;
const CELL_SIZE = (screenWidth - GRID_GUTTER * 2 - GRID_SPACING * (COLUMN_COUNT - 1)) / COLUMN_COUNT;

const createHeaderStyles = (colors: ThemeColors, _shadows: ThemeShadows) => ({
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
  },
  // 44 pt frames pulled back, so the header keeps its height (Back was 32, Select 36).
  closeButton: {
    width: 44,
    height: 44,
    margin: -8,
    marginRight: SPACING.md - 8,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
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
    minWidth: 44,
    minHeight: 44,
    marginVertical: -8,
    marginLeft: SPACING.xs,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
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
  gridContainer: { paddingHorizontal: GRID_GUTTER, paddingTop: SPACING.md, paddingBottom: GRID_GUTTER },
  gridRow: { gap: GRID_SPACING, marginBottom: GRID_SPACING },
  gridItem: {
    width: CELL_SIZE,
    height: CELL_SIZE,
    borderRadius: SPACING.sm,
    overflow: 'hidden' as const,
    // A hairline edge, so a white image is a tile and not a hole in the page (hand test 35).
    backgroundColor: colors.surface,
  },
  gridImage: { width: '100%' as const, height: '100%' as const },
  gridEdge: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: SPACING.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  unavailableImage: {
    flex: 1,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    padding: SPACING.sm,
  },
  unavailableText: {
    ...TYPOGRAPHY.meta,
    color: colors.textSecondary,
    textAlign: 'center' as const,
  },
  selectionOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-start' as const,
    alignItems: 'flex-end' as const,
    padding: SPACING.sm - 2,
  },
  // Chosen is emerald, the one in-use colour, as an edge rather than a tint over the picture.
  selectionOverlaySelected: { borderWidth: 2, borderColor: colors.primary, borderRadius: SPACING.sm },
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
  // The picture fills the screen on black, in either theme.
  imageScreen: { flex: 1, backgroundColor: '#000', justifyContent: 'center' as const },
  imageScreenPicture: { ...StyleSheet.absoluteFillObject },
  // A video centred on the dark screen, as an image is (hand test 81).
  videoScreenStage: { ...StyleSheet.absoluteFillObject, justifyContent: 'center' as const },
  imageScreenGone: { ...TYPOGRAPHY.body, color: VIEWER_INK, textAlign: 'center' as const, padding: SPACING.xl },
  imageScreenBar: {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    paddingHorizontal: SPACING.md,
  },
  imageScreenBarButton: {
    width: 44,
    height: 44,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  // The sheet's actions share its width, icon over label, so Animate, Save and Delete read as one row.
  imageSheetActions: {
    flexDirection: 'row' as const,
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.md,
    gap: SPACING.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  imageSheetAction: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center' as const,
    paddingVertical: SPACING.md,
    borderRadius: SPACING.sm,
    backgroundColor: colors.surfaceLight,
  },
  imageSheetActionText: { ...TYPOGRAPHY.meta, color: colors.text, marginTop: SPACING.xs },
  imageSheetActionDestructive: { color: colors.error },
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

const createVideoStyles = (colors: ThemeColors) => ({
  videoList: { padding: SPACING.md },
  // Glass like every card.
  videoRow: {
    ...cardSurface(colors),
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    padding: SPACING.lg,
    marginBottom: SPACING.sm,
    gap: SPACING.md,
  },
  videoRowBody: { flex: 1 },
  videoRowTitle: { color: colors.text },
  videoRowMeta: { color: colors.textMuted },
  videoPlayer: { width: '100%' as const, backgroundColor: colors.background },
  videoScreenPlayer: { width: '100%' as const, backgroundColor: 'transparent' },
  videoPrompt: { color: colors.text, padding: SPACING.lg },
  videoDelete: { padding: SPACING.lg },
  videoDeleteText: { color: colors.error },
});

export const createStyles = (colors: ThemeColors, shadows: ThemeShadows) => ({
  ...createHeaderStyles(colors, shadows),
  ...createGridStyles(colors),
  ...createViewerStyles(colors),
  ...createVideoStyles(colors),
});
