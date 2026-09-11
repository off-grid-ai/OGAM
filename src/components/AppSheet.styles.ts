import type { ThemeColors, ThemeShadows } from '../theme';
import { TYPOGRAPHY, SPACING } from '../constants';

export const createStyles = (colors: ThemeColors, shadows: ThemeShadows) => ({
  container: {
    flex: 1,
    justifyContent: 'flex-end' as const,
  },
  backdrop: {
    position: 'absolute' as const,
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: '#000000',
  },
  keyboardUnderlay: {
    position: 'absolute' as const,
    left: 0,
    right: 0,
    bottom: 0,
  },
  sheet: {
    overflow: 'hidden' as const,
    ...shadows.large,
  },
  handleContainer: {
    alignItems: 'center' as const,
    paddingVertical: SPACING.sm,
  },
  handle: {},
  header: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: {
    ...TYPOGRAPHY.h3,
    color: colors.text,
    flex: 1,
    marginRight: SPACING.md,
  },
  headerClose: {
    ...TYPOGRAPHY.body,
    color: colors.primary,
  },
});
