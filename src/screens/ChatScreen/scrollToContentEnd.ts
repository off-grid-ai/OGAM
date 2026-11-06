import type { FlatList } from 'react-native';

/** The native scroll view under a FlatList, as far as this module needs it. */
type NativeScrollView = { scrollToEnd?: (options: { animated: boolean }) => void };

/**
 * Brings a chat list to the end of its laid-out content.
 *
 * The native scroll view works the end out from its real content size and frame, at the moment it
 * scrolls. FlatList.scrollToEnd works it out in JS from the row heights it has measured so far. When
 * a chat opens, the first content-size change arrives before any row has reported its height, so
 * that sum is 0 and FlatList scrolls to offset 0: the oldest message. Device log, cold open: content
 * 1959 pt, rows measured 0, offset 0. The later re-pins run on timers, and on a cold start the JS
 * timers waited 22 s, so the chat stayed at its oldest message.
 */
export const scrollToContentEnd = (
  list: FlatList | null | undefined,
  animated: boolean,
): void => {
  const scrollView = list?.getNativeScrollRef() as NativeScrollView | null | undefined;
  scrollView?.scrollToEnd?.({ animated });
};
