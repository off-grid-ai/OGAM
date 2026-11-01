/**
 * liteRTCompaction — summarizing a LiteRT session and rebuilding it smaller when it fills.
 *
 * summarizeSession and runCompaction take the engine's send / summarize / reset as arguments (the LiteRT
 * service passes its own); the tests pass plain functions that answer as the engine does. Everything else
 * is real: the compacting state the chat shows (contextCompactionService), the logger, the stores.
 */
import { summarizeSession, runCompaction } from '../../../src/services/liteRTCompaction';
import { contextCompactionService } from '../../../src/services/contextCompaction';

/** Record the compacting state the chat screen sees. */
function watchCompacting() {
  const states: boolean[] = [];
  const unsubscribe = contextCompactionService.subscribeCompacting((v: boolean) => states.push(v));
  return { states, unsubscribe };
}

// ---------------------------------------------------------------------------
// summarizeSession
// ---------------------------------------------------------------------------

describe('summarizeSession', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
  });
  afterEach(() => jest.useRealTimers());

  it('returns null immediately when isReady=false', async () => {
    const sendMessage = jest.fn();
    const result = await summarizeSession(sendMessage, false);
    expect(result).toBeNull();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('returns summary text from onComplete when at least 30 chars', async () => {
    // Real summaries from the model are typically 300-500 chars; the 30-char
    // floor only rejects degenerate single-token outputs (see "too short" test).
    const summary = 'We discussed the project plan, milestones, and the next steps.';
    const sendMessage = jest.fn((_text, callbacks) => {
      callbacks.onToken(summary);
      callbacks.onComplete('', '');
    });

    const result = await summarizeSession(sendMessage, true);
    expect(result).toBe(summary);
  });

  it('returns null when summary is empty string after trim', async () => {
    const sendMessage = jest.fn((_text, callbacks) => {
      callbacks.onToken('   ');
      callbacks.onComplete('', '');
    });

    const result = await summarizeSession(sendMessage, true);
    expect(result).toBeNull();
  });

  it('returns null when summary is under the 30-char minimum (degenerate output)', async () => {
    // Guards against the bug from log13 where the model emitted a 0/1-char
    // response after a tool exchange — too short to be a real summary.
    const sendMessage = jest.fn((_text, callbacks) => {
      callbacks.onToken('hello world');
      callbacks.onComplete('', '');
    });

    const result = await summarizeSession(sendMessage, true);
    expect(result).toBeNull();
  });

  it('returns null on onError', async () => {
    const sendMessage = jest.fn((_text, callbacks) => {
      callbacks.onError(new Error('generation failed'));
    });

    const result = await summarizeSession(sendMessage, true);
    expect(result).toBeNull();
  });

  it('returns null on timeout', async () => {
    const sendMessage = jest.fn(); // never calls callbacks
    const promise = summarizeSession(sendMessage, true);
    jest.advanceTimersByTime(20_001);
    const result = await promise;
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// runCompaction
// ---------------------------------------------------------------------------

describe('runCompaction', () => {
  beforeEach(() => jest.clearAllMocks());

  const baseParams = {
    systemPrompt: 'You are helpful.',
    maxTokens: 1000,
    cumulativeTokens: 900,
    conversationId: 'conv-1',
    activeConversationId: 'conv-1',
    opts: {},
    summarize: jest.fn(() => Promise.resolve('A summary.')),
    resetFn: jest.fn(() => Promise.resolve()),
  };

  it('shows the compacting state while it runs, then clears it', async () => {
    const watch = watchCompacting();
    await runCompaction({ ...baseParams, history: [] });
    watch.unsubscribe();
    expect(watch.states.slice(-2)).toEqual([true, false]);
  });

  it('uses summary in compacted history when activeConversationId matches', async () => {
    const resetFn = jest.fn(() => Promise.resolve());
    await runCompaction({
      ...baseParams,
      history: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello' },
      ],
      resetFn,
    });

    const callArgs = resetFn.mock.calls[0] as any[];
    const compactedHistory = callArgs[1].history;
    // First turn should be the summary context turn
    expect(compactedHistory[0].content).toContain('A summary.');
    expect(compactedHistory[1].content).toBe('Understood.');
  });

  it('slices only (no summary) when activeConversationId differs', async () => {
    const summarize = jest.fn(() => Promise.resolve('should not be called'));
    const resetFn = jest.fn(() => Promise.resolve());
    await runCompaction({
      ...baseParams,
      activeConversationId: 'different-conv',
      summarize,
      history: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello' },
      ],
      resetFn,
    });

    expect(summarize).not.toHaveBeenCalled();
    const compactedHistory = (resetFn.mock.calls[0] as any[])[1].history;
    // No summary prefix turn
    expect(compactedHistory[0].content).not.toContain('Context from earlier');
  });

  it('uses recent slice only when summarize returns null', async () => {
    const resetFn = jest.fn(() => Promise.resolve());
    await runCompaction({
      ...baseParams,
      summarize: jest.fn(() => Promise.resolve(null)),
      history: [
        { role: 'user', content: 'turn1' },
        { role: 'assistant', content: 'resp1' },
      ],
      resetFn,
    });

    const compactedHistory = (resetFn.mock.calls[0] as any[])[1].history;
    expect(compactedHistory[0].content).not.toContain('Context from earlier');
  });

  it('clears the compacting state even when the reset fails', async () => {
    const watch = watchCompacting();
    const resetFn = jest.fn(() => Promise.reject(new Error('reset failed')));
    await expect(runCompaction({ ...baseParams, history: [], resetFn })).rejects.toThrow('reset failed');
    watch.unsubscribe();
    expect(watch.states).toContain(true);
    expect(watch.states.at(-1)).toBe(false);
  });

  it('slices history to stay within recent budget', async () => {
    const resetFn = jest.fn(() => Promise.resolve());
    // 10 turns, each with long content that exceeds the budget
    const history: Array<{ role: 'user' | 'assistant'; content: string }> = Array.from({ length: 10 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: 'x'.repeat(500),
    }));

    await runCompaction({
      ...baseParams,
      maxTokens: 100, // small budget → forces slicing
      summarize: jest.fn(() => Promise.resolve(null)),
      activeConversationId: 'different', // no summarization
      history,
      resetFn,
    });

    const compactedHistory = (resetFn.mock.calls[0] as any[])[1].history;
    // Should be fewer than the original 10 turns
    expect(compactedHistory.length).toBeLessThan(10);
  });
});
