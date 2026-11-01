/**
 * A second send while a reply is still streaming must not start a second generation.
 *
 * The send button is on screen the whole time a reply streams in, so this is a tap a user really makes - out of
 * impatience, or because they thought of something to add. Two completions running against one llama context is not
 * a slow app, it is two token streams writing into the same message: the reply the user reads becomes interleaved
 * nonsense, and on a device the second context init is what pushes a phone into an OOM kill.
 *
 * The guard is asserted at the NATIVE boundary - how many completions llama.rn was actually asked for - because
 * that is the only place the answer is unambiguous. Our own service refusing to start is what we hope happens;
 * native having been asked once is what proves it.
 *
 * REPLACES a mocked version in generationFlow.test.ts which stood in for llmService and asserted
 * `mockLlmService.generateResponse` was called once. With the service mocked, "already generating" was a flag the
 * mock never set and the real re-entrancy guard - the one thing under test - never ran at all.
 */
import { setupChatScreen } from '../../harness/chatHarness';

// Real navigation: the app's own NavigationContainer and routes (chatHarness navigation: 'real').
jest.unmock('@react-navigation/native');

describe('tapping send again mid-stream', () => {
  it('does not start a second generation, and the first reply still finishes intact', async () => {
    const h = await setupChatScreen({ navigation: 'real', engine: 'llama' });
    h.render();

    // Hold the engine mid-stream: tokens have started arriving and the completion is still in flight, which is
    // exactly the window in which the user gets impatient.
    await h.send('first question', { text: 'Half a thought and then more', pauseAfter: 'Half a thought' } as never);
    await h.rtl.waitFor(() => {
      expect(h.view!.queryByText(/Half a thought/)).not.toBeNull();
    });
    expect(h.boundary.llama!.calls.completion.length).toBe(1);

    // The first completion has already consumed its script. Give the queued turn its own native
    // answer; a real model does not replay the previous completion for the next user message.
    h.boundary.llama!.scriptCompletion({ text: 'The queued reply.' });

    // The impatient second tap, through the real send button.
    await h.tapSend('and another thing');
    await h.settle(300);

    // The tap REGISTERED - it is queued and the user is told so. Asserting this first is what stops the next
    // assertion being vacuous: without it, "no second completion" would also pass if the button were simply dead,
    // and a send silently swallowed is its own bug (the user retypes, or assumes the app is broken).
    const queued = await h.rtl.waitFor(() => h.view!.getByTestId('queue-indicator'));
    expect(queued).toBeTruthy();
    expect(h.view!.queryByText(/1 queued/)).not.toBeNull();
    expect(h.view!.queryByText(/and another thing/)).not.toBeNull();

    // Still one completion. A second one here is two token streams writing into one message.
    expect(h.boundary.llama!.calls.completion.length).toBe(1);

    // The held reply completes intact - the refusal must not have poisoned the turn in flight, which would trade
    // interleaved output for a reply that never finishes.
    h.boundary.llama!.releaseStream();
    await h.rtl.waitFor(() => {
      expect(h.view!.queryByText(/Half a thought and then more/)).not.toBeNull();
    });

    // And the queued message is then actually sent, rather than held forever. Deferred is the promise the queue
    // indicator makes to the user; dropped would make it a lie.
    await h.rtl.waitFor(() => {
      expect(h.boundary.llama!.calls.completion.length).toBe(2);
    });
    expect(h.view!.queryByTestId('queue-indicator')).toBeNull();
  });
});
