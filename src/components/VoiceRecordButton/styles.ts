import type { ThemeColors, ThemeShadows } from '../../theme';

export const createStyles = (colors: ThemeColors, _shadows: ThemeShadows) => ({
  container: {
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginBottom: 2,
  },
  rippleRing: {
    position: 'absolute' as const,
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: colors.primary,
    backgroundColor: 'transparent',
  },
  buttonWrapper: {
  },
  button: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surfaceLight,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  buttonAsSend: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  // Audio (voice) mode: a larger, clearly-circular bordered mic so it reads as
  // the primary "press to speak" action.
  buttonAudio: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.primary,
  },
  buttonAsSendUnavailable: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surfaceLight,
    borderWidth: 1,
    borderColor: colors.border,
    opacity: 0.5,
  },
  buttonAsSendLoading: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.primary,
    borderTopColor: 'transparent',
  },
  // Audio (voice) mode loading/transcribing: a 56px spinner ring that matches the
  // buttonAudio mic footprint EXACTLY, so the center slot keeps one size across
  // mic / loading / transcribing / stop — the bottom bar never grows or shrinks.
  buttonAudioLoading: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.primary,
    borderTopColor: 'transparent',
  },
  buttonAudioTranscribing: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.info,
    borderTopColor: 'transparent',
  },
  buttonRecording: {
    backgroundColor: colors.primary,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonLoading: {
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.primary,
    borderTopColor: 'transparent',
  },
  buttonTranscribing: {
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.info,
    borderTopColor: 'transparent',
  },
  buttonUnavailable: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed' as const,
  },
  loadingContainer: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
  },
  loadingIndicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.primary,
  },
  loadingText: {
    fontSize: 11,
    color: colors.primary,
    marginLeft: 6,
  },
  transcribingText: {
    fontSize: 11,
    color: colors.info,
    marginLeft: 6,
  },
  micIcon: {
    alignItems: 'center' as const,
  },
  micBody: {
    width: 8,
    height: 12,
    backgroundColor: colors.primary,
    borderRadius: 4,
  },
  micBodyRecording: {
    backgroundColor: colors.surface,
  },
  micBodyAsSend: {
    backgroundColor: colors.text,
  },
  micBodyUnavailable: {
    backgroundColor: colors.textMuted,
  },
  micBase: {
    width: 12,
    height: 3,
    backgroundColor: colors.primary,
    borderRadius: 1.5,
    marginTop: 2,
  },
  unavailableSlash: {
    position: 'absolute' as const,
    width: 24,
    height: 2,
    backgroundColor: colors.textMuted,
    transform: [{ rotate: '-45deg' }],
  },
  cancelHint: {
    position: 'absolute' as const,
    left: -100,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: `${colors.primary}40`,
    borderRadius: 12,
  },
  cancelHintText: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '500' as const,
  },
  partialResultContainer: {
    position: 'absolute' as const,
    right: 50,
    maxWidth: 200,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: colors.surface,
    borderRadius: 12,
  },
  partialResultText: {
    color: colors.text,
    fontSize: 12,
  },
});
