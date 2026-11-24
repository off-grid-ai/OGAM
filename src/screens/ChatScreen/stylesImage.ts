import { Dimensions } from 'react-native';
import type { ThemeColors, ThemeShadows } from '../../theme';
import { SPACING } from '../../constants';

const VIEWER_BUTTON = 56;

export const createImageStyles = (colors: ThemeColors, _shadows: ThemeShadows) => ({
  imageViewerContainer: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.95)',
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  imageViewerBackdrop: {
    position: 'absolute' as const,
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  imageViewerContent: {
    width: '100%' as const,
    height: '100%' as const,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  fullscreenImage: {
    width: Dimensions.get('window').width,
    height: Dimensions.get('window').height * 0.7,
  },
  // The actions share the screen's width: any number of them fits on the narrowest phone.
  imageViewerActions: {
    flexDirection: 'row' as const,
    position: 'absolute' as const,
    left: SPACING.lg,
    right: SPACING.lg,
    justifyContent: 'space-evenly' as const,
  },
  imageViewerButton: {
    width: VIEWER_BUTTON,
    height: VIEWER_BUTTON,
    borderRadius: VIEWER_BUTTON / 2,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    backgroundColor: colors.surface,
  },
  /** Icon buttons: the name is the accessibility label, not a caption. */
  imageViewerButtonText: {
    display: 'none' as const,
  },
  imageViewerClose: {
    position: 'absolute' as const,
    right: SPACING.lg,
    width: VIEWER_BUTTON,
    height: VIEWER_BUTTON,
    borderRadius: VIEWER_BUTTON / 2,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    backgroundColor: colors.surface,
  },
});
