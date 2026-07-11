/**
 * HAPPY-PATH (UI, BEHAVIORAL) — delete a conversation the way a user does: a chat created by sending a
 * message is swipe-deleted from the Home "Recent" list (tap the swipe-revealed delete → confirm) and
 * disappears.
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

describe('happy — delete a conversation via the real swipe gesture', () => {
  it('a sent chat is swipe-deleted from Recent and disappears', async () => {
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

    // Swipe-delete gesture: tap the swipe-revealed delete button, then confirm in the alert.
    h.rtl.fireEvent.press(home.getByTestId('delete-conversation-button'));
    h.rtl.fireEvent.press(await h.rtl.waitFor(() => home.getByText('Delete')));

    // The conversation is gone from the Recent list.
    await h.rtl.waitFor(() => { expect(home.queryByText('trip planning ideas')).toBeNull(); });
  });
});
