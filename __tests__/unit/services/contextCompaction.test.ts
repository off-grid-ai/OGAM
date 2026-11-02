/**
 * Context Compaction Service Unit Tests
 *
 * Tests for LLM-based summarization and token-aware message trimming
 * when context is full.
 * Priority: P1 — Prevents generation failures on long conversations.
 */

import { contextCompactionService } from '../../../src/services/contextCompaction';
import { llmService } from '../../../src/services/llm';
import { useChatStore } from '../../../src/stores/chatStore';
import { createMessage } from '../../utils/factories';
import type { Message } from '../../../src/types';

jest.mock('../../../src/services/llm', () => ({
  llmService: {
    clearKVCache: jest.fn().mockResolvedValue(undefined),
    getTokenCount: jest.fn().mockImplementation((text: string) =>
      Promise.resolve(Math.ceil(text.length / 4)),
    ),
    getPerformanceSettings: jest.fn().mockReturnValue({ contextLength: 2048 }),
    generateWithMaxTokens: jest.fn().mockResolvedValue('Summary of conversation'),
  },
}));

jest.mock('../../../src/stores/chatStore', () => ({
  useChatStore: {
    getState: jest.fn().mockReturnValue({
      updateCompactionState: jest.fn(),
    }),
  },
}));

const mockedLlmService = llmService as jest.Mocked<typeof llmService>;
const mockedUpdateCompactionState = jest.fn();

/** Mock tokenizer: 10 tokens for 'System', customizable for other text */
function mockTokenCounts(nonSystemTokens = 500) {
  mockedLlmService.getTokenCount.mockImplementation((text: string) =>
    text === 'System' ? Promise.resolve(10) : Promise.resolve(nonSystemTokens),
  );
}

/** Shorthand for compact() with default conversationId and systemPrompt */
function compactWith(messages: Message[], extra?: { previousSummary?: string }) {
  return contextCompactionService.compact({
    conversationId: 'conv-1',
    systemPrompt: 'System',
    allMessages: messages,
    ...extra,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedLlmService.getTokenCount.mockImplementation((text: string) =>
    Promise.resolve(Math.ceil(text.length / 4)),
  );
  mockedLlmService.getPerformanceSettings.mockReturnValue({ contextLength: 2048 } as any);
  mockedLlmService.generateWithMaxTokens.mockResolvedValue('Summary of conversation');
  mockedUpdateCompactionState.mockClear();
  (useChatStore.getState as jest.Mock).mockReturnValue({
    updateCompactionState: mockedUpdateCompactionState,
  });
});

describe('isContextFullError', () => {
  it.each([
    ['Context is full', true],
    ['Not enough context space', true],
    ['CONTEXT IS FULL', true],
    ['Failed: context is full, cannot continue', true],
    ['context window exceeded', true],
    ['context length exceeded', true],
    ['context is full', true],
    // LiteRT-LM's own limit errors, as the native module forwards them
    ['Max number of tokens reached, context window out of bounds', true],
    ['Input token ids are too long. Exceeding the maximum number of tokens allowed: 4100 >= 4096', true],
    ['Reached maximum number of tokens.', true],
    ['Generation failed: Prefill length (128) plus current step (3990) exceeds max sequence length (4096).', true],
  ])('"%s" → %s', (msg, expected) => {
    const input = typeof msg === 'string' ? new Error(msg) : msg;
    expect(contextCompactionService.isContextFullError(input)).toBe(expected);
  });

  it('returns false for unrelated errors', () => {
    expect(contextCompactionService.isContextFullError(new Error('No model loaded'))).toBe(false);
  });

  it('handles string errors', () => {
    expect(contextCompactionService.isContextFullError('context is full')).toBe(true);
  });
});

describe('compact', () => {
  it('budgets for the context the engine holds, not the setting, when one is given', async () => {
    mockTokenCounts(200);
    (useChatStore.getState as jest.Mock).mockReturnValue({
      updateCompactionState: mockedUpdateCompactionState,
      addMessage: jest.fn(),
    });
    const messages = [
      createMessage({ role: 'system', content: 'System' }),
      createMessage({ role: 'user', content: 'Write a story about Paris' }),
      createMessage({ role: 'assistant', content: 'A long story' }),
      createMessage({ role: 'user', content: 'Now one about Lyon' }),
    ];

    // The 2048 setting holds all three turns, so nothing would be compacted.
    const fromSetting = await compactWith(messages);
    expect(fromSetting.filter(m => m.role !== 'system')).toHaveLength(3);
    expect(mockedLlmService.generateWithMaxTokens).not.toHaveBeenCalled();

    // A LiteRT engine clamped to 1024 cannot, so the oldest turn is summarized within its budget.
    const fromEngine = await contextCompactionService.compact({
      conversationId: 'conv-1',
      systemPrompt: 'System',
      allMessages: messages,
      contextLength: 1024,
    });
    expect(fromEngine[fromEngine.length - 1].content).toBe('Now one about Lyon');
    expect(fromEngine.some(m => m.content === 'Write a story about Paris')).toBe(false);
    expect(mockedLlmService.generateWithMaxTokens).toHaveBeenCalledWith(expect.any(Array), Math.floor(1024 * 0.12));
  });

  it('clears KV cache before compacting', async () => {
    const messages = [
      createMessage({ role: 'system', content: 'System' }),
      createMessage({ role: 'user', content: 'Hello' }),
    ];

    await compactWith(messages);
    expect(mockedLlmService.clearKVCache).toHaveBeenCalledWith(true);
  });

  it('keeps recent messages that fit within recent token budget', async () => {
    const messages = [
      createMessage({ role: 'system', content: 'System' }),
      createMessage({ role: 'user', content: 'msg 1' }),
      createMessage({ role: 'assistant', content: 'reply 1' }),
      createMessage({ role: 'user', content: 'msg 2' }),
      createMessage({ role: 'assistant', content: 'reply 2' }),
      createMessage({ role: 'user', content: 'latest question' }),
    ];

    const result = await compactWith(messages);

    expect(result[0].role).toBe('system');
    expect(result[0].content).toBe('System');
    expect(result[result.length - 1].content).toBe('latest question');
  });

  it('falls back to trim-only on summarization failure', async () => {
    mockTokenCounts(500);
    mockedLlmService.generateWithMaxTokens.mockRejectedValue(new Error('generation failed'));

    const messages = [
      createMessage({ role: 'system', content: 'System' }),
      createMessage({ role: 'user', content: 'old msg' }),
      createMessage({ role: 'assistant', content: 'old reply' }),
      createMessage({ role: 'user', content: 'latest' }),
    ];

    const result = await compactWith(messages);

    expect(result[0].role).toBe('system');
    expect(result[0].content).toBe('System');
    expect(result.find(m => m.id === 'compaction-summary')).toBeUndefined();
    expect(mockedUpdateCompactionState).not.toHaveBeenCalled();
  });

  it('falls back to char estimate when tokenizer fails', async () => {
    mockedLlmService.getTokenCount.mockRejectedValue(new Error('tokenizer unavailable'));
    mockedLlmService.generateWithMaxTokens.mockRejectedValue(new Error('no tokenizer'));

    const messages = [
      createMessage({ role: 'system', content: 'System' }),
      createMessage({ role: 'user', content: 'Hello' }),
    ];

    const result = await compactWith(messages);
    expect(result.length).toBeGreaterThanOrEqual(2);
  });
});

describe('clearSummary', () => {
  it('clears persisted compaction state from store', () => {
    contextCompactionService.clearSummary('conv-1');

    expect(mockedUpdateCompactionState).toHaveBeenCalledWith('conv-1', undefined, undefined);
  });
});

describe('compacting state', () => {
  it('sets isCompacting during compact flow', async () => {
    const states: boolean[] = [];
    const unsub = contextCompactionService.subscribeCompacting(v => states.push(v));

    await compactWith([createMessage({ role: 'user', content: 'Hello' })]);
    unsub();

    expect(states[0]).toBe(false);
    expect(states).toContain(true);
    expect(states[states.length - 1]).toBe(false);
  });

  it('resets isCompacting even on error', async () => {
    mockedLlmService.clearKVCache.mockRejectedValueOnce(new Error('cache error'));

    const states: boolean[] = [];
    const unsub = contextCompactionService.subscribeCompacting(v => states.push(v));

    try {
      await compactWith([]);
    } catch {
      // expected
    }
    unsub();

    expect(states[states.length - 1]).toBe(false);
  });
});
