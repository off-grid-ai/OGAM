/**
 * MULTIMODAL TURN JOURNEY (cluster B): what the model streams → what the FINALIZED chat message
 * actually contains. Drives the REAL chat store finalizeStreamingMessage (which parses ONCE through
 * the shared parseModelOutput seam) and asserts the terminal stored artifact — the exact string the
 * renderer will later show — across thinking placements and both reasoning transports.
 *
 * Edges attacked:
 *   - unterminated <think> mid-stream (model hit EOS while reasoning): NO raw <think> leaks into the
 *     stored answer, reasoning is preserved.
 *   - separate reasoning channel: stored content = answer only, reasoning kept separately, and a
 *     stray inline <think> in the answer channel does NOT duplicate reasoning into the answer.
 *   - a stream that is ONLY tool-call markup with no answer + no reasoning: NO empty assistant
 *     message is stored (the store's add-guard), so the transcript has no blank bubble.
 *   - cross-engine parity: the SAME final answer text is stored whether it arrived inline (llama)
 *     or via the separate channel (litert/remote) — a user sees the same answer on every engine.
 */
import { useChatStore } from '../../../../src/stores/chatStore';
import { resetStores, setupWithConversation } from '../../../utils/testHelpers';

function finalizeWith(content: string, reasoning?: string): { content: string; reasoningContent?: string } | undefined {
  const conversationId = setupWithConversation({ messages: [] });
  const store = useChatStore.getState();
  store.startStreaming(conversationId);
  useChatStore.setState({ streamingMessage: content, streamingReasoningContent: reasoning ?? '' });
  store.finalizeStreamingMessage(conversationId);
  const conv = useChatStore.getState().conversations.find(c => c.id === conversationId);
  const assistant = conv?.messages.find(m => m.role === 'assistant');
  return assistant ? { content: assistant.content, reasoningContent: assistant.reasoningContent } : undefined;
}

describe('finalized-message terminal artifact (parse-once at the store boundary)', () => {
  beforeEach(() => resetStores());

  it('unterminated <think> mid-stream: answer has NO raw tag; reasoning is preserved', () => {
    const stored = finalizeWith('<think>still reasoning about the answer');
    // No answer yet — the whole content was reasoning. It must NOT store a blank/tag-laden answer.
    expect(stored?.content ?? '').not.toMatch(/<think>/);
    expect(stored?.reasoningContent).toContain('still reasoning about the answer');
  });

  it('inline <think> complete: stored answer is the clean text after </think>', () => {
    const stored = finalizeWith('<think>reason</think>The capital of France is Paris.');
    expect(stored?.content).toBe('The capital of France is Paris.');
    expect(stored?.content).not.toMatch(/<think>|reason/);
    expect(stored?.reasoningContent).toBe('reason');
  });

  it('separate reasoning channel: stored answer is content-only, reasoning kept apart', () => {
    const stored = finalizeWith('The capital of France is Paris.', 'my private chain of thought');
    expect(stored?.content).toBe('The capital of France is Paris.');
    expect(stored?.reasoningContent).toBe('my private chain of thought');
  });

  it('separate channel + a stray inline <think> in the answer: reasoning NOT duplicated into answer', () => {
    const stored = finalizeWith('<think>leaked</think>The capital of France is Paris.', 'channel reasoning');
    expect(stored?.content).toBe('The capital of France is Paris.');
    expect(stored?.content).not.toMatch(/leaked|<think>/);
    expect(stored?.reasoningContent).toBe('channel reasoning');
  });

  it('ONLY tool-call markup, no answer + no reasoning: NO blank assistant message is stored', () => {
    const stored = finalizeWith('<tool_call>{"name":"web_search","arguments":{}}</tool_call>');
    expect(stored).toBeUndefined();
  });

  it('cross-engine parity: inline (llama) and separate-channel (litert/remote) store the SAME answer', () => {
    const inline = finalizeWith('<think>work</think>The capital of France is Paris.');
    const channel = finalizeWith('The capital of France is Paris.', 'work');
    expect(inline?.content).toBe(channel?.content);
    expect(inline?.content).toBe('The capital of France is Paris.');
  });
});
