import type { FlatList } from 'react-native';

/** The native scroll view under a FlatList, as far as this module needs it. */
type NativeScrollView = { scrollToEnd?: (options: { animated: boolean }) => void };

/** The content height a layout reported, and the height of the list that shows it. */
export type ContentExtent = { contentHeight: number; listHeight: number };

/**
 * Brings a chat list to the end of its laid-out content.
 *
 * FlatList.scrollToEnd works the end out in JS from the row heights it has measured so far. When a
 * chat opens, the first content-size change arrives before any row has reported its height, so that
 * sum is 0 and FlatList scrolls to offset 0: the oldest message. Device log, cold open: content
 * 1959 pt, rows measured 0, offset 0. The later re-pins run on timers, and on a cold start the JS
 * timers waited 22 s, so the chat stayed at its oldest message.
 *
 * With an extent from a content-size change, the offset comes from that layout itself. The native
 * scroll view's own end can still be the size before that layout, because the scroll command can
 * run before the new content is mounted (device, cold open: the list stopped two turns short).
 * Without an extent, the native scroll view works the end out from its own content size.
 */
export const scrollToContentEnd = (
  list: FlatList | null | undefined,
  animated: boolean,
  extent?: ContentExtent,
): void => {
  if (!list) return;
  if (extent && extent.listHeight > 0) {
    list.scrollToOffset({ offset: Math.max(0, extent.contentHeight - extent.listHeight), animated });
    return;
  }
  const scrollView = list.getNativeScrollRef() as NativeScrollView | null | undefined;
  scrollView?.scrollToEnd?.({ animated });
};
