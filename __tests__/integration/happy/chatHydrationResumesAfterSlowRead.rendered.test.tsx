/**
 * Chat history survives a launch whose chat-store read is still pending while the app boots (84bdbe012).
 *
 * The hydration gate holds writes until Zustand's read of the saved chats lands, so the launch-time
 * defaults (an empty chat list) can never replace them. When that read is pending, then lands, the
 * saved chats appear, open with their own turns, and a later relaunch still lists them: nothing was
 * overwritten. The new chat the user opened meanwhile stays the open chat, and what they send there is
 * a chat of its own.
 *
 * Real HomeScreen, ChatsListScreen and ChatScreen, real gestures (send, New Chat, a tap on a chat row),
 * the real chat store saving through its hydration gate. Fakes only at the device boundary: llama.rn,
 * the file system, and AsyncStorage as a device store whose read of the chat store is slow
 * (harness/heldStorageRead).
 */
import {
  CHAT_STORE_KEY,
  closeApp,
  relaunchApp,
  renderedThread,
  setupChatScreen,
} from '../../harness/chatHarness';
import {
  heldReadCount,
  holdNextReadOf,
  releaseHeldRead,
  wipeHeldStorage,
} from '../../harness/heldStorageRead';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('../../harness/heldStorageRead').heldAsyncStorageModule(),
);

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

describe('happy — chat history survives a slow read at launch', () => {
  beforeEach(() => wipeHeldStorage());

  it('saved chats appear once the pending read lands, open with their turns, and are still listed after the next relaunch', async () => {
    // --- Launch 1: two chats ---
    const h = await setupChatScreen({ engine: 'llama' });
    h.render();
    await h.send('first chat', { text: 'Answer one.' });
    await h.rtl.waitFor(() => expect(h.view!.queryByText(/Answer one\./)).not.toBeNull());
    await h.newChatViaHome();
    await h.send('second chat', { text: 'Answer two.' });
    await h.rtl.waitFor(() => expect(h.view!.queryByText(/Answer two\./)).not.toBeNull());

    // --- Launch 2: the chat store's read is slow; the app boots and the user opens a new chat meanwhile ---
    await closeApp();
    holdNextReadOf(CHAT_STORE_KEY);
    const slow = await setupChatScreen({ engine: 'llama', relaunched: true });
    slow.render();
    expect(heldReadCount()).toBe(1);
    // Before: the user is on the new chat they opened from Home.
    expect(renderedThread(slow.view!)).toEqual([]);

    const React = require('react');
    const { ChatsListScreen } = require('../../../src/screens/ChatsListScreen');
    // Before: the read has not landed, so the saved chats are not listed yet.
    let list = slow.rtl.render(React.createElement(ChatsListScreen));
    expect(list.queryByText('first chat')).toBeNull();
    expect(list.queryByText('second chat')).toBeNull();
    list.unmount();

    // The read lands.
    await slow.rtl.act(async () => {
      releaseHeldRead();
      await slow.settle(50);
    });
    list = slow.rtl.render(React.createElement(ChatsListScreen));
    await slow.rtl.waitFor(() => expect(list.getByText('first chat')).toBeTruthy());
    expect(list.getByText('second chat')).toBeTruthy();
    list.unmount();
    // The chat the user opened stays the new, empty chat: the read landing does not switch it to a saved one.
    expect(renderedThread(slow.view!)).toEqual([]);

    // The user chats on this launch: the save after the read keeps the earlier chats.
    await slow.send('third chat', { text: 'Answer three.' });
    await slow.rtl.waitFor(() => expect(slow.view!.queryByText(/Answer three\./)).not.toBeNull());

    // --- Launch 3: a normal relaunch lists all three; nothing was overwritten ---
    const app = await relaunchApp();
    list = app.renderChatList();
    expect(list.getByText('first chat')).toBeTruthy();
    expect(list.getByText('second chat')).toBeTruthy();
    expect(list.getByText('third chat')).toBeTruthy();

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
