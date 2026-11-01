/**
 * Batch 2 hardening — Core Chat / Text Generation (retry path)
 *
 * Mounts the REAL Chat screen on the app's real navigation and drives retry the way a person does:
 * open a message's action menu and tap Regenerate (on a reply) or Resend (on their own message).
 * The real handleRetryMessageFn, regenerateResponseFn, generationService, llmService and chatStore
 * run; only the phone is faked (chatHarness: llama.rn, the disk, RAM). What the native model was
 * asked and what the chat holds afterwards are the assertions.
 *
 *   16/17 — retry on a completed ASSISTANT message finds the preceding USER message, keeps the
 *           earlier reply as a version, and regenerates for that user prompt.
 *   17    — retry on a USER message keeps its reply as a version and regenerates for it.
 *   19    — retry is NOT locked out after a previous retry: a second retry regenerates again.
 *   20    — retry with no model selected alerts and does not regenerate (guard).
 */
import { setupChatScreen, renderedThread } from '../harness/chatHarness';

// Real navigation: the app's own NavigationContainer and routes (chatHarness navigation: 'real').
jest.unmock('@react-navigation/native');

type Harness = Awaited<ReturnType<typeof setupChatScreen>>;

/** The text of the last user turn the native model was asked to answer. */
function lastPromptAsked(h: Harness): string {
  const calls = h.boundary.llama!.calls.completion;
  const params = calls[calls.length - 1][0] as { messages?: Array<{ role: string; content: unknown }> };
  const users = (params.messages ?? []).filter(m => m.role === 'user');
  const content = users[users.length - 1]?.content;
  return typeof content === 'string' ? content : JSON.stringify(content);
}

/** The chat's messages as stored. */
function storedThread(h: Harness): Array<{ id: string; role: string; content: string }> {
  const { useChatStore } = require('../../src/stores');
  return useChatStore.getState().getConversationMessages(h.conversationId!);
}

/**
 * Nothing was deleted: the user message and the earlier reply are still stored, and the new reply is
 * stored beside it as another version answering the same user message. The chat shows one user
 * message and one reply: the new version.
 */
function expectReplyKeptAsVersion(h: Harness, before: Array<{ id: string; role: string }>, newReply: string) {
  const [user, earlier] = before;
  const after = storedThread(h) as Array<{ id: string; role: string; content: string; parent?: string }>;
  expect(after.slice(0, 2).map(m => m.id)).toEqual([user.id, earlier.id]);
  expect(after).toHaveLength(3);
  expect(after[2]).toMatchObject({ role: 'assistant', content: newReply, parent: user.id });
  expect(renderedThread(h.view!).map(line => line.split(':')[0])).toEqual(['user', 'assistant']);
}

/** Open the action menu on the last message of `role` and tap its retry action. */
async function tapRetry(h: Harness, role: 'user' | 'assistant', reply: string): Promise<void> {
  h.boundary.llama!.scriptCompletion({ text: reply });
  await h.openActionMenu(role, 'dots');
  h.rtl.fireEvent.press(h.view!.getByTestId('action-retry'));
  await h.rtl.waitFor(() => expect(h.view!.queryByText(reply)).not.toBeNull());
  await h.rtl.waitFor(() => expect(h.view!.queryByTestId('stop-button')).toBeNull());
}

async function chatWithOneReply(prompt: string, reply: string): Promise<Harness> {
  const h = await setupChatScreen({ navigation: 'real', engine: 'llama' });
  h.render();
  await h.send(prompt, { text: reply });
  await h.rtl.waitFor(() => expect(h.view!.queryByText(reply)).not.toBeNull());
  await h.rtl.waitFor(() => expect(h.view!.queryByTestId('stop-button')).toBeNull());
  return h;
}

describe('batch2 retry — retry orchestration on the Chat screen', () => {
  // Cases 16/17: retry a COMPLETED assistant message -> regenerate for the prior user.
  it('case16/17: retrying a completed assistant message keeps it as a version and regenerates for the prior user msg', async () => {
    const h = await chatWithOneReply('say hi', 'Hi there!');
    const before = storedThread(h);
    const turnsBefore = h.boundary.llama!.calls.completion.length;

    await tapRetry(h, 'assistant', 'Hello again!');

    // Regenerated once, for the prior user prompt.
    expect(h.boundary.llama!.calls.completion.length).toBe(turnsBefore + 1);
    expect(lastPromptAsked(h)).toContain('say hi');
    expectReplyKeptAsVersion(h, before, 'Hello again!');
  });

  // Case 17: retry a USER message directly -> keeps its reply as a version, regenerates for it.
  it('case17: retrying a user message keeps its reply as a version and regenerates for it', async () => {
    const h = await chatWithOneReply('first', 'reply');
    const before = storedThread(h);
    const turnsBefore = h.boundary.llama!.calls.completion.length;

    await tapRetry(h, 'user', 'another reply');

    expectReplyKeptAsVersion(h, before, 'another reply');
    expect(h.boundary.llama!.calls.completion.length).toBe(turnsBefore + 1);
    expect(lastPromptAsked(h)).toContain('first');
  });

  // Case 19: after a first retry, a SECOND retry is not locked out — it regenerates again.
  it('case19: a second retry after a previous one is not locked out — regenerates again', async () => {
    const h = await chatWithOneReply('go', 'partial answer');
    const turnsBefore = h.boundary.llama!.calls.completion.length;

    await tapRetry(h, 'assistant', 'second answer');
    // second retry on the user message
    await tapRetry(h, 'user', 'third answer');

    expect(h.boundary.llama!.calls.completion.length).toBe(turnsBefore + 2);
  });

  // Case 20 guard: no model selected -> alert, no regeneration.
  it('case20: retry with no active model alerts and does not regenerate', async () => {
    const h = await chatWithOneReply('x', 'an answer');
    // The person unloads the model and clears the selection.
    const { activeModelService } = require('../../src/services/activeModelService');
    await h.rtl.act(() => activeModelService.unloadTextModel(false));
    const turnsBefore = h.boundary.llama!.calls.completion.length;

    await h.openActionMenu('user', 'dots');
    h.rtl.fireEvent.press(h.view!.getByTestId('action-retry'));

    await h.rtl.waitFor(() => expect(h.view!.getByText('No Model Selected')).toBeTruthy());
    expect(h.view!.getByText('Please select a model first.')).toBeTruthy();
    expect(h.boundary.llama!.calls.completion.length).toBe(turnsBefore);
  });
});
