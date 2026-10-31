import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { reportScroll } from '../services/analytics/interactions';

/**
 * Spread on a screen's main ScrollView or list: how far down it the person got is counted into
 * `session_summary.max_scroll_pct` (docs/ANALYTICS.md), in quarters, on the device. A list that
 * fits on screen reports nothing.
 */
export const SCROLL_DEPTH_PROPS = {
  scrollEventThrottle: 250,
  onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const room = contentSize.height - layoutMeasurement.height;
    if (room > 0) reportScroll(contentOffset.y / room);
  },
} as const;
