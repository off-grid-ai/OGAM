/**
 * HAPPY-PATH (UI integration) — a plain chat stays plain until it is retried, across relaunches.
 *
 * A plain chat stores no parent on its messages until it has versions (fc92a5785). From the user's view:
 * a chat with no retries shows its turns in order with no version switcher, before and after a relaunch;
 * regenerating its last answer after that relaunch adds a version (2/2), Previous brings back the first
 * answer (1/2), and both survive another relaunch.
 *
 * Real HomeScreen, ChatsListScreen and ChatScreen, real gestures (send, a tap on a chat row, long-press →
 * Regenerate, the ‹ arrow), the real chat store saving to AsyncStorage. A relaunch is a fresh module graph
 * over the saved storage. Only native leaves are faked (llama.rn, filesystem, RAM, AsyncStorage).
 */
import {
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
const VERSION_LABEL = /^\d+\/\d+$/;

describe('happy — a plain chat gets a version switcher only once it is retried', () => {
  it('llama.cpp: no switcher before or after a relaunch; Regenerate then shows 2/2, Previous 1/2, and both versions and the choice survive a relaunch', async () => {
    // --- Launch 1: a plain two-turn chat ---
    const h = await setupChatScreen({ engine: 'llama' });
    h.render();
    await h.send('plain one', { text: 'First plain answer.' });
    await h.rtl.waitFor(() => expect(h.view!.queryByText(/First plain answer\./)).not.toBeNull());
    await h.send('plain two', { text: 'Second plain answer.' });
    await h.rtl.waitFor(() => expect(h.view!.queryByText(/Second plain answer\./)).not.toBeNull());
    expectThread(
      h.view!,
      'user: plain one',
      'assistant: First plain answer\\.',
      'user: plain two',
      'assistant: Second plain answer\\.',
    );
    expect(h.view!.queryByText(VERSION_LABEL)).toBeNull();
    expect(h.view!.queryByLabelText('Previous response')).toBeNull();

    // --- Launch 2: relaunch with the model, open the chat from the list ---
    await closeApp();
    const r = await setupChatScreen({ engine: 'llama', relaunched: true });
    const { ChatsListScreen } = require('../../../src/screens/ChatsListScreen');
    const list = r.rtl.render(r.React.createElement(ChatsListScreen));
    const row = await r.rtl.waitFor(() => list.getByText('plain one'));
    const nav = require('../../harness/chatHarness');
    nav.navHolder.last = null;
    r.rtl.fireEvent.press(row);
    expect(nav.navHolder.last?.screen).toBe('Chat');
    list.unmount();
    nav.routeHolder.params = nav.navHolder.last!.params ?? {};
    r.render();
    const v = () => r.view!;
    await r.rtl.waitFor(() =>
      expectThread(
        v(),
        'user: plain one',
        'assistant: First plain answer\\.',
        'user: plain two',
        'assistant: Second plain answer\\.',
      ),
    );
    expect(v().queryByText(VERSION_LABEL)).toBeNull();

    // Regenerate the last answer: long-press it, then Regenerate.
    r.boundary.llama!.scriptCompletion({ text: 'Regenerated answer.' });
    const answers = v().getAllByTestId('assistant-message');
    r.rtl.fireEvent(answers[answers.length - 1]!, 'longPress');
    await r.rtl.waitFor(() => expect(v().getByTestId('action-menu')).toBeTruthy());
    r.rtl.fireEvent.press(v().getByTestId('action-retry'));
    await r.rtl.waitFor(() => expect(v().queryByText(/Regenerated answer\./)).not.toBeNull());
    await r.rtl.waitFor(() => expect(v().getByText('2/2')).toBeTruthy());
    expectThread(
      v(),
      'user: plain one',
      'assistant: First plain answer\\.',
      'user: plain two',
      'assistant: Regenerated answer\\.',
    );

    r.rtl.fireEvent.press(v().getByLabelText('Previous response'));
    await r.rtl.waitFor(() => expect(v().getByText('1/2')).toBeTruthy());
    expectThread(
      v(),
      'user: plain one',
      'assistant: First plain answer\\.',
      'user: plain two',
      'assistant: Second plain answer\\.',
    );
    // --- Launch 3: both versions survive, and the chat reopens on the one shown last (1/2) ---
    const app = await relaunchApp();
    const list3 = app.renderChatList();
    const chat = await app.openChatFromList(list3, 'plain one');
    await app.rtl.waitFor(() =>
      expectThread(
        chat,
        'user: plain one',
        'assistant: First plain answer\\.',
        'user: plain two',
        'assistant: Second plain answer\\.',
      ),
    );
    expect(chat.getByText('1/2')).toBeTruthy();
    app.rtl.fireEvent.press(chat.getByLabelText('Next response'));
    await app.rtl.waitFor(() => expect(chat.getByText('2/2')).toBeTruthy());
    expectThread(
      chat,
      'user: plain one',
      'assistant: First plain answer\\.',
      'user: plain two',
      'assistant: Regenerated answer\\.',
    );
    chat.unmount();
  }, 60_000);
});
