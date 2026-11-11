/**
 * HAPPY-PATH (UI, BEHAVIORAL) — delete a conversation the way a user does: a chat created by sending a
 * message is deleted from the Home "Recent" list (long-press → Chat options → Delete → confirm) and
 * disappears. There is no swipe-to-delete: it removed chats by accident.
 *
 * Real ChatScreen (to create the chat via a real send) + real HomeScreen + real chatStore; only native leaves
 * faked. No deleteConversation() shortcut. (Editing a message is covered behaviorally by editMessage.happy;
 * move-to-project is behind a modal selector — see the status doc.)
 */
import { setupChatScreen } from '../../harness/chatHarness';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {},
  useIsFocused: () => true,
}));

describe('happy — delete a conversation from the long-press menu', () => {
  it('a sent chat is deleted from Recent via long-press and disappears; no swipe delete exists', async () => {
    const h = await setupChatScreen({ engine: 'litert' });
    h.render();
    // Create a real conversation by sending a message.
    await h.send('trip planning ideas', { content: 'Here are some ideas.' });
    await h.rtl.waitFor(() => { expect(h.view!.queryByText(/Here are some ideas\./)).not.toBeNull(); });

    // Go to Home (same store) — the chat shows in Recent, titled from its first message.
    /* eslint-disable @typescript-eslint/no-var-requires */
    const React = require('react');
    const { HomeScreen } = require('../../../src/screens/HomeScreen');
    /* eslint-enable @typescript-eslint/no-var-requires */
    const home = h.rtl.render(React.createElement(HomeScreen, { navigation: { navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} } }));
    await h.rtl.waitFor(() => { expect(home.queryByText('trip planning ideas')).not.toBeNull(); });

    expect(home.queryByTestId('delete-conversation-button')).toBeNull();
    // Long-press opens the same options as the Chats tab; pick Delete, then confirm.
    h.rtl.fireEvent(home.getByText('trip planning ideas'), 'longPress');
    await h.rtl.waitFor(() => { expect(home.queryByText('Chat options')).not.toBeNull(); });
    expect(home.getByText('Rename')).toBeTruthy();
    expect(home.getByText('Set chat PIN')).toBeTruthy();
    expect(home.getByText('Archive')).toBeTruthy();
    h.rtl.fireEvent.press(home.getByText('Delete'));
    const { UndoBar } = require('../../../src/chats/UndoBar');
    const bar = h.rtl.render(React.createElement(UndoBar));

    // The conversation is gone from the Recent list at once, with a short chance to undo it.
    await h.rtl.waitFor(() => { expect(bar.queryByText('Chat deleted')).not.toBeNull(); });
    expect(require('../../../src/stores').useChatStore.getState().conversations).toHaveLength(0);

    // Undo puts it back.
    h.rtl.fireEvent.press(bar.getByTestId('undo-delete'));
    expect(require('../../../src/stores').useChatStore.getState().conversations).toHaveLength(1);
    await h.rtl.waitFor(() => { expect(bar.queryByTestId('undo-bar')).toBeNull(); });
  });
});
