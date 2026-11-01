/**
 * BUG #29(b) regression — sending a second message while a turn is generating must
 * surface a visible "queued" indicator.
 *
 * The send handler enqueues the second message on generationService when a turn is already
 * generating; useChatScreen subscribes to generationService and projects the queue, which
 * ChatInput's QueueRow renders. This test mounts the REAL Chat screen on the app's real
 * navigation, starts a reply that stays in flight, sends a second message through the real
 * send button, and asserts the queue indicator renders with the count and the queued text.
 *
 * Only the phone is faked (chatHarness: llama.rn holding its stream open == a turn still
 * running, the disk, RAM); the screen, the send handler, the service, its queue and the
 * subscription run for real. Fails-before / passes-after.
 */
import { setupChatScreen } from '../../harness/chatHarness';

// Real navigation: the app's own NavigationContainer and routes (chatHarness navigation: 'real').
jest.unmock('@react-navigation/native');

describe('BUG #29(b) — second send while generating surfaces a queued indicator', () => {
  it('enqueues the second message and shows the queued count and text above the composer', async () => {
    const h = await setupChatScreen({ navigation: 'real', engine: 'llama' });
    h.render();

    // First send starts a reply whose native stream stays open: the turn is still running.
    await h.send('first message', { text: 'Still thinking about it', pauseAfter: 'Still' } as never);
    await h.rtl.waitFor(() => expect(h.view!.queryByText(/Still/)).not.toBeNull());
    expect(h.view!.queryByTestId('queue-indicator')).toBeNull(); // nothing queued yet

    // Second send WHILE generating → must enqueue with visible feedback, not silently drop.
    h.boundary.llama!.scriptCompletion({ text: 'Second reply.' });
    await h.tapSend('second message');

    await h.rtl.waitFor(() => expect(h.view!.getByTestId('queue-indicator')).toBeTruthy());
    expect(h.view!.getByText('1 queued')).toBeTruthy();
    expect(h.view!.getByTestId('queued-message-0')).toBeTruthy();
    expect(h.rtl.within(h.view!.getByTestId('queued-message-0')).getByText('second message')).toBeTruthy();
    // Still one native completion: the second message waits for the first reply.
    expect(h.boundary.llama!.calls.completion.length).toBe(1);

    // When the first reply ends, the queued message is sent and the indicator goes.
    h.boundary.llama!.releaseStream();
    await h.rtl.waitFor(() => expect(h.boundary.llama!.calls.completion.length).toBe(2));
    expect(h.view!.queryByTestId('queue-indicator')).toBeNull();
  });
});
