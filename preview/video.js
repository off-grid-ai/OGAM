// The preview's react-native-video: the browser's own <video>, so guide clips play. Muted and looping
// as the app asks; only the props the app's screens use are read.
import React from 'react';
import { StyleSheet } from 'react-native';

export const ResizeMode = { CONTAIN: 'contain', COVER: 'cover', STRETCH: 'fill', NONE: 'none' };
export const ViewType = { TEXTURE: 0, SURFACE: 1, SURFACE_SECURE: 2 };

const Video = React.forwardRef(function Video(props, ref) {
  const { source, style, resizeMode, repeat, muted, paused, accessibilityLabel } = props;
  return React.createElement('video', {
    ref,
    src: source && source.uri,
    style: { ...StyleSheet.flatten(style), objectFit: resizeMode || 'contain' },
    loop: !!repeat,
    muted: muted !== false,
    autoPlay: !paused,
    playsInline: true,
    'aria-label': accessibilityLabel,
  });
});

export default Video;
