import type { ThemeColors, ThemeShadows } from '../theme';
import { TYPOGRAPHY, SPACING } from '../constants';
import { createStyles as lessonStyles } from './LessonScreen.styles';

export const createStyles = (colors: ThemeColors, shadows: ThemeShadows) => ({
  ...lessonStyles(colors, shadows),
  callTop: { alignItems: 'center' as const, paddingTop: SPACING.xl, gap: SPACING.xs },
  avatar: {
    width: 88, height: 88, borderRadius: 44, borderWidth: 3, borderColor: colors.border, backgroundColor: colors.surface,
    alignItems: 'center' as const, justifyContent: 'center' as const,
  },
  avatarBig: { width: 112, height: 112, borderRadius: 56 },
  endRow: { alignItems: 'center' as const, paddingBottom: SPACING.xl },
  endBig: { width: 72, height: 72, borderRadius: 36 },
  avatarLive: { borderColor: colors.primary },
  callTitle: { ...TYPOGRAPHY.h2, color: colors.text, textAlign: 'center' as const, paddingHorizontal: SPACING.lg },
  status: { ...TYPOGRAPHY.bodySmall, color: colors.textSecondary, textAlign: 'center' as const, paddingHorizontal: SPACING.lg },
  transcriptScroll: { flex: 1 },
  transcript: { flexGrow: 1, padding: SPACING.lg, gap: SPACING.sm },
  bubble: { maxWidth: '85%' as const, padding: SPACING.md, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  bubbleMine: { alignSelf: 'flex-end' as const, borderColor: colors.primary },
  bubbleTheirs: { alignSelf: 'flex-start' as const },
  bubbleText: { ...TYPOGRAPHY.body, color: colors.text },
  hint: { padding: SPACING.md, borderRadius: 12, borderWidth: 1, borderColor: colors.primary, gap: SPACING.xs },
  controls: { flexDirection: 'row' as const, justifyContent: 'space-around' as const, alignItems: 'center' as const, padding: SPACING.lg },
  round: {
    width: 64, height: 64, borderRadius: 32, alignItems: 'center' as const, justifyContent: 'center' as const,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
  },
  talk: { width: 76, height: 76, borderRadius: 38, alignItems: 'center' as const, justifyContent: 'center' as const, backgroundColor: colors.primary },
  talkOn: { backgroundColor: colors.error },
  end: { backgroundColor: colors.error, borderColor: colors.error },
  controlLabel: { ...TYPOGRAPHY.meta, color: colors.textSecondary, textAlign: 'center' as const, marginTop: SPACING.xs },
  control: { alignItems: 'center' as const, width: 84 },
  scenario: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: SPACING.md, padding: SPACING.md, borderRadius: 12, borderWidth: 1, borderColor: colors.border },
  scenarioText: { flex: 1 },
  fix: { gap: 2, paddingVertical: SPACING.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
});
