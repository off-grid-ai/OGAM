import type { ThemeColors } from '../../theme';
import { TYPOGRAPHY, SPACING } from '../../constants';

/**
 * Shared pill-button styles for the advanced text-generation setting sections.
 * ONE source of truth used by BOTH surfaces (the Model Settings screen and the
 * in-chat Generation Settings modal), so the two can never drift again — the
 * spacing/label/copy divergence that produced the "GPU Layers kissing the NPU
 * button" bug lived in two hand-maintained copies of exactly these styles.
 */
export const createTextGenAdvancedStyles = (colors: ThemeColors) => ({
  container: {
    marginBottom: SPACING.lg,
  },
  compactContainer: {
    marginBottom: 0,
  },
  info: {
    marginBottom: SPACING.md,
  },
  label: {
    ...TYPOGRAPHY.body,
    color: colors.text,
    marginBottom: SPACING.sm,
  },
  desc: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  buttons: {
    flexDirection: 'row' as const,
    gap: SPACING.sm,
  },
  // A segment is a third of the card: a long label ("Aggressive") broke mid-word on Android's wider
  // metrics behind 16 pt of side padding, so the padding is small and the label stays one line.
  button: {
    flex: 1,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.xs,
    justifyContent: 'center' as const,
    borderRadius: 8,
    backgroundColor: 'transparent' as const,
    alignItems: 'center' as const,
    borderWidth: 1,
    borderColor: colors.border,
  },
  buttonActive: {
    backgroundColor: 'transparent' as const,
    borderColor: colors.primary,
  },
  buttonText: {
    ...TYPOGRAPHY.body,
    color: colors.textSecondary,
    textAlign: 'center' as const,
  },
  buttonTextActive: {
    color: colors.primary,
  },
  // Separate the layers slider from the backend button row above it.
  layersInline: {
    marginTop: SPACING.md,
    paddingTop: SPACING.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  warning: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.warning,
    marginTop: SPACING.xs,
    lineHeight: 18,
  },
});
