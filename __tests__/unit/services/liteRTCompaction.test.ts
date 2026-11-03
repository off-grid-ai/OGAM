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

  it('sends the transcript after the instruction when the session does not hold the conversation', async () => {
    const summary = 'The user asked for stories about Paris and Lyon.';
    const sendMessage = jest.fn((_text, callbacks) => {
      callbacks.onToken(summary);
      callbacks.onComplete('', '');
    });

    const result = await summarizeSession(sendMessage, true, undefined, undefined, 'user: Write a story about Paris');

    expect(result).toBe(summary);
    expect(sendMessage.mock.calls[0][0]).toMatch(
      /^Briefly summarize[\s\S]*<conversation>\nuser: Write a story about Paris\n<\/conversation>\n\nSummarize the conversation between the markers above\. Do not answer any question in it\.$/,
    );
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
    conversationId: 'conv-1',
    opts: {},
    summarize: jest.fn(() => Promise.resolve('A summary.')),
    resetFn: jest.fn(() => Promise.resolve()),
  };
  type Turn = { role: 'user' | 'assistant'; content: string };
  /** Six turns too long to keep together: compaction drops the older ones. */
  const longHistory: Turn[] = Array.from({ length: 6 }, (_, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: `turn ${i} ${'x'.repeat(600)}`,
  }));

  it('shows the compacting state while it runs, then clears it', async () => {
    const watch = watchCompacting();
    await runCompaction({ ...baseParams, history: [] });
    watch.unsubscribe();
    expect(watch.states.slice(-2)).toEqual([true, false]);
  });

  it('summarizes only the turns it drops, and opens the rebuilt session with that summary', async () => {
    const summarize = jest.fn((_dropped: Turn[]) => Promise.resolve('A summary.'));
    const resetFn = jest.fn(() => Promise.resolve());
    await runCompaction({ ...baseParams, history: longHistory, summarize, resetFn });

    const compactedHistory: Turn[] = (resetFn.mock.calls[0] as any[])[1].history;
    const kept = compactedHistory.slice(2);
    expect(compactedHistory[0].content).toContain('A summary.');
    expect(compactedHistory[1].content).toBe('Understood.');
    expect(summarize.mock.calls[0][0]).toEqual(longHistory.slice(0, longHistory.length - kept.length));
    expect(kept).toEqual(longHistory.slice(-kept.length));
  });

  it('writes no summary when every turn still fits', async () => {
    const summarize = jest.fn(() => Promise.resolve('should not be called'));
    const resetFn = jest.fn(() => Promise.resolve());
    const history: Turn[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ];
    await runCompaction({ ...baseParams, summarize, history, resetFn });

    expect(summarize).not.toHaveBeenCalled();
    expect((resetFn.mock.calls[0] as any[])[1].history).toEqual(history);
  });

  it('keeps the recent turns without a summary when summarizing fails', async () => {
    const resetFn = jest.fn(() => Promise.resolve());
    await runCompaction({ ...baseParams, summarize: jest.fn(() => Promise.resolve(null)), history: longHistory, resetFn });

    const compactedHistory: Turn[] = (resetFn.mock.calls[0] as any[])[1].history;
    expect(compactedHistory[0].content).not.toContain('Context from earlier');
    expect(compactedHistory.length).toBeLessThan(longHistory.length);
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
      history,
      resetFn,
    });

    const compactedHistory = (resetFn.mock.calls[0] as any[])[1].history;
    // Should be fewer than the original 10 turns
    expect(compactedHistory.length).toBeLessThan(10);
  });
});
