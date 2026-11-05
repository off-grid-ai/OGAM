/**
 * Batch 2 hardening — Core Chat / Text Generation (send path)
 *
 * Mounts the REAL Chat screen on the app's real navigation and sends through the real composer and
 * send button. The real handleSendFn, generationService and its queue, llmService and chatStore run;
 * only the phone is faked (chatHarness: llama.rn, the disk, RAM). Assertions read the chat store and
 * what the native model was asked to answer.
 *
 * Cases covered:
 *   5  — submitting with no active conversation creates a NEW chat + sets it active,
 *        and the user message lands in that new conversation.
 *   10 — a very long (600+ char) message is stored intact and generation begins.
 *   14 — sending a new message while a generation is in flight enqueues it (interrupt/
 *        serialize) instead of starting a second concurrent generation.
 *   35 — the "new chat" entry point (Home's New Chat opens Chat with no conversationId)
 *        ALWAYS produces a brand-new conversation, never reusing the most-recently-viewed one.
 *
 * Deleting the create-new-conversation branch, the enqueue branch, or the addMessage
 * call in handleSendFn would fail these tests.
 */
import { setupChatScreen } from '../harness/chatHarness';

// Real navigation: the app's own NavigationContainer and routes (chatHarness navigation: 'real').
jest.unmock('@react-navigation/native');

type Harness = Awaited<ReturnType<typeof setupChatScreen>>;

const chatState = () => require('../../src/stores').useChatStore.getState();
const completions = (h: Harness) => h.boundary.llama!.calls.completion.length;

async function openNewChat(): Promise<Harness> {
  const h = await setupChatScreen({ navigation: 'real', engine: 'llama' });
  h.render();
  return h;
}

/** Send through the composer and wait for the reply to finish. */
async function sendAndFinish(h: Harness, text: string, reply: string): Promise<void> {
  await h.send(text, { text: reply });
  await h.rtl.waitFor(() => expect(h.view!.queryByText(reply)).not.toBeNull());
  await h.rtl.waitFor(() => expect(h.view!.queryByTestId('stop-button')).toBeNull());
}

describe('batch2 send — new chat, long message, interrupt/queue', () => {
  // Case 5: no active conversation -> a NEW conversation is created + set active.
  it('case5: creates a new conversation and sets it active when none exists', async () => {
    const h = await openNewChat();
    const before = chatState().conversations.length;
    expect(chatState().activeConversationId).toBeNull();

    await sendAndFinish(h, 'What is the capital of France?', 'Paris.');

    const state = chatState();
    expect(state.conversations).toHaveLength(before + 1);
    const conv = state.conversations.find((c: { id: string }) => c.id === state.activeConversationId);
    // the new conversation is the active one, and the user message landed in it
    expect(conv).toBeDefined();
    expect(conv.messages[0]).toMatchObject({ role: 'user', content: 'What is the capital of France?' });
    // generation ran once, for that message
    expect(completions(h)).toBe(1);
  });

  // Case 35: the "new chat" entry produces a brand-new conversation rather than appending to the
  // most-recently-viewed one.
  it('case35: with active reset to null (new-chat entry), a brand-new conversation is created — not the recent one', async () => {
    const h = await openNewChat();
    await sendAndFinish(h, 'earlier chat', 'An earlier answer.');
    const oldId = chatState().activeConversationId;

    // New Chat from Home: Chat opens with no conversationId.
    await h.newChatViaHome();
    expect(chatState().activeConversationId).toBeNull();
    await sendAndFinish(h, 'Explain quantum entanglement', 'It is spooky.');

    const state = chatState();
    expect(state.activeConversationId).not.toBe(oldId);
    const newConv = state.conversations.find((c: { id: string }) => c.id === state.activeConversationId);
    // the new conversation starts with the new message — none of the old chat's
    expect(newConv.messages[0].content).toBe('Explain quantum entanglement');
    expect(newConv.messages.map((m: { content: string }) => m.content)).not.toContain('earlier chat');
    // the old conversation is untouched
    const oldConv = state.conversations.find((c: { id: string }) => c.id === oldId);
    expect(oldConv.messages.map((m: { content: string }) => m.content)).toEqual(['earlier chat', 'An earlier answer.']);
  });

  // Case 10: a 600+ character message is stored intact and generation starts.
  it('case10: a very long (600+ char) message is stored intact and generation begins', async () => {
    const longText = 'the quick brown fox jumps over the lazy dog. '.repeat(20).trim(); // ~900 chars
    expect(longText.length).toBeGreaterThan(600);
    const h = await openNewChat();

    await sendAndFinish(h, longText, 'Noted.');

    const state = chatState();
    const conv = state.conversations.find((c: { id: string }) => c.id === state.activeConversationId);
    expect(conv.messages[0].content).toBe(longText); // stored verbatim, not truncated
    expect(completions(h)).toBe(1);
  });

  // Case 14: sending mid-generation enqueues the new message instead of launching a second
  // concurrent generation.
  it('case14: enqueues the new message (does not start a 2nd generation) while one is in flight', async () => {
    const h = await openNewChat();
    await h.send('tell me a long story', { text: 'A long story about a pirate', pauseAfter: 'A long story' } as never);
    await h.rtl.waitFor(() => expect(h.view!.queryByText(/A long story/)).not.toBeNull());

    h.boundary.llama!.scriptCompletion({ text: 'Hi.' });
    await h.tapSend('Actually, just say hi.');

    // The new message was queued for serialized handling...
    await h.rtl.waitFor(() => expect(h.view!.getByTestId('queue-indicator')).toBeTruthy());
    const { generationService } = require('../../src/services/generationService');
    expect(generationService.getState().queuedMessages).toEqual([
      expect.objectContaining({ conversationId: chatState().activeConversationId, text: 'Actually, just say hi.' }),
    ]);
    // ...and NO second generation was dispatched.
    expect(completions(h)).toBe(1);

    h.boundary.llama!.releaseStream();
    await h.rtl.waitFor(() => expect(completions(h)).toBe(2));
  });

  // Case 9-adjacent guard: with no model selected nothing can be sent and nothing generates.
  it('does not generate when no model is selected: the chat says so and offers no composer', async () => {
    const h = await openNewChat();
    const before = chatState().conversations.length;
    // The person unloads the model and clears the selection.
    const { activeModelService } = require('../../src/services/activeModelService');
    await h.rtl.act(() => activeModelService.unloadTextModel(false));

    await h.rtl.waitFor(() => expect(h.view!.getByText('No Model Selected')).toBeTruthy());
    expect(h.view!.queryByTestId('chat-input')).toBeNull();
    // No starter prompts either: with no model they would only lead to the same dead end.
    expect(h.view!.queryByTestId('chat-starters')).toBeNull();
    expect(chatState().conversations).toHaveLength(before);
    expect(completions(h)).toBe(0);
  });
});
