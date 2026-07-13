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
  button: {
    flex: 1,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
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
