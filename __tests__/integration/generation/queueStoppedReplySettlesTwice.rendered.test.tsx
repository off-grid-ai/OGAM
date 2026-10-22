/**
 * The queue sends one turn at a time, even when a stopped reply settles twice (1151a103d).
 *
 * Seen on an iPhone: two messages were queued behind a running reply and the user pressed "send now" on
 * one. The reply stopped, and the native stop landed late, so the stopped reply settled twice (the Stop,
 * then the native stop). The other queued message was then sent while the send-now turn was still
 * running; both ran on one model and the second came back empty ("No response").
 *
 * Product-correct outcome: the message sent now is answered on its own; the other queued message stays
 * in the queue until that reply ends, then gets its own reply. Exactly one reply runs at a time.
 *
 * Real ChatScreen, real composer gestures and queue rows, real generationService queue. Fakes only at the
 * device boundary: llama.rn. Its stop lands late, as on the device: stopCompletion returns at once, but
 * the stopped native completion resolves only after a delay.
 */
import { renderedThread, setupChatScreen } from '../../harness/chatHarness';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {},
  useIsFocused: () => true,
}));

/** How long the native stop takes to land on the device before the stopped completion settles. */
const NATIVE_STOP_LATENCY_MS = 250;

describe('queue: a stopped reply that settles twice still sends one turn at a time', () => {
  it('send now answers that message alone; the other queued message waits for it, then gets its own reply', async () => {
    const h = await setupChatScreen({ engine: 'llama', platform: 'ios' });
    h.render();
    const v = () => h.view!;
    const llama = h.boundary.llama!;

    // BOUNDARY: on the device a stopped completion unwinds late. stopCompletion returns at once, but the
    // native completion it stopped resolves only after this delay.
    const context = await llama.module.initLlama.mock.results.at(-1)!.value;
    const nativeCompletion = context.completion.getMockImplementation() as (...a: unknown[]) => Promise<{ interrupted?: boolean }>;
    context.completion.mockImplementation(async (...args: unknown[]) => {
      const result = await nativeCompletion(...args);
      if (result?.interrupted) await new Promise(resolve => setTimeout(resolve, NATIVE_STOP_LATENCY_MS));
      return result;
    });

    // A reply is running, held mid-stream.
    await h.send('write me a story', {
      text: 'Once upon a time there was a fox',
      pauseAfter: 'Once upon a time',
    } as never);
    await h.rtl.waitFor(() => expect(v().queryByText(/Once upon a time/)).not.toBeNull());

    // The user queues two messages behind it.
    await h.tapSend('give it a title');
    await h.tapSend('what is the moral');
    await h.rtl.waitFor(() => expect(v().getByText('2 queued')).toBeTruthy());
    expect(llama.calls.completion).toHaveLength(1);

    // Send now on the second one. Its reply is held mid-stream so the window stays open.
    llama.scriptCompletions([
      { text: 'The moral is patience. And more', pauseAfter: 'The moral is patience.' },
      { text: 'The Patient Fox.' },
    ] as never);
    h.rtl.fireEvent.press(v().getByTestId('queued-send-now-1'));

    await h.rtl.waitFor(() => expect(v().queryByText(/The moral is patience\./)).not.toBeNull());
    // Let the late native stop land and every drain it schedules run.
    await h.rtl.act(async () => { await h.settle(NATIVE_STOP_LATENCY_MS + 400); });

    // While the send-now reply runs: the other message is still queued, and no second turn started.
    expect(v().getByText('1 queued')).toBeTruthy();
    expect(v().getByTestId('queued-message-0')).toBeTruthy();
    expect(llama.calls.completion).toHaveLength(2);
    expect(v().queryByText(/The Patient Fox\./)).toBeNull();
    expect(v().getAllByTestId('user-message')).toHaveLength(2);

    // The send-now reply ends; then the queued message goes, and gets its own reply.
    llama.releaseStream();
    await h.rtl.waitFor(() => expect(v().queryByText(/The Patient Fox\./)).not.toBeNull());
    await h.rtl.waitFor(() => expect(v().queryByTestId('queue-indicator')).toBeNull());
    await h.rtl.act(async () => { await h.settle(300); });

    expect(llama.calls.completion).toHaveLength(3);
    expect(v().queryByText(/No response/)).toBeNull();
    expect(renderedThread(v())).toEqual([
      expect.stringMatching(/^user: write me a story/),
      expect.stringMatching(/^assistant: Once upon a time/),
      expect.stringMatching(/^user: what is the moral/),
      expect.stringMatching(/^assistant: The moral is patience\. And more/),
      expect.stringMatching(/^user: give it a title/),
      expect.stringMatching(/^assistant: The Patient Fox\./),
    ]);
  }, 30_000);
});
