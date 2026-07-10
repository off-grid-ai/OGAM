/**
 * FAILURE JOURNEY — app relaunched (or killed) MID-TURN, while a streaming answer
 * was in flight.
 *
 * Cluster D. Drives the REAL chatStore. A turn is streaming (tokens accumulated in
 * streamingMessage, isStreaming true) but NOT yet finalized when the process dies.
 * On relaunch, zustand persist rehydrates ONLY the partialized slice
 * (conversations + activeConversationId).
 *
 * Terminal artifacts asserted:
 *   - the persisted snapshot carries NO streaming state (no half-written assistant
 *     bubble, no stuck isStreaming/isThinking) — so a fresh launch is never stuck
 *     showing a spinner for a turn that will never complete.
 *   - the in-flight streaming answer is NOT silently promoted to a stored message;
 *     the user's last message stands alone (the turn is dropped, not orphaned as a
 *     partial assistant bubble). This documents the current recovery contract: an
 *     interrupted turn is lost cleanly and the user can resend.
 *   - a subsequent finalize for a DEAD (rehydrated) streaming session is a no-op —
 *     it cannot resurrect a turn onto the wrong conversation.
 */
import { useChatStore } from '../../../../src/stores/chatStore';
import { resetStores } from '../../../utils/testHelpers';
import { createConversation, createMessage } from '../../../utils/factories';

// The persist partialize is a pure projection of state — reach it via the store's
// persist options so we assert the REAL persisted shape, not a re-implementation.
const persistOptions = (useChatStore as any).persist?.getOptions?.();

describe('failure journey — app relaunch mid-turn', () => {
  beforeEach(() => {
    resetStores();
  });

  it('the persisted snapshot excludes all streaming state (no stuck spinner on relaunch)', () => {
    const conv = createConversation({
      messages: [createMessage({ role: 'user', content: 'summarize this' })],
    });
    // Simulate a turn STREAMING when the app was killed.
    useChatStore.setState({
      conversations: [conv],
      activeConversationId: conv.id,
      streamingForConversationId: conv.id,
      streamingMessage: 'Here is a partial ans',
      streamingReasoningContent: 'thinking...',
      isStreaming: true,
      isThinking: true,
    } as any);

    expect(persistOptions).toBeTruthy();
    const persisted = persistOptions.partialize(useChatStore.getState());

    // Only conversations + activeConversationId survive; streaming is NOT persisted.
    expect(persisted).toHaveProperty('conversations');
    expect(persisted).toHaveProperty('activeConversationId');
    expect((persisted as any).streamingMessage).toBeUndefined();
    expect((persisted as any).isStreaming).toBeUndefined();
    expect((persisted as any).isThinking).toBeUndefined();
    expect((persisted as any).streamingForConversationId).toBeUndefined();

    // The partial answer was NOT baked into the stored conversation — the last
    // message is still the user's, so the rehydrated chat has no orphan bubble.
    const persistedConv = (persisted as any).conversations[0];
    expect(persistedConv.messages.at(-1).role).toBe('user');
    expect(persistedConv.messages.some((m: any) => m.content === 'Here is a partial ans')).toBe(false);
  });

  it('finalize for a DEAD streaming session (post-relaunch) cannot resurrect the turn', () => {
    // RELAUNCH: fresh store from the persisted slice — no streaming context.
    const conv = createConversation({
      messages: [createMessage({ role: 'user', content: 'summarize this' })],
    });
    useChatStore.setState({
      conversations: [conv],
      activeConversationId: conv.id,
      streamingForConversationId: null,
      streamingMessage: '',
      streamingReasoningContent: '',
      isStreaming: false,
      isThinking: false,
    } as any);

    // A late finalize (e.g. a stale callback) for the old turn must NOT append —
    // streamingForConversationId is null, so the guard drops it.
    useChatStore.getState().finalizeStreamingMessage(conv.id, 1000);

    const after = useChatStore.getState().conversations[0];
    // No assistant message resurrected; user's message still stands alone.
    expect(after.messages.filter(m => m.role === 'assistant')).toHaveLength(0);
    expect(after.messages.at(-1)!.role).toBe('user');
    expect(useChatStore.getState().isStreaming).toBe(false);
  });
});
