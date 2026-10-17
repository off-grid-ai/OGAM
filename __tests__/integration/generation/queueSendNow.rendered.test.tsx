/**
 * Messages written while a reply runs wait in a queue above the composer, as on Desktop and in the browser
 * extension. Each queued message can go now (the reply stops and it is sent on its own) or be removed; a
 * long-press on send does the same for the message being typed. A Stop holds what is left until the user
 * sends it. What is left after a finished reply goes together.
 *
 * Real ChatScreen, real composer gestures, real generationService queue over the shared @offgrid/sync rules;
 * only llama.rn is faked. The reply is held mid-stream (pauseAfter) so the queue is on screen while it runs.
 */
import { setupChatScreen } from '../../harness/chatHarness';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {},
  useIsFocused: () => true,
}));

type Harness = Awaited<ReturnType<typeof setupChatScreen>>;

/** The user bubbles, top to bottom, as the person reads them. */
const userTurns = (h: Harness): string[] =>
  h.view!.queryAllByTestId('user-message').map(bubble =>
    h.rtl
      .within(bubble)
      .queryAllByText(/.+/)
      .map(n => String(n.props.children))
      .join(' '),
  );

/** Start a reply and hold it mid-stream: the window in which the user writes more. */
async function startHeldReply(h: Harness) {
  await h.send('first question', { text: 'Half a thought and then more', pauseAfter: 'Half a thought' } as never);
  await h.rtl.waitFor(() => expect(h.view!.queryByText(/Half a thought/)).not.toBeNull());
  expect(h.view!.queryByTestId('queue-indicator')).toBeNull();
}

/** Type into the real composer, the way a keypress does. */
async function type(h: Harness, text: string) {
  const input = await h.rtl.waitFor(() => h.view!.getByTestId('chat-input'));
  await h.rtl.act(async () => {
    (input as unknown as { props: { onChangeText: (t: string) => void } }).props.onChangeText(text);
  });
}

describe('queue and send now while a reply runs', () => {
  it('long-press on send stops the reply and sends the message at once; the queued one goes after it', async () => {
    const h = await setupChatScreen({ engine: 'llama' });
    h.render();
    await startHeldReply(h);

    await h.tapSend('second thought');
    await h.rtl.waitFor(() => expect(h.view!.getByText('1 queued')).toBeTruthy());
    expect(h.view!.getByTestId('queued-message-0')).toBeTruthy();
    expect(h.boundary.llama!.calls.completion.length).toBe(1);

    h.boundary.llama!.scriptCompletions([{ text: 'Urgent reply.' }, { text: 'Second reply.' }]);
    await type(h, 'urgent question');
    h.rtl.fireEvent(h.view!.getByTestId('send-button'), 'longPress');

    // The interrupted reply keeps what was shown and never finishes.
    await h.rtl.waitFor(() => expect(h.view!.queryByText(/Urgent reply\./)).not.toBeNull());
    expect(h.view!.queryByText(/Half a thought/)).not.toBeNull();
    expect(h.view!.queryByText(/and then more/)).toBeNull();

    // Then what was queued goes, after the message sent now.
    await h.rtl.waitFor(() => expect(h.view!.queryByText(/Second reply\./)).not.toBeNull());
    expect(h.view!.queryByTestId('queue-indicator')).toBeNull();
    const turns = userTurns(h);
    expect(turns).toHaveLength(3);
    expect(turns[0]).toMatch(/first question/);
    expect(turns[1]).toMatch(/urgent question/);
    expect(turns[2]).toMatch(/second thought/);
  });

  it('send now on a queued row sends that message on its own, then the rest', async () => {
    const h = await setupChatScreen({ engine: 'llama' });
    h.render();
    await startHeldReply(h);

    await h.tapSend('queued one');
    await h.tapSend('queued two');
    await h.rtl.waitFor(() => expect(h.view!.getByText('2 queued')).toBeTruthy());

    h.boundary.llama!.scriptCompletions([
      { text: 'Reply to two. Done', pauseAfter: 'Reply to two.' },
      { text: 'Reply to one.' },
    ] as never);
    h.rtl.fireEvent.press(h.view!.getByTestId('queued-send-now-1'));

    // While the message sent now is answered, the other one waits behind it; it is not paused.
    await h.rtl.waitFor(() => expect(h.view!.queryByText(/Reply to two\./)).not.toBeNull());
    expect(h.view!.getByText('1 queued')).toBeTruthy();
    expect(h.view!.queryByText('Paused after Stop')).toBeNull();
    expect(h.view!.queryByTestId('queue-resume-button')).toBeNull();
    h.boundary.llama!.releaseStream();
    await h.rtl.waitFor(() => expect(h.view!.queryByText(/Reply to one\./)).not.toBeNull());
    expect(h.view!.queryByTestId('queue-indicator')).toBeNull();
    const turns = userTurns(h);
    expect(turns).toHaveLength(3);
    expect(turns[1]).toMatch(/queued two/);
    expect(turns[2]).toMatch(/queued one/);
    expect(h.boundary.llama!.calls.completion.length).toBe(3);
  });

  it('Stop holds the queue until the user sends it', async () => {
    const h = await setupChatScreen({ engine: 'llama' });
    h.render();
    await startHeldReply(h);

    await h.tapSend('wait for me');
    await h.rtl.waitFor(() => expect(h.view!.getByText('1 queued')).toBeTruthy());
    expect(h.view!.queryByText('Paused after Stop')).toBeNull();

    h.boundary.llama!.scriptCompletion({ text: 'Sent when asked.' });
    // The composer is empty again, so its action button is Stop.
    h.rtl.fireEvent.press(await h.rtl.waitFor(() => h.view!.getByTestId('stop-button')));

    await h.rtl.waitFor(() => expect(h.view!.getByText('Paused after Stop')).toBeTruthy());
    await h.settle(400);
    expect(h.view!.getByTestId('queued-message-0')).toBeTruthy();
    expect(h.view!.queryByText(/Sent when asked\./)).toBeNull();
    expect(h.boundary.llama!.calls.completion.length).toBe(1);

    h.rtl.fireEvent.press(h.view!.getByTestId('queue-resume-button'));
    await h.rtl.waitFor(() => expect(h.view!.queryByText(/Sent when asked\./)).not.toBeNull());
    expect(h.view!.queryByTestId('queue-indicator')).toBeNull();
  });

  it('a removed message is never sent; the rest still go when the reply ends', async () => {
    const h = await setupChatScreen({ engine: 'llama' });
    h.render();
    await startHeldReply(h);

    await h.tapSend('drop this');
    await h.tapSend('keep this');
    await h.rtl.waitFor(() => expect(h.view!.getByText('2 queued')).toBeTruthy());

    h.rtl.fireEvent.press(h.view!.getByTestId('queued-remove-0'));
    await h.rtl.waitFor(() => expect(h.view!.getByText('1 queued')).toBeTruthy());

    h.boundary.llama!.scriptCompletion({ text: 'Kept reply.' });
    h.boundary.llama!.releaseStream();
    await h.rtl.waitFor(() => expect(h.view!.queryByText(/Half a thought and then more/)).not.toBeNull());
    await h.rtl.waitFor(() => expect(h.view!.queryByText(/Kept reply\./)).not.toBeNull());
    expect(h.view!.queryByTestId('queue-indicator')).toBeNull();
    const turns = userTurns(h);
    expect(turns.some(turn => /drop this/.test(turn))).toBe(false);
    expect(turns[turns.length - 1]).toMatch(/keep this/);
  });
});
