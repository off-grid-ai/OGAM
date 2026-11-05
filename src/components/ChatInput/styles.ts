import { StyleSheet } from 'react-native';
import type { ThemeColors, ThemeShadows } from '../../theme';
import { FONTS, TYPOGRAPHY, SPACING } from '../../constants';
import { Platform } from 'react-native';

export const PILL_ICON_SIZE = 32;
export const ANIM_DURATION_IN = 180;
export const ANIM_DURATION_OUT = 200;
const TOOL_WARNING_COLOR = '#F59E0B';

export const createStyles = (colors: ThemeColors, shadows: ThemeShadows) => ({
  // The bar holds one box, edge to edge: anything queued or attached above it keeps the side inset.
  // Transparent: the living field shows around the floating composer.
  container: {
    backgroundColor: 'transparent',
  },
  aboveComposer: { paddingHorizontal: 12 },
  // Attachment previews row
  attachmentsContainer: {
    marginBottom: 6,
  },
  attachmentsContent: {
    gap: 8,
  },
  attachmentPreview: {
    position: 'relative' as const,
    width: 60,
    height: 60,
    borderRadius: 8,
    overflow: 'hidden' as const,
  },
  attachmentImage: {
    width: '100%' as const,
    height: '100%' as const,
  },
  documentPreview: {
    width: '100%' as const,
    height: '100%' as const,
    backgroundColor: colors.surface,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    padding: 4,
  },
  documentName: {
    fontSize: 10,
    fontFamily: FONTS.mono,
    color: colors.textMuted,
    textAlign: 'center' as const,
    marginTop: 4,
  },
  documentStatus: {
    fontSize: 9,
    fontFamily: FONTS.mono,
    color: colors.primary,
    textAlign: 'center' as const,
    marginTop: 2,
  },
  removeAttachment: {
    position: 'absolute' as const,
    top: 2,
    right: 2,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.error,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  removeAttachmentText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '500' as const,
    marginTop: -2,
  },
  // Queued messages (above input)
  queueList: {
    marginBottom: 4,
    gap: 2,
  },
  queueItem: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: colors.surface,
    borderRadius: 8,
    paddingLeft: 8,
    gap: 2,
  },
  queueItemText: {
    flex: 1,
    fontSize: 12,
    color: colors.textSecondary,
  },
  queueResumeButton: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    backgroundColor: colors.primary,
  },
  queueResumeText: {
    fontSize: 11,
    fontFamily: FONTS.mono,
    fontWeight: '500' as const,
    color: colors.background,
  },
  // Queue header row
  queueRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
  },
  queueBadge: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: `${colors.primary}20`,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    gap: 4,
    flex: 1,
  },
  queueBadgeText: {
    fontSize: 11,
    fontFamily: FONTS.mono,
    fontWeight: '500' as const,
    color: colors.primary,
  },
  queuePreview: {
    fontSize: 11,
    fontFamily: FONTS.mono,
    fontWeight: '300' as const,
    color: colors.textMuted,
    flex: 1,
  },
  queueClearButton: {
    padding: 4,
  },
  // Main input row (pill + circular button)
  transcriptionNotice: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textSecondary,
    marginBottom: SPACING.xs,
  },
  // The send button sits 12 in from the right edge; the styles above scroll to the edge.
  mainRow: {
    flexDirection: 'row' as const,
    alignItems: 'flex-end' as const,
    gap: 8,
    paddingRight: 12,
  },
  // Pill container
  pill: {
    flex: 1,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: colors.surface,
    borderRadius: 24,
    paddingLeft: 16,
    paddingRight: 4,
    paddingVertical: 6,
    minHeight: 56,
    borderWidth: 1,
    borderColor: 'transparent',
    ...shadows.small,
  },
  pillFocused: {
    borderColor: `${colors.primary}80`,
    ...shadows.glow,
  },
  // One box, edge to edge, in every mode: image or video mode adds the styles at its top, and nothing else moves.
  // Only the top corners are rounded; the input inside draws no edge of its own (the theme shadow is a boxShadow,
  // so it is cleared as one). Its bottom padding (with the home-indicator inset) is set where it is drawn.
  // Desktop's composer: a floating rounded box with a hairline edge over the living field, not a slab
  // edge to edge. Image or video mode still adds its style row at the top, inside the box.
  composer: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderLight,
    marginHorizontal: 12,
    overflow: 'hidden' as const,
    paddingTop: 4,
    paddingBottom: 8,
    ...shadows.small,
  },
  // Focus draws light to the field: the edge turns emerald with a soft emerald ring (desktop's composer).
  composerFocused: {
    borderColor: colors.heroBorder,
    boxShadow: `0px 0px 0px 4px ${colors.selectedFill}, 0px 0px 24px ${colors.selectedFill}`,
  },
  pillInComposer: { backgroundColor: 'transparent', borderRadius: 0, boxShadow: [] },
  pillInput: {
    flex: 1,
    color: colors.text,
    fontSize: 15,
    // What you type is reading text: Geist, not the Mono kept for labels and numbers.
    fontFamily: FONTS.sans,
    minHeight: 36,
    maxHeight: 150,
    textAlignVertical: 'top' as const,
    paddingTop: Platform.OS === 'ios' ? 10 : 6,
    paddingBottom: Platform.OS === 'ios' ? 10 : 6,
    paddingRight: 4,
  },
  assistantButton: {
    width: 36,
    height: 44,
    marginLeft: -SPACING.sm,
    marginRight: SPACING.xs,
    paddingHorizontal: 0,
    paddingVertical: 0,
  },
  assistantGateContent: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.xl,
    gap: SPACING.lg,
  },
  assistantGateText: {
    ...TYPOGRAPHY.body,
    color: colors.textSecondary,
  },
  // Push-to-talk hint that replaces the text field while holding to record: a recording dot on the
  // left, "‹ Slide to cancel" centred (the mic sits to the right, outside the pill).
  recordingRow: {
    flex: 1,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    minHeight: 36,
  },
  recordingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.primary,
    marginRight: SPACING.sm,
  },
  slideToCancel: {
    flex: 1,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 2,
  },
  slideToCancelText: {
    ...TYPOGRAPHY.body,
    color: colors.textMuted,
    fontFamily: FONTS.mono,
  },
  // Icons row inside pill (right side)
  pillIcons: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 0,
  },
  pillIconButton: {
    width: PILL_ICON_SIZE,
    height: PILL_ICON_SIZE,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    borderRadius: PILL_ICON_SIZE / 2,
    position: 'relative' as const,
  },
  pillIconButtonActive: {},
  pillIconButtonDisabled: {
    opacity: 0.4,
  },
  iconWrapper: {
    position: 'relative' as const,
  },
  toolWarningDot: {
    position: 'absolute' as const,
    top: -2,
    right: -2,
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: TOOL_WARNING_COLOR,
  },
  // Small badge on image gen icon
  iconBadge: {
    position: 'absolute' as const,
    top: 2,
    right: 2,
    minWidth: 16,
    height: 14,
    borderRadius: 7,
    paddingHorizontal: 3,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  iconBadgeOn: {
    backgroundColor: colors.primary,
  },
  iconBadgeOff: {
    backgroundColor: colors.textMuted,
  },
  iconBadgeAuto: {
    backgroundColor: colors.textMuted,
  },
  iconBadgeText: {
    fontSize: 7,
    fontFamily: FONTS.mono,
    fontWeight: '500' as const,
    color: colors.background,
    lineHeight: 10,
  },
  // Circular action button (send/stop/mic)
  circleButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    backgroundColor: colors.primary,
    ...shadows.small,
  },
  // Stop is a quiet raised control: red is kept for errors, and a full-contrast disc would outshine
  // the emerald that marks the one important thing on screen.
  circleButtonStop: {
    backgroundColor: colors.surfaceLight,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  // Stop control sized to match the audio-mode mic (AUDIO_MIC_SIZE), so the
  // center slot keeps one footprint across mic / loading / stop — no layout jump
  // when generation starts or playback runs.
  circleButtonLarge: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    backgroundColor: colors.surfaceLight,
  },
  circleButtonIdle: {
    backgroundColor: colors.surface,
  },
  visionBadge: {
    backgroundColor: `${colors.primary}20`,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
  },
  visionBadgeText: {
    fontSize: 10,
    fontFamily: FONTS.mono,
    fontWeight: '500' as const,
    color: colors.primary,
  },
  // Audio mode layout
  audioModeRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: SPACING.md,
    paddingVertical: 2, // tight — the mic already gives the row its height
  },
  // Voice cycle button — shows icon + voice name
  audioVoiceButton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
    paddingHorizontal: SPACING.sm,
    height: 32,
    borderRadius: 16,
  },
  audioControlButton: {
    backgroundColor: colors.surface,
    ...shadows.small,
  },
  audioVoiceLabel: {
    ...TYPOGRAPHY.meta,
    color: colors.textSecondary,
  },
});
