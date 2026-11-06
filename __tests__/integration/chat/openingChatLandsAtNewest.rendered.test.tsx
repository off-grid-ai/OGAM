import { ScrollView } from 'react-native';
import { setupChatScreen } from '../../harness/chatHarness';

jest.unmock('@react-navigation/native');

/**
 * Hand test 58 (iPhone, cold launch): the first chat opened from Home sat at its OLDEST message.
 * Device log of that open: the list's first content-size change (1959 pt of content in a 747 pt
 * list) arrived before any row had reported its height, and FlatList.scrollToEnd, which sums the
 * measured rows, scrolled to offset 0. The re-pins after it run on timers, and on that cold start
 * the JS timers waited 22 s.
 *
 * A second cold open stopped two turns short: the native scroll view still had the content size
 * from before that layout when the scroll ran.
 *
 * The invariant: the content-size change alone brings an opening chat to the end of the content it
 * reports, with no row measured, no timer run, and the native size one layout behind. The native
 * scroll view is modelled as the device has it: scrollTo goes to the offset it is given; scrollToEnd
 * goes to ITS content height minus list height.
 */
describe('an opening chat lands at its newest message', () => {
  it.each([
    ['the native size is current', 1959],
    ['the native size is one layout behind', 1500],
  ])('ends at the content end on the first content-size change when %s', async (_case, nativeContentHeight) => {
    const h = await setupChatScreen({ navigation: 'real', engine: 'llama', platform: 'ios' });
    h.render();
    await h.send('[test] List five fruits, one short line each.', { text: 'Apple\nBanana\nCherry' });
    await h.rtl.waitFor(() => expect(h.view!.getByText(/Cherry/)).toBeVisible());

    // Leave the chat and open it again from the Chats list, as the person does.
    h.rtl.fireEvent.press(h.view!.getByLabelText('Back'));
    await h.rtl.waitFor(() => expect(h.view!.queryByTestId('chat-screen')).toBeNull());
    const chats = await h.openChatList();
    const row = await h.rtl.waitFor(() => chats.getByText('[test] List five fruits, one short line each.'));

    const native = { offset: -1, contentHeight: 0, listHeight: 0 };
    const scrollTo = jest
      .spyOn(ScrollView.prototype, 'scrollTo')
      .mockImplementation(((options: { y?: number }) => {
        native.offset = options?.y ?? 0;
      }) as never);
    const scrollToEnd = jest
      .spyOn(ScrollView.prototype, 'scrollToEnd')
      .mockImplementation((() => {
        native.offset = Math.max(0, native.contentHeight - native.listHeight);
      }) as never);
    // Hold every timer and frame: on the cold start none of them ran for 22 s.
    jest.useFakeTimers();
    try {
      h.rtl.fireEvent.press(row);
      const reopened = h.render();
      const list = reopened.getByTestId('chat-message-list');

      // The order the device delivered: the list's frame, then its content size. No row layout.
      native.listHeight = 747;
      h.rtl.fireEvent(list, 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 440, height: 747 } } });
      native.contentHeight = nativeContentHeight;
      h.rtl.fireEvent(list, 'contentSizeChange', 440, 1959);

      expect(native.offset).toBe(1959 - 747);
    } finally {
      jest.useRealTimers();
      scrollTo.mockRestore();
      scrollToEnd.mockRestore();
    }
  });
});

/**
 * The same cold open, a longer chat: the list renders rows past its first batch on a timer, and the
 * JS timers waited 6 to 22 s while Sync ran. A chat longer than one batch therefore showed its older
 * rows, pinned to their end, until the timers ran. The invariant: the newest message is rendered by
 * the first render of an opening chat, with no timer run.
 */
describe('an opening chat renders its newest message first', () => {
  it('has the newest reply on screen with every timer and frame held', async () => {
    const h = await setupChatScreen({ navigation: 'real', engine: 'llama', platform: 'ios' });
    h.render();
    const turns = 12;
    for (let turn = 1; turn <= turns; turn += 1) {
      await h.send(`[test] Turn ${turn}.`, { text: `Reply number ${turn}.` });
    }

    h.rtl.fireEvent.press(h.view!.getByLabelText('Back'));
    await h.rtl.waitFor(() => expect(h.view!.queryByTestId('chat-screen')).toBeNull());
    const chats = await h.openChatList();
    const row = await h.rtl.waitFor(() => chats.getByText('[test] Turn 1.'));

    jest.useFakeTimers();
    try {
      h.rtl.fireEvent.press(row);
      const reopened = h.render();
      expect(reopened.getByText(`Reply number ${turns}.`)).toBeVisible();
    } finally {
      jest.useRealTimers();
    }
  });
});
