import type { ThemeColors, ThemeShadows } from '../../theme';
import { TYPOGRAPHY, SPACING, FONTS } from '../../constants';

const createBubbleStyles = (colors: ThemeColors) => ({
  container: {
    marginVertical: 8,
    paddingHorizontal: 16,
  },
  userContainer: {
    alignItems: 'flex-end' as const,
  },
  assistantContainer: {
    alignItems: 'flex-start' as const,
  },
  systemInfoContainer: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    alignItems: 'center' as const,
  },
  systemInfoText: {
    ...TYPOGRAPHY.meta,
    color: colors.textMuted,
    textAlign: 'center' as const,
  },
  toolCallPreText: {
    alignSelf: 'flex-start' as const,
    paddingBottom: 6,
    width: '100%' as any,
  },
  toolStatusRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    paddingVertical: 2,
  },
  toolStatusText: {
    fontSize: 12,
    fontFamily: FONTS.mono,
    color: colors.textMuted,
    flex: 1,
  },
  toolDetailContainer: {
    marginTop: 6,
    paddingTop: 6,
    paddingHorizontal: 4,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    alignSelf: 'stretch' as const,
    width: '100%' as const,
    overflow: 'hidden' as const,
  },
  toolDetailText: {
    fontSize: 11,
    fontFamily: FONTS.mono,
    color: colors.textSecondary,
    lineHeight: 16,
  },
  bubble: {
    maxWidth: '85%' as const,
    borderRadius: 8,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
  },
  bubbleWithAttachments: {
    paddingHorizontal: 8,
    paddingTop: 8,
    paddingBottom: 12,
  },
  userBubble: {
    backgroundColor: colors.primary,
    borderBottomRightRadius: 4,
  },
  assistantBubble: {
    backgroundColor: colors.surface,
    borderBottomLeftRadius: 4,
    minWidth: '85%' as const,
  },
  attachmentsContainer: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: 4,
    marginBottom: 8,
  },
  attachmentWrapper: {
    borderRadius: 12,
    overflow: 'hidden' as const,
  },
  documentBadge: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  documentBadgeUser: {
    backgroundColor: 'rgba(0, 0, 0, 0.15)',
  },
  documentBadgeAssistant: {
    backgroundColor: colors.surfaceLight,
  },
  documentBadgeText: {
    fontSize: 12,
    fontFamily: FONTS.mono,
    fontWeight: '500' as const,
    maxWidth: 140,
  },
  documentBadgeTextUser: {
    color: colors.background,
  },
  documentBadgeTextAssistant: {
    color: colors.text,
  },
  documentBadgeSize: {
    fontSize: 10,
    fontFamily: FONTS.mono,
  },
  documentBadgeSizeUser: {
    color: 'rgba(0, 0, 0, 0.4)',
  },
  documentBadgeSizeAssistant: {
    color: colors.textMuted,
  },
  attachmentImage: {
    width: 140,
    height: 140,
    borderRadius: 12,
  },
});

const createThinkingStyles = (colors: ThemeColors) => ({
  text: {
    ...TYPOGRAPHY.body,
    lineHeight: 20,
    paddingHorizontal: 0,
  },
  userText: {
    color: colors.background,
    fontWeight: '400' as const,
  },
  assistantText: {
    color: colors.text,
    fontWeight: '400' as const,
  },
  cursor: {
    color: colors.primary,
    fontWeight: '300' as const,
  },
  thinkingContainer: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingVertical: 4,
  },
  thinkingDots: {
    flexDirection: 'row' as const,
    marginRight: 8,
  },
  thinkingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.primary,
    marginHorizontal: 2,
  },
  thinkingText: {
    ...TYPOGRAPHY.body,
    color: colors.textSecondary,
    fontStyle: 'italic' as const,
  },
  thinkingBlock: {
    backgroundColor: colors.surfaceLight,
    borderRadius: 8,
    marginBottom: 8,
    overflow: 'hidden' as const,
    width: '100%' as const,
  },
  /** Constrains the ThinkingBlock when rendered outside a message bubble (e.g. ToolCallWithThinking) */
  thinkingBlockWrapper: {
    width: '88%' as const,
    alignSelf: 'flex-start' as const,
  },
  thinkingHeader: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    padding: 8,
    gap: 6,
  },
  thinkingHeaderIconBox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    backgroundColor: `${colors.primary}30`,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  thinkingHeaderIconText: {
    ...TYPOGRAPHY.label,
    fontWeight: '600' as const,
    color: colors.primary,
  },
  thinkingHeaderTextContainer: {
    flex: 1,
    marginRight: SPACING.xs,
  },
  thinkingHeaderText: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textMuted,
    fontWeight: '500' as const,
  },
  thinkingPreview: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.text,
    marginTop: 6,
    lineHeight: 18,
    opacity: 0.8,
  },
  thinkingToggle: {
    ...TYPOGRAPHY.meta,
    color: colors.textMuted,
  },
  thinkingBlockText: {
    ...TYPOGRAPHY.h3,
    color: colors.textSecondary,
    lineHeight: 18,
    padding: SPACING.sm,
    paddingTop: 0,
    fontStyle: 'italic' as const,
  },
  thinkingBlockContent: {
    padding: SPACING.sm,
    paddingTop: 0,
  },
  streamingThinkingHint: {
    marginTop: 8,
  },
  metaRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    marginTop: 4,
    marginHorizontal: 8,
    gap: 8,
  },
  timestamp: {
    ...TYPOGRAPHY.meta,
    color: colors.textMuted,
  },
  generationTime: {
    ...TYPOGRAPHY.meta,
    fontWeight: '400' as const,
    color: colors.primary,
  },
  actionHint: {
    padding: 4,
  },
  actionHintText: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textMuted,
    letterSpacing: 1,
  },
  generationMetaRow: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    alignItems: 'center' as const,
    marginTop: 2,
    marginHorizontal: 8,
    gap: 3,
  },
  generationMetaText: {
    ...TYPOGRAPHY.meta,
    color: colors.textMuted,
    flexShrink: 1,
  },
  generationMetaSep: {
    ...TYPOGRAPHY.meta,
    color: colors.textMuted,
    opacity: 0.5,
  },
});

const createActionStyles = (colors: ThemeColors) => ({
  actionSheetContent: {
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.xl,
  },
  actionSheetItem: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.sm,
    gap: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  actionSheetText: {
    ...TYPOGRAPHY.body,
    color: colors.text,
  },
  editSheetContent: {
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.xl,
  },
  selectTextContent: {
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.xl,
  },
  selectTextHint: {
    ...TYPOGRAPHY.meta,
    color: colors.textMuted,
    marginBottom: SPACING.sm,
  },
  selectTextScroll: {
    maxHeight: 360,
    backgroundColor: colors.surface,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: colors.border,
    padding: SPACING.md,
  },
  selectTextBody: {
    ...TYPOGRAPHY.body,
    fontFamily: FONTS.mono,
    color: colors.text,
  },
  editInput: {
    ...TYPOGRAPHY.body,
    fontFamily: FONTS.mono,
    backgroundColor: colors.surface,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: colors.border,
    padding: SPACING.md,
    color: colors.text,
    minHeight: 100,
    maxHeight: 300,
    textAlignVertical: 'top' as const,
  },
  editActions: {
    flexDirection: 'row' as const,
    gap: SPACING.sm,
    marginTop: SPACING.lg,
  },
  editButton: {
    flex: 1,
    paddingVertical: SPACING.md,
    borderRadius: 4,
    alignItems: 'center' as const,
    borderWidth: 1,
  },
  editButtonCancel: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
  },
  editButtonSave: {
    backgroundColor: 'transparent' as const,
    borderColor: colors.primary,
  },
  editButtonText: {
    ...TYPOGRAPHY.label,
    fontFamily: FONTS.mono,
    color: colors.textSecondary,
    letterSpacing: 1,
  },
  editButtonTextSave: {
    color: colors.primary,
    fontWeight: '600' as const,
  },
});

export const createStyles = (colors: ThemeColors, _shadows: ThemeShadows) => ({
  ...createBubbleStyles(colors),
  ...createThinkingStyles(colors),
  ...createActionStyles(colors),
});
