/**
 * HAPPY-PATH (UI integration) — chat history is kept when a launch cannot read it.
 *
 * Real ChatScreen, HomeScreen and ChatsListScreen, real gestures (send, New Chat, a tap on a chat row),
 * the real chat store saving to AsyncStorage through its hydration gate.
 * A relaunch is a fresh module graph over the saved storage (chatHarness.relaunchApp): the stores read
 * their saved state as they are created, exactly as at launch. Only native leaves are faked; the one
 * storage failure is at the AsyncStorage boundary: the chat store's first read at launch 2 fails once.
 */
import {
  CHAT_STORE_KEY,
  closeApp,
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

describe('happy — chat history is kept when a load fails', () => {
  it('a launch whose chat-store read fails keeps the saved chats: a chat made then is added, and a healthy relaunch lists all three', async () => {
    // --- Launch 1: two chats ---
    const h = await setupChatScreen({ engine: 'llama' });
    h.render();
    await h.send('first chat', { text: 'Answer one.' });
    await h.rtl.waitFor(() => expect(h.view!.queryByText(/Answer one\./)).not.toBeNull());
    await h.newChatViaHome();
    await h.send('second chat', { text: 'Answer two.' });
    await h.rtl.waitFor(() => expect(h.view!.queryByText(/Answer two\./)).not.toBeNull());

    // --- Launch 2: the first read of the chat store fails; the user starts a new chat and sends ---
    await closeApp();
    const failed = await setupChatScreen({ engine: 'llama', relaunched: true, failFirstReadOf: CHAT_STORE_KEY });
    failed.render();
    await failed.send('third chat', { text: 'Answer three.' });
    await failed.rtl.waitFor(() => expect(failed.view!.queryByText(/Answer three\./)).not.toBeNull());

    // --- Launch 3: storage healthy again ---
    const app = await relaunchApp();
    let list = app.renderChatList();
    expect(list.getByText('first chat')).toBeTruthy();
    expect(list.getByText('second chat')).toBeTruthy();
    expect(list.getByText('third chat')).toBeTruthy();

    // Nothing was overwritten: each saved chat still opens with its own turn.
    let chat = await app.openChatFromList(list, 'first chat');
    await app.rtl.waitFor(() => expectThread(chat, 'user: first chat', 'assistant: Answer one\\.'));
    chat.unmount();
    list = app.renderChatList();
    chat = await app.openChatFromList(list, 'second chat');
    await app.rtl.waitFor(() => expectThread(chat, 'user: second chat', 'assistant: Answer two\\.'));
    chat.unmount();
    list = app.renderChatList();
    chat = await app.openChatFromList(list, 'third chat');
    await app.rtl.waitFor(() => expectThread(chat, 'user: third chat', 'assistant: Answer three\\.'));
    chat.unmount();
  }, 60_000);
});
