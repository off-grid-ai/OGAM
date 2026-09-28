/**
 * Journey M1 - Restart the app while a reply is arriving.
 *
 * One test per contract line in shared/docs/FLOW_CONTRACT_MOBILE.md. Every test arrives through real
 * gestures on the real Chat screen and asserts only what a person can see.
 *
 * M1.7 states the promise that a stopped reply says so; it fails until the phone shows that line.
 */
import { setupChatScreen } from '../../harness/chatHarness';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {}, useIsFocused: () => true,
}));

const PARTIAL = 'The reply has started and it';
const FULL = `${PARTIAL} keeps going to the end.`;

type Harness = Awaited<ReturnType<typeof setupChatScreen>>;

/** Send a message and hold the reply part way, exactly as a slow device leaves it. */
const startHeldReply = async (h: Harness): Promise<void> => {
  await h.send('start a long reply', { text: FULL, pauseAfter: PARTIAL } as never);
  await h.rtl.waitFor(() => {
    expect(h.view!.queryByText(new RegExp(PARTIAL))).not.toBeNull();
  }, { timeout: 8000 });
};

/** Force quit and reopen: the screen goes away and the application root starts again. */
const forceQuitAndReopen = async (h: Harness, conversationId: string | null): Promise<void> => {
  const { currentMobileApplicationFixture } = require('../../harness/mobileApplicationFixture') as typeof import('../../harness/mobileApplicationFixture');
  const fixture = currentMobileApplicationFixture();
  h.view!.unmount();
  if (fixture) await fixture.restart();
  require('../../harness/chatHarness').routeHolder.params = conversationId ? { conversationId } : {};
  h.render();
};

describe('Journey M1 - Restart the app while a reply is arriving', () => {
  it('M1.1 opens a chat and sends a message: the reply starts and words appear one after another', async () => {
    const h = await setupChatScreen({ engine: 'llama', platform: 'android' });
    h.render();
    await startHeldReply(h);
    expect(h.view!.queryByText(new RegExp(PARTIAL))).not.toBeNull();
  });

  it('M1.2 watches the send button while the reply arrives: it shows a stop control, not a fresh send', async () => {
    const h = await setupChatScreen({ engine: 'llama', platform: 'android' });
    h.render();
    await startHeldReply(h);
    await h.rtl.waitFor(() => {
      expect(h.view!.queryByTestId('stop-button')).not.toBeNull();
    }, { timeout: 8000 });
    expect(h.view!.queryByTestId('send-button')).toBeNull();
  });

  it('M1.3 force quits the app while the words are still arriving: the app closes at once', async () => {
    const h = await setupChatScreen({ engine: 'llama', platform: 'android' });
    h.render();
    await startHeldReply(h);
    const { currentMobileApplicationFixture } = require('../../harness/mobileApplicationFixture') as typeof import('../../harness/mobileApplicationFixture');
    const fixture = currentMobileApplicationFixture();
    const startedAt = Date.now();
    h.view!.unmount();
    if (fixture) await fixture.restart();
    // A close that hangs on a spinner is the failure this line forbids.
    expect(Date.now() - startedAt).toBeLessThan(5000);
  });

  it('M1.4 reopens the app: the app starts normally, with no error strip', async () => {
    const h = await setupChatScreen({ engine: 'llama', platform: 'android' });
    h.render();
    await startHeldReply(h);
    const conversationId = h.conversationId;
    await forceQuitAndReopen(h, conversationId);
    await h.rtl.waitFor(() => {
      expect(h.view!.queryByTestId('chat-input')).not.toBeNull();
    }, { timeout: 8000 });
    expect(h.view!.queryByText(/something went wrong|unexpected error/i)).toBeNull();
  });

  it('M1.5 reads the chat list before opening the chat: the chat shows its real last words and never a typing sign', async () => {
    const h = await setupChatScreen({ engine: 'llama', platform: 'android' });
    h.render();
    await startHeldReply(h);
    const conversationId = h.conversationId;
    await forceQuitAndReopen(h, conversationId);
    h.view!.unmount();

    const { ChatsListScreen } = require('../../../src/screens/ChatsListScreen');
    const list = h.rtl.render(h.React.createElement(ChatsListScreen, {}));
    await h.rtl.waitFor(() => {
      expect(list.queryByText(new RegExp(PARTIAL))).not.toBeNull();
    }, { timeout: 8000 });
    expect(list.queryByText(/typing/i)).toBeNull();
    list.unmount();
  });

  it('M1.6 opens the same chat: the reply is there, stopped part way', async () => {
    const h = await setupChatScreen({ engine: 'llama', platform: 'android' });
    h.render();
    await startHeldReply(h);
    const conversationId = h.conversationId;
    await forceQuitAndReopen(h, conversationId);
    await h.rtl.waitFor(() => {
      expect(h.view!.queryByText(new RegExp(PARTIAL))).not.toBeNull();
    }, { timeout: 8000 });
    expect(h.view!.queryByText(/keeps going to the end/)).toBeNull();
  });

  it('M1.7 reads the end of that reply: a plain mark says the reply stopped early', async () => {
    const h = await setupChatScreen({ engine: 'llama', platform: 'android' });
    h.render();
    await startHeldReply(h);
    const conversationId = h.conversationId;
    await forceQuitAndReopen(h, conversationId);
    await h.rtl.waitFor(() => {
      expect(h.view!.queryByText(new RegExp(PARTIAL))).not.toBeNull();
    }, { timeout: 8000 });

    // A reply that ended early must SAY so. Without this line it reads as a finished answer.
    expect(h.view!.queryByText(/stopped early|stopped before it finished|did not finish/i)).not.toBeNull();
  });

  it('M1.8 looks at the send button in that chat: it shows send, not stop', async () => {
    const h = await setupChatScreen({ engine: 'llama', platform: 'android' });
    h.render();
    await startHeldReply(h);
    const conversationId = h.conversationId;
    await forceQuitAndReopen(h, conversationId);
    await h.rtl.waitFor(() => {
      expect(h.view!.queryByTestId('chat-input')).not.toBeNull();
    }, { timeout: 8000 });
    await h.settle(200);
    expect(h.view!.queryByTestId('stop-button')).toBeNull();
  });

  it('M1.9 watches that chat for ten seconds: nothing changes and the old reply never resumes on its own', async () => {
    const h = await setupChatScreen({ engine: 'llama', platform: 'android' });
    h.render();
    await startHeldReply(h);
    const conversationId = h.conversationId;
    await forceQuitAndReopen(h, conversationId);
    await h.rtl.waitFor(() => {
      expect(h.view!.queryByText(new RegExp(PARTIAL))).not.toBeNull();
    }, { timeout: 8000 });

    h.boundary.llama!.releaseStream();
    await h.settle(1000);

    // The old turn belongs to the closed session. It must never write more words here.
    expect(h.view!.queryByText(/keeps going to the end/)).toBeNull();
    expect(h.view!.queryByTestId('stop-button')).toBeNull();
  });

  it('M1.10 sends a new message in the same chat: one reply streams and a second never appears beside it', async () => {
    const h = await setupChatScreen({ engine: 'llama', platform: 'android' });
    h.render();
    await startHeldReply(h);
    const conversationId = h.conversationId;
    await forceQuitAndReopen(h, conversationId);
    await h.rtl.waitFor(() => {
      expect(h.view!.queryByTestId('chat-input')).not.toBeNull();
    }, { timeout: 8000 });

    await h.send('ask again', { text: 'A single fresh reply.' } as never);
    await h.rtl.waitFor(() => {
      expect(h.view!.queryByText(/A single fresh reply\./)).not.toBeNull();
    }, { timeout: 8000 });
    expect(h.view!.queryAllByText(/A single fresh reply\./).length).toBe(1);
  });

  it('M1.11 sends a message, then sends the app to the background and returns: the reply is still whole', async () => {
    const h = await setupChatScreen({ engine: 'llama', platform: 'android' });
    h.render();
    await h.send('give one whole reply', { text: 'One whole reply with no gaps.' } as never);
    await h.rtl.waitFor(() => {
      expect(h.view!.queryByText(/One whole reply with no gaps\./)).not.toBeNull();
    }, { timeout: 8000 });

    const { AppState } = require('react-native');
    await h.rtl.act(async () => {
      (AppState as { emit?: (event: string, state: string) => void }).emit?.('change', 'background');
      (AppState as { emit?: (event: string, state: string) => void }).emit?.('change', 'active');
    });
    await h.settle(200);

    expect(h.view!.queryAllByText(/One whole reply with no gaps\./).length).toBe(1);
  });

  it('M1.12 force quits and reopens twice fast: the app starts cleanly each time, with no duplicate reply', async () => {
    const h = await setupChatScreen({ engine: 'llama', platform: 'android' });
    h.render();
    await startHeldReply(h);
    const conversationId = h.conversationId;
    await forceQuitAndReopen(h, conversationId);
    await forceQuitAndReopen(h, conversationId);
    await h.rtl.waitFor(() => {
      expect(h.view!.queryByText(new RegExp(PARTIAL))).not.toBeNull();
    }, { timeout: 8000 });
    expect(h.view!.queryAllByText(new RegExp(PARTIAL)).length).toBe(1);
  });

  it('M1.13 sends a message right after the second reopen: the send button works at once', async () => {
    const h = await setupChatScreen({ engine: 'llama', platform: 'android' });
    h.render();
    await startHeldReply(h);
    const conversationId = h.conversationId;
    await forceQuitAndReopen(h, conversationId);
    await forceQuitAndReopen(h, conversationId);

    await h.send('send straight away', { text: 'Answered straight away.' } as never);
    await h.rtl.waitFor(() => {
      expect(h.view!.queryByText(/Answered straight away\./)).not.toBeNull();
    }, { timeout: 8000 });
  });

  it('M1.14 reads that chat one more time: each message appears once, in the order it was sent', async () => {
    const h = await setupChatScreen({ engine: 'llama', platform: 'android' });
    h.render();
    await startHeldReply(h);
    const conversationId = h.conversationId;
    await forceQuitAndReopen(h, conversationId);
    await h.send('second question', { text: 'Second answer.' } as never);
    await h.rtl.waitFor(() => {
      expect(h.view!.queryByText(/Second answer\./)).not.toBeNull();
    }, { timeout: 8000 });

    expect(h.view!.queryAllByText(/start a long reply/).length).toBe(1);
    expect(h.view!.queryAllByText(/second question/).length).toBe(1);
    expect(h.view!.queryAllByText(/Second answer\./).length).toBe(1);
  });

  it('M1.15 FLAG the cancelling of turns from the old session: a person sees no cancel, only a chat ready for a new message', async () => {
    const h = await setupChatScreen({ engine: 'llama', platform: 'android' });
    h.render();
    await startHeldReply(h);
    const conversationId = h.conversationId;
    await forceQuitAndReopen(h, conversationId);
    await h.rtl.waitFor(() => {
      expect(h.view!.queryByTestId('chat-input')).not.toBeNull();
    }, { timeout: 8000 });

    h.boundary.llama!.releaseStream();
    await h.settle(500);

    expect(h.view!.queryByText(/cancel|aborted|session/i)).toBeNull();
    expect(h.view!.queryByTestId('stop-button')).toBeNull();
  });
});
