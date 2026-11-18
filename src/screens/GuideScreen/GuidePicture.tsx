/**
 * A guide picture in its glass frame: the take for the current theme, held at its own shape so
 * the page never jumps when it decodes. A tall phone shot stands centred; a wide one fills. A topic
 * with a clip plays it, muted and looping; with Reduce Motion on, its still shows instead.
 */
import React from 'react';
import { Image, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import Video, { ResizeMode, ViewType } from 'react-native-video';
import { useTheme, useThemedStyles } from '../../theme';
import type { ThemeColors } from '../../theme';
import { cardSurface } from '../../theme/surface';
import type { GuideMedia } from './guideTopics';

export const GuidePicture: React.FC<{ media: GuideMedia; label: string; height: number }> = ({
  media,
  label,
  height,
}) => {
  const { isDark } = useTheme();
  const styles = useThemedStyles(createStyles);
  const reducedMotion = useReducedMotion();
  const wide = media.aspect > 1;
  const shape = wide ? styles.wide : { height: height - 16, aspectRatio: media.aspect };
  return (
    <View style={[styles.frame, { height }]}>
      {media.clip && !reducedMotion ? (
        <Video
          source={{ uri: Image.resolveAssetSource(media.clip).uri }}
          style={shape}
          resizeMode={ResizeMode.CONTAIN}
          // Android: a TextureView moves with the page and its rounded frame; the default
          // SurfaceView sits apart and lags a beat behind while the page scrolls.
          viewType={ViewType.TEXTURE}
          repeat
          muted
          disableFocus
          playInBackground={false}
          // A looping preview is not something to watch: the screen may sleep as usual.
          preventsDisplaySleepDuringVideoPlayback={false}
          accessibilityLabel={label}
        />
      ) : (
        <Image source={isDark ? media.dark : media.light} style={shape} resizeMode="contain" accessibilityLabel={label} />
      )}
    </View>
  );
};

const createStyles = (colors: ThemeColors) => ({
  frame: {
    ...cardSurface(colors),
    overflow: 'hidden' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  wide: { width: '100%' as const, height: '100%' as const },
});
