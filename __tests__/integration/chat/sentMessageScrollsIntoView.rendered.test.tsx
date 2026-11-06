import { FlatList } from 'react-native';
import { setupChatScreen } from '../../harness/chatHarness';

jest.unmock('@react-navigation/native');

/**
 * Hand test 50 (iPhone, keyboard up): a sent message stayed out of view for about five seconds. Your
 * own message is the one thing you always want to see, so sending brings the list to the end, even
 * when you had scrolled up to read. Real ChatScreen and pipeline; the list's scroll is the native edge.
 */
describe('a sent message scrolls into view', () => {
  it('brings the list to the end on send, even after the reader scrolled up', async () => {
    const h = await setupChatScreen({ navigation: 'real', engine: 'llama', platform: 'ios' });
    h.render();
    await h.send('[test] Count to five.', { text: '1 2 3 4 5' });
    const list = await h.rtl.waitFor(() => h.view!.getByTestId('chat-message-list'));
    // Let the first reply's own follow-the-reply scroll (a 100 ms timer) finish first.
    await h.rtl.act(() => new Promise(resolve => setTimeout(resolve, 200)));

    // The reader scrolls up, far from the end.
    h.rtl.fireEvent.scroll(list, {
      nativeEvent: { contentOffset: { y: 0 }, contentSize: { height: 5000, width: 400 }, layoutMeasurement: { height: 600, width: 400 } },
    });

    const scrollToEnd = jest.spyOn(FlatList.prototype, 'scrollToEnd');
    await h.send('[test] And to ten?', { text: '6 7 8 9 10' });
    await h.rtl.waitFor(() => expect(scrollToEnd).toHaveBeenCalledWith({ animated: true }));
    scrollToEnd.mockRestore();
  });
});
