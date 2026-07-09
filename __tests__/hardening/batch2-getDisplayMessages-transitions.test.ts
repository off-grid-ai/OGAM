/**
 * Batch 2 hardening — Core Chat / Text Generation
 *
 * Cases 6, 7, 8: the thinking -> streaming -> done display transitions.
 *
 * Drives the REAL getDisplayMessages projection (src/screens/ChatScreen/types.ts) —
 * the single source of truth the chat screen renders from. No mocks: this is a pure
 * function over (messages, streamingState). Deleting the branch logic in the impl
 * would fail these assertions.
 *
 * Already covered elsewhere (NOT duplicated here): the model-loading bubble isolation
 * (`Loading <model>...`) lives in __tests__/unit/screens/getDisplayMessages.test.ts.
 */

import {
  getDisplayMessages,
  StreamingState,
} from '../../src/screens/ChatScreen/types';
import { createMessage } from '../utils/factories';

const baseStreaming: StreamingState = {
  isThinking: false,
  streamingMessage: '',
  streamingReasoningContent: '',
  isStreamingForThisConversation: false,
  isModelLoading: false,
  loadingModelName: undefined,
  isGeneratingForThisConversation: false,
};

describe('batch2 getDisplayMessages — thinking -> streaming -> done transitions', () => {
  const userMsg = createMessage({ role: 'user', content: 'What is the capital of France?' });

  // Case 6: a "Thinking" bubble is shown before any token arrives.
  it('case6: appends a thinking bubble (empty content, isThinking) before the first token', () => {
    const out = getDisplayMessages([userMsg], {
      ...baseStreaming,
      isThinking: true,
      isStreamingForThisConversation: true,
    });

    expect(out).toHaveLength(2);
    const bubble = out[1] as any;
    expect(bubble.id).toBe('thinking');
    expect(bubble.isThinking).toBe(true);
    expect(bubble.content).toBe(''); // no generated text yet
    expect(bubble.isStreaming).toBeUndefined();
    // the real user message is preserved and ordered first
    expect((out[0] as any).id).toBe(userMsg.id);
  });

  // Case 7: the moment the first token arrives, the thinking bubble is replaced by a
  // streaming bubble carrying the partial content.
  it('case7: replaces thinking with a streaming bubble the moment content exists', () => {
    const out = getDisplayMessages([userMsg], {
      ...baseStreaming,
      isThinking: false,
      streamingMessage: 'Paris',
      isStreamingForThisConversation: true,
    });

    expect(out).toHaveLength(2);
    const bubble = out[1] as any;
    expect(bubble.id).toBe('streaming');
    expect(bubble.isStreaming).toBe(true);
    expect(bubble.content).toBe('Paris');
    // the "thinking" bubble is gone — no thinking id present
    expect(out.some(m => (m as any).id === 'thinking')).toBe(false);
  });

  it('case7: streaming bubble grows as more tokens accumulate', () => {
    const first = getDisplayMessages([userMsg], {
      ...baseStreaming,
      streamingMessage: 'Paris',
      isStreamingForThisConversation: true,
    });
    const later = getDisplayMessages([userMsg], {
      ...baseStreaming,
      streamingMessage: 'Paris is the capital',
      isStreamingForThisConversation: true,
    });

    expect((first[1] as any).content).toBe('Paris');
    expect((later[1] as any).content).toBe('Paris is the capital');
  });

  it('case7: reasoning-only content also produces a streaming bubble', () => {
    const out = getDisplayMessages([userMsg], {
      ...baseStreaming,
      streamingReasoningContent: 'Let me think...',
      isStreamingForThisConversation: true,
    });
    const bubble = out[1] as any;
    expect(bubble.id).toBe('streaming');
    expect(bubble.reasoningContent).toBe('Let me think...');
  });

  // Case 8: when generation finishes, the finalized assistant message is a REAL stored
  // message and there is no synthetic thinking/streaming bubble left over.
  it('case8: done state shows only the real messages, no synthetic bubble', () => {
    const assistantMsg = createMessage({ role: 'assistant', content: 'Paris is the capital of France.' });
    const out = getDisplayMessages([userMsg, assistantMsg], {
      ...baseStreaming,
      // generation over: not thinking, no live streaming content
      isThinking: false,
      streamingMessage: '',
      isStreamingForThisConversation: false,
    });

    expect(out).toHaveLength(2);
    expect(out.some(m => (m as any).id === 'thinking')).toBe(false);
    expect(out.some(m => (m as any).id === 'streaming')).toBe(false);
    expect((out[1] as any).id).toBe(assistantMsg.id);
    expect((out[1] as any).content).toBe('Paris is the capital of France.');
  });

  // Isolation: a generation happening in ANOTHER conversation must not leak a bubble
  // into this one (isStreamingForThisConversation === false).
  it('does not append any bubble when the stream is for a different conversation', () => {
    const thinkingElsewhere = getDisplayMessages([userMsg], {
      ...baseStreaming,
      isThinking: true,
      isStreamingForThisConversation: false,
    });
    expect(thinkingElsewhere).toHaveLength(1);

    const streamingElsewhere = getDisplayMessages([userMsg], {
      ...baseStreaming,
      streamingMessage: 'hello from another chat',
      isStreamingForThisConversation: false,
    });
    expect(streamingElsewhere).toHaveLength(1);
  });

  // The full lifecycle in one sequence — the exact user-visible arc of a single turn.
  it('cases 6->7->8: full thinking -> streaming -> done sequence for one turn', () => {
    // 6. thinking
    const thinking = getDisplayMessages([userMsg], {
      ...baseStreaming, isThinking: true, isStreamingForThisConversation: true,
    });
    expect((thinking[1] as any).id).toBe('thinking');

    // 7. first token -> streaming
    const streaming = getDisplayMessages([userMsg], {
      ...baseStreaming, streamingMessage: 'Par', isStreamingForThisConversation: true,
    });
    expect((streaming[1] as any).id).toBe('streaming');
    expect((streaming[1] as any).content).toBe('Par');

    // 8. finalized -> only real messages
    const done = getDisplayMessages(
      [userMsg, createMessage({ role: 'assistant', content: 'Paris.' })],
      { ...baseStreaming },
    );
    expect(done).toHaveLength(2);
    expect(done.some(m => (m as any).id === 'streaming' || (m as any).id === 'thinking')).toBe(false);
  });
});
