import { Keyboard } from 'react-native';
import { setupChatScreen } from '../../harness/chatHarness';

jest.unmock('@react-navigation/native');

/**
 * Hand test (iPhone, keyboard up): a reply streamed below the visible list and the list never scrolled
 * to it; a tap on the list left the keyboard up. The list's position rule jumped to the OLDEST message
 * on content changes near the start (autoscrollToTopThreshold is for inverted lists), and every message
 * row swallowed taps without closing the keyboard.
 */
describe('chat list with the keyboard up', () => {
  it('keeps the reader in place but never sends the list to the oldest message', async () => {
    const h = await setupChatScreen({ navigation: 'real', engine: 'llama', platform: 'ios' });
    h.render();
    await h.send('[test] Count to five.', { text: '1 2 3 4 5' });
    const list = await h.rtl.waitFor(() => h.view!.getByTestId('chat-message-list'));
    const keep = list.props.maintainVisibleContentPosition;
    // A reader who scrolled up keeps their place while the reply grows...
    expect(keep).toEqual({ minIndexForVisible: 0 });
    // ...and no content change can pull a near-the-start offset up to the first message.
    expect(keep.autoscrollToTopThreshold).toBeUndefined();
  });

  it('a tap on a message closes the keyboard; a long press still opens its actions', async () => {
    const h = await setupChatScreen({ navigation: 'real', engine: 'llama', platform: 'ios' });
    h.render();
    await h.send('[test] Count to five.', { text: '1 2 3 4 5' });
    const dismiss = jest.spyOn(Keyboard, 'dismiss');
    const reply = await h.rtl.waitFor(() => h.view!.getAllByTestId('assistant-message')[0]);
    h.rtl.fireEvent.press(reply);
    expect(dismiss).toHaveBeenCalledTimes(1);

    const user = h.view!.getAllByTestId('user-message')[0];
    h.rtl.fireEvent(user, 'longPress');
    // The long press opens the message's actions and does not count as a tap.
    expect(dismiss).toHaveBeenCalledTimes(1);
    await h.rtl.waitFor(() => expect(h.view!.getByText('Copy')).toBeTruthy());
    dismiss.mockRestore();
  });
});
