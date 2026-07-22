/**
 * Unit tests for liteRTCompaction.ts
 * Covers summarizeSession and runCompaction branches.
 */

jest.mock('../../../src/utils/logger', () => ({
  __esModule: true,
  default: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock('../../../src/services/contextCompaction', () => ({
  contextCompactionService: {
    signalCompacting: jest.fn(),
    persistSummary: jest.fn(),
  },
}));

jest.mock('../../../src/stores/debugLogsStore', () => ({
  useDebugLogsStore: {
    getState: jest.fn(() => ({ addLog: jest.fn() })),
  },
}));

import {
  summarizeSession,
  runCompaction,
} from '../../../src/services/liteRTCompaction';
import { contextCompactionService } from '../../../src/services/contextCompaction';

const mockedSignal = contextCompactionService.signalCompacting as jest.Mock;
const mockedPersist = contextCompactionService.persistSummary as jest.Mock;

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
    const summary =
      'We discussed the project plan, milestones, and the next steps.';
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

  it('calls signalCompacting(true) then signalCompacting(false)', async () => {
    await runCompaction({ ...baseParams, history: [] });
    expect(mockedSignal).toHaveBeenNthCalledWith(1, true);
    expect(mockedSignal).toHaveBeenNthCalledWith(2, false);
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

  it('persists the summary with the last removed message as its cutoff', async () => {
    await runCompaction({
      ...baseParams,
      maxTokens: 100,
      history: [
        { id: 'old-user', role: 'user', content: 'x'.repeat(300) },
        { id: 'old-answer', role: 'assistant', content: 'y'.repeat(300) },
        { id: 'recent-user', role: 'user', content: 'recent' },
        { id: 'recent-answer', role: 'assistant', content: 'answer' },
      ],
    });

    expect(mockedPersist).toHaveBeenCalledWith(
      'conv-1',
      'A summary.',
      'old-answer',
    );
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

  it('calls signalCompacting(false) even when resetFn throws', async () => {
    const resetFn = jest.fn(() => Promise.reject(new Error('reset failed')));
    await expect(
      runCompaction({ ...baseParams, history: [], resetFn }),
    ).rejects.toThrow('reset failed');
    expect(mockedSignal).toHaveBeenLastCalledWith(false);
  });

  it('slices history to stay within recent budget', async () => {
    const resetFn = jest.fn(() => Promise.resolve());
    // 10 turns, each with long content that exceeds the budget
    const history: Array<{ role: 'user' | 'assistant'; content: string }> =
      Array.from({ length: 10 }, (_, i) => ({
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
