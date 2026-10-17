/**
 * HAPPY-PATH (UI integration) — chat history across a relaunch.
 *
 * Real ChatScreen and ChatsListScreen, real gestures (send, Resend from the action menu, the ‹ › version
 * arrows, a tap on a chat row), the real chat store saving to AsyncStorage through its hydration gate.
 * A relaunch is a fresh module graph over the saved storage (chatHarness.relaunchApp): the stores read
 * their saved state as they are created, exactly as at launch. Only native leaves are faked; the one
 * storage failure is at the AsyncStorage boundary.
 */
import {
  relaunchApp,
  renderedThread,
  setupChatScreen,
} from '../../harness/chatHarness';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: (screen: string, params?: Record<string, unknown>) =>
      require('../../harness/chatHarness').recordNavigation(screen, params),
    goBack: () => {},
    setOptions: () => {},
    addListener: () => () => {},
  }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {},
  useIsFocused: () => true,
}));

type View = { queryAllByTestId: (id: RegExp) => unknown[] };
const expectThread = (view: View, ...lines: string[]) =>
  expect(renderedThread(view)).toEqual(
    lines.map(line => expect.stringMatching(new RegExp(`^${line}`))),
  );

describe('happy — chat history survives a relaunch', () => {
  it('a chat with two answer versions reopens at 2/2 and Previous still works; a plain chat reopens in order with no switcher', async () => {
    // --- Launch 1: one chat with a resent answer, one plain chat ---
    const h = await setupChatScreen({ engine: 'llama' });
    h.render();
    const v = () => h.view!;
    await h.send('tell me a fact', { text: 'Honey never spoils.' });
    await h.rtl.waitFor(() => expect(v().queryByText(/Honey never spoils\./)).not.toBeNull());
    h.boundary.llama!.scriptCompletion({ text: 'Octopuses have three hearts.' });
    h.rtl.fireEvent(v().getAllByTestId('user-message')[0]!, 'longPress');
    await h.rtl.waitFor(() => expect(v().getByTestId('action-menu')).toBeTruthy());
    h.rtl.fireEvent.press(v().getByTestId('action-retry'));
    await h.rtl.waitFor(() => expect(v().queryByText(/Octopuses have three hearts\./)).not.toBeNull());
    expect(v().getByText('2/2')).toBeTruthy();

    await h.newChatViaHome();
    await h.send('plain one', { text: 'First plain answer.' });
    await h.rtl.waitFor(() => expect(v().queryByText(/First plain answer\./)).not.toBeNull());
    await h.send('plain two', { text: 'Second plain answer.' });
    await h.rtl.waitFor(() => expect(v().queryByText(/Second plain answer\./)).not.toBeNull());

    // --- Relaunch onto the saved storage ---
    const app = await relaunchApp();
    let list = app.renderChatList();
    expect(list.getByText('tell me a fact')).toBeTruthy();
    expect(list.getByText('plain one')).toBeTruthy();

    // The versioned chat opens on the version shown last, and Previous steps back to the first answer.
    let chat = await app.openChatFromList(list, 'tell me a fact');
    await app.rtl.waitFor(() =>
      expectThread(chat, 'user: tell me a fact', 'assistant: Octopuses have three hearts\\.'),
    );
    expect(chat.getByText('2/2')).toBeTruthy();
    app.rtl.fireEvent.press(chat.getByLabelText('Previous response'));
    await app.rtl.waitFor(() => expect(chat.getByText('1/2')).toBeTruthy());
    expectThread(chat, 'user: tell me a fact', 'assistant: Honey never spoils\\.');
    chat.unmount();

    // The plain chat opens in order, with no version switcher.
    list = app.renderChatList();
    chat = await app.openChatFromList(list, 'plain one');
    await app.rtl.waitFor(() =>
      expectThread(
        chat,
        'user: plain one',
        'assistant: First plain answer\\.',
        'user: plain two',
        'assistant: Second plain answer\\.',
      ),
    );
    expect(chat.queryByText(/^\d+\/\d+$/)).toBeNull();
    chat.unmount();
  }, 60_000);
});
