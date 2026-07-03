/**
 * Generation Tool Loop — branch-coverage tests.
 *
 * Targets branches not exercised by generationToolLoop.test.ts:
 *  - parseToolCallsFromText: <invoke> blocks + namespaced wrapper blocks
 *  - Gemma text parsing: colon-style fall-through, no-name body, web_search queries→query
 *  - buildLiteRTHistory content mapping/filter
 *  - LiteRT loop: tool-result send text, empty-turn guard, onToken/onReasoning, parse-fail retry
 *  - buildDateTimeContext precise branch (time-sensitive tool enabled)
 *  - selectEffectiveSchemas: native routing path (LiteRT) keeping/dropping ext tools
 */

import {
  runToolLoop,
  ToolLoopContext,
  parseToolCallsFromText,
  buildLiteRTHistory,
} from '../../../src/services/generationToolLoop';
import { llmService } from '../../../src/services/llm';
import { liteRTService } from '../../../src/services/litert';
import { Message } from '../../../src/types';
import { createMessage } from '../../utils/factories';

// ---------------------------------------------------------------------------
// Mocks (mirror generationToolLoop.test.ts conventions)
// ---------------------------------------------------------------------------

const mockAddMessage = jest.fn();
const mockSetStreamingMessage = jest.fn();
const mockSetIsThinking = jest.fn();
let mockAppState: any = {
  downloadedModels: [],
  activeModelId: null,
  settings: { temperature: 0.7, maxTokens: 1024, topP: 0.9, liteRTTemperature: 0.7, liteRTTopP: 0.9 },
};

jest.mock('../../../src/stores', () => ({
  useChatStore: {
    getState: () => ({
      addMessage: mockAddMessage,
      setStreamingMessage: mockSetStreamingMessage,
      setIsThinking: mockSetIsThinking,
    }),
  },
  useRemoteServerStore: { getState: () => ({ activeServerId: null }) },
  useAppStore: { getState: () => mockAppState },
}));

jest.mock('../../../src/services/llm', () => ({
  llmService: {
    generateResponseWithTools: jest.fn(),
    supportsToolCalling: jest.fn(() => false),
    stopGeneration: jest.fn().mockResolvedValue(undefined),
    isModelLoaded: jest.fn(() => true),
    generateToolSelection: jest.fn(),
  },
}));

jest.mock('../../../src/services/litert', () => ({
  liteRTService: {
    isModelLoaded: jest.fn(() => false),
    prepareConversation: jest.fn(),
    generateRaw: jest.fn(),
    getLastBenchmarkStats: jest.fn(() => undefined),
  },
}));

jest.mock('../../../src/services/providers', () => ({
  providerRegistry: {
    hasProvider: jest.fn(() => false),
    getProvider: jest.fn(() => null),
  },
}));

const mockGetToolsAsOpenAISchema = jest.fn((_ids?: string[]) => [
  { type: 'function', function: { name: 'web_search' } },
]);
const mockExecuteToolCall = jest.fn();
jest.mock('../../../src/services/tools', () => ({
  getToolsAsOpenAISchema: (ids: string[]) => mockGetToolsAsOpenAISchema(ids),
  executeToolCall: (call: Record<string, unknown>) => mockExecuteToolCall(call),
}));

// tool extensions: default to none; individual tests can override.
const mockGetToolExtensions = jest.fn(() => [] as any[]);
jest.mock('../../../src/services/tools/extensions', () => ({
  getToolExtensions: () => mockGetToolExtensions(),
}));

// selectRelevantTools: drives the native-routing branch in selectEffectiveSchemas.
const mockSelectRelevantTools = jest.fn();
jest.mock('../../../src/services/litertToolSelector', () => ({
  selectRelevantTools: (...args: any[]) => mockSelectRelevantTools(...args),
}));

const mockedGenerateResponseWithTools = llmService.generateResponseWithTools as jest.Mock;
const mockedLiteRT = liteRTService as jest.Mocked<typeof liteRTService>;

function makeMessage(overrides: Partial<Message> = {}): Message {
  return createMessage({ content: 'Hello', ...overrides } as any);
}

function createContext(overrides: Partial<ToolLoopContext> = {}): ToolLoopContext {
  return {
    conversationId: 'conv-1',
    messages: [makeMessage()],
    enabledToolIds: ['web_search'],
    isAborted: () => false,
    onThinkingDone: jest.fn(),
    onFinalResponse: jest.fn(),
    callbacks: undefined,
    ...overrides,
  };
}

function resetMocks() {
  jest.clearAllMocks();
  mockExecuteToolCall.mockReset();
  mockExecuteToolCall.mockResolvedValue({ toolCallId: 'tc-1', name: 'web_search', content: 'result', durationMs: 10 });
  mockedGenerateResponseWithTools.mockReset();
  mockGetToolsAsOpenAISchema.mockReturnValue([{ type: 'function', function: { name: 'web_search' } }]);
  mockGetToolExtensions.mockReturnValue([]);
  mockedLiteRT.isModelLoaded.mockReturnValue(false);
  mockedLiteRT.prepareConversation.mockResolvedValue(undefined);
  mockedLiteRT.generateRaw.mockResolvedValue('LiteRT response');
  mockAppState = {
    downloadedModels: [],
    activeModelId: null,
    settings: { temperature: 0.7, maxTokens: 1024, topP: 0.9, liteRTTemperature: 0.7, liteRTTopP: 0.9 },
  };
}

// ===========================================================================
// parseToolCallsFromText — <invoke> blocks + namespaced wrapper
// ===========================================================================
describe('parseToolCallsFromText — invoke & namespaced blocks', () => {
  it('parses <invoke name="..."><parameter ...> blocks (lines 146-152)', () => {
    const text = 'Pre <invoke name="read_url"><parameter name="url">https://x.com</parameter></invoke> Post';
    const result = parseToolCallsFromText(text);

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe('read_url');
    expect(result.toolCalls[0].arguments).toEqual({ url: 'https://x.com' });
    expect(result.cleanText).toBe('Pre  Post');
  });

  it('parses multiple parameters inside one invoke block', () => {
    const text = '<invoke name="calc"><parameter name="a">1</parameter><parameter name="b">2</parameter></invoke>';
    const result = parseToolCallsFromText(text);
    expect(result.toolCalls[0].arguments).toEqual({ a: '1', b: '2' });
  });

  it('parses the invoke inside a namespaced wrapper block: ns:tool_call ... </ns:tool_call> (lines 187-191)', () => {
    // The top-level parseInvokeBlocks pass (line 182) sees the invoke, then the
    // namespace pass (lines 186-191) re-parses the wrapper body — both add the call.
    // Asserting both confirms the namespace branch (187-191) executed.
    const text = 'mcp:tool_call <invoke name="search"><parameter name="q">hi</parameter></invoke></mcp:tool_call>';
    const result = parseToolCallsFromText(text);

    expect(result.toolCalls).toHaveLength(2);
    expect(result.toolCalls.every(c => c.name === 'search')).toBe(true);
    expect(result.toolCalls[0].arguments).toEqual({ q: 'hi' });
    expect(result.cleanText).toBe('');
  });

  it('covers the namespace wrapper path even when the body has no invoke (lines 186-191)', () => {
    // No <invoke> inside -> top-level parseInvokeBlocks adds nothing, but the
    // namespace pattern still matches and runs parseInvokeBlocks over the wrapper.
    const text = 'ns:tool_call some prose </ns:tool_call>';
    const result = parseToolCallsFromText(text);
    expect(result.toolCalls).toHaveLength(0);
    expect(result.cleanText).toBe('');
  });

  it('skips a namespaced wrapper already covered by an earlier matched range', () => {
    // The <tool_call> block fully contains a ns:tool_call substring; the alreadyMatched
    // guard (line 187) must skip re-parsing the inner namespaced wrapper.
    const text = '<tool_call>{"name":"web_search","arguments":{"query":"x mcp:tool_call</mcp:tool_call>"}}</tool_call>';
    const result = parseToolCallsFromText(text);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe('web_search');
  });
});

// ===========================================================================
// Gemma text parsing branches (via runToolLoop text fallback)
// ===========================================================================
describe('runToolLoop — Gemma text parsing branches', () => {
  beforeEach(resetMocks);

  function mockTextThenFinal(text: string) {
    mockedGenerateResponseWithTools
      .mockResolvedValueOnce({ fullResponse: text, toolCalls: [] })
      .mockResolvedValueOnce({ fullResponse: 'Final.', toolCalls: [] });
  }

  it('parseGemmaColonArgs: JSON body with prefix matching name (lines 72-74)', async () => {
    // colon args start with the tool name then a JSON object -> JSON.parse branch
    mockTextThenFinal('<|tool_call>call:web_search:web_search{"query":"jsonbody"}<tool_call|>');
    await runToolLoop(createContext());
    expect(mockExecuteToolCall).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'web_search', arguments: { query: 'jsonbody' } }),
    );
  });

  it('parseGemmaColonArgs: no recognisable key returns empty args (line 85)', async () => {
    // After the colon there is no "key:" pattern and no JSON -> falls through to {} (line 85).
    mockTextThenFinal('<|tool_call>call:web_search: !!!nokeyhere<tool_call|>');
    await runToolLoop(createContext());
    // web_search with empty args -> backfilled from last user query
    expect(mockExecuteToolCall).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'web_search', arguments: { query: 'Hello' } }),
    );
  });

  it('parseGemmaToolCallBody: body with no name match is ignored (line 91)', async () => {
    // Body cannot match /^(?:call:)?(\w+)/ -> early return, no tool call produced.
    mockedGenerateResponseWithTools.mockResolvedValueOnce({
      fullResponse: '<|tool_call>   {"query":"x"}<tool_call|>',
      toolCalls: [],
    });
    await runToolLoop(createContext());
    expect(mockExecuteToolCall).not.toHaveBeenCalled();
  });

  it('web_search queries[] is normalised into query (line 107)', async () => {
    mockTextThenFinal('<|tool_call>call:web_search{"queries":["first","second"]}<tool_call|>');
    await runToolLoop(createContext());
    expect(mockExecuteToolCall).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'web_search', arguments: expect.objectContaining({ query: 'first' }) }),
    );
  });

  it('web_search queries as a string is normalised into query (line 107 non-array)', async () => {
    mockTextThenFinal('<|tool_call>call:web_search{"queries":"onlyone"}<tool_call|>');
    await runToolLoop(createContext());
    expect(mockExecuteToolCall).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'web_search', arguments: expect.objectContaining({ query: 'onlyone' }) }),
    );
  });
});

// ===========================================================================
// buildLiteRTHistory — content mapping/filter (lines 353-354)
// ===========================================================================
describe('buildLiteRTHistory', () => {
  it('maps prior user/assistant turns and drops empty/blank ones', () => {
    const messages: Message[] = [
      makeMessage({ role: 'user', content: 'first question' }),
      makeMessage({ role: 'assistant', content: 'an answer' }),
      makeMessage({ role: 'system', content: 'ignored system' }),
      makeMessage({ role: 'assistant', content: '   ' }), // blank -> filtered out
      makeMessage({ role: 'user', content: 'latest question' }), // last user, excluded
    ];
    const history = buildLiteRTHistory(messages);
    expect(history).toEqual([
      { role: 'user', content: 'first question' },
      { role: 'assistant', content: 'an answer' },
    ]);
  });

  it('returns [] when the last user message is the first message', () => {
    const messages: Message[] = [makeMessage({ role: 'user', content: 'only one' })];
    expect(buildLiteRTHistory(messages)).toEqual([]);
  });

  it('coerces non-string content to empty string then filters it (line 353)', () => {
    const messages: Message[] = [
      makeMessage({ role: 'assistant', content: ['array', 'content'] as any }),
      makeMessage({ role: 'user', content: 'now' }),
    ];
    // non-string content -> '' -> filtered out by the trim guard
    expect(buildLiteRTHistory(messages)).toEqual([]);
  });
});

// ===========================================================================
// LiteRT loop branches
// ===========================================================================
describe('runToolLoop — LiteRT loop branches', () => {
  beforeEach(() => {
    resetMocks();
    mockAppState = {
      downloadedModels: [{ id: 'litert-1', engine: 'litert' }],
      activeModelId: 'litert-1',
      settings: { temperature: 0.7, maxTokens: 512, topP: 0.9, liteRTTemperature: 0.7, liteRTTopP: 0.9 },
    };
    mockedLiteRT.isModelLoaded.mockReturnValue(true);
  });

  it('short-circuits with empty response on a text-and-media-free turn (line 410)', async () => {
    const ctx = createContext({
      messages: [
        makeMessage({ role: 'system', content: 'sys' }),
        makeMessage({ role: 'user', content: '', attachments: [] }),
      ],
    });
    await runToolLoop(ctx);

    expect(mockedLiteRT.generateRaw).not.toHaveBeenCalled();
    // empty fullResponse -> emitFinalResponse falls back to the "_(No response)_" sentinel
    expect(ctx.onFinalResponse).toHaveBeenCalledWith('_(No response)_');
  });

  it('streams native onToken/onReasoning through ctx.onStream (lines 415-416)', async () => {
    const onStream = jest.fn();
    mockedLiteRT.generateRaw.mockImplementation(async (_t: any, _m: any, handlers: any) => {
      handlers.onToken('tok');
      handlers.onReasoning('reason');
      return 'done';
    });

    const ctx = createContext({
      messages: [makeMessage({ role: 'user', content: 'hi' })],
      onStream,
    });
    await runToolLoop(ctx);

    expect(onStream).toHaveBeenCalledWith(expect.objectContaining({ content: 'tok' }));
    expect(onStream).toHaveBeenCalledWith(expect.objectContaining({ reasoningContent: 'reason' }));
  });

  it('retries without tools when the native FC parser hard-fails (lines 423-431)', async () => {
    let call = 0;
    mockedLiteRT.generateRaw.mockImplementation(async () => {
      call++;
      if (call === 1) throw new Error('Failed to parse FC calls (Status Code: 3)');
      return 'recovered answer';
    });

    const ctx = createContext({ messages: [makeMessage({ role: 'user', content: 'hi' })] });
    await runToolLoop(ctx);

    // generateRaw called twice (with tools, then retry without tools)
    expect(mockedLiteRT.generateRaw).toHaveBeenCalledTimes(2);
    // The retry re-prepares the conversation with an empty tools array.
    const lastPrepare = mockedLiteRT.prepareConversation.mock.calls.at(-1)!;
    expect(lastPrepare[2]).toEqual(expect.objectContaining({ tools: [] }));
    expect(ctx.onFinalResponse).toHaveBeenCalledWith('recovered answer');
  });

  it('rethrows a non-parse error without retrying (line 427 negative branch)', async () => {
    mockedLiteRT.generateRaw.mockRejectedValue(new Error('out of memory'));

    const ctx = createContext({ messages: [makeMessage({ role: 'user', content: 'hi' })] });
    await expect(runToolLoop(ctx)).rejects.toThrow('out of memory');
    expect(mockedLiteRT.generateRaw).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// buildDateTimeContext precise branch (lines 469-470) via time-sensitive tool
// ===========================================================================
describe('runToolLoop — precise date/time context for calendar tools', () => {
  beforeEach(resetMocks);

  it('appends a precise time-of-day note to the latest user message when a calendar tool is enabled', async () => {
    mockedGenerateResponseWithTools.mockResolvedValue({ fullResponse: 'ok', toolCalls: [] });

    const ctx = createContext({
      enabledToolIds: ['create_calendar_event'],
      messages: [
        makeMessage({ role: 'system', content: 'You are helpful.' }),
        makeMessage({ role: 'user', content: 'Schedule a sync' }),
      ],
    });
    await runToolLoop(ctx);

    const sentMessages = mockedGenerateResponseWithTools.mock.calls[0][0];
    // The STABLE date stays in the system prefix (kept cacheable turn-to-turn)...
    const sysContent = sentMessages.find((m: Message) => m.role === 'system')!.content as string;
    expect(sysContent).toContain('The current date is');
    // ...while the EXACT time-of-day is appended to the latest user message instead,
    // so the large system+tools prefix is not invalidated each turn (the TTFT fix).
    const userContent = [...sentMessages]
      .reverse()
      .find((m: Message) => m.role === 'user')!.content as string;
    expect(userContent).toContain('Current local date and time');
    expect(userContent).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(userContent).toContain('in half an hour');
  });

  it('uses the date-only context when no time-sensitive tool is enabled', async () => {
    mockedGenerateResponseWithTools.mockResolvedValue({ fullResponse: 'ok', toolCalls: [] });

    const ctx = createContext({
      enabledToolIds: ['web_search'],
      messages: [makeMessage({ role: 'system', content: 'You are helpful.' })],
    });
    await runToolLoop(ctx);

    const sentMessages = mockedGenerateResponseWithTools.mock.calls[0][0];
    const sysContent = sentMessages.find((m: Message) => m.role === 'system')!.content as string;
    expect(sysContent).toContain('current date is');
    expect(sysContent).not.toContain('current date and time is');
  });
});

// ===========================================================================
// selectEffectiveSchemas — native routing path (lines 639-651)
// ===========================================================================
describe('runToolLoop — selectEffectiveSchemas tool routing (LiteRT)', () => {
  // > TOOL_SELECTION_THRESHOLD (5) total tools, ext tools present, LiteRT active -> routes.
  const builtIn = [
    { type: 'function', function: { name: 'web_search' } },
    { type: 'function', function: { name: 'calculator' } },
  ];
  function extWithSchemas(names: string[]) {
    return [{
      canHandle: () => false,
      execute: jest.fn(),
      getSystemPromptHint: () => '',
      enabledToolCount: () => names.length,
      parseToolCalls: () => [],
      stripFromVisibleText: (t: string) => t,
      getOpenAISchemas: () => names.map(n => ({ type: 'function', function: { name: n } })),
    }];
  }

  beforeEach(() => {
    resetMocks();
    mockAppState = {
      downloadedModels: [{ id: 'litert-1', engine: 'litert' }],
      activeModelId: 'litert-1',
      settings: { temperature: 0.7, maxTokens: 512, topP: 0.9, liteRTTemperature: 0.7, liteRTTopP: 0.9 },
    };
    mockedLiteRT.isModelLoaded.mockReturnValue(true);
    mockGetToolsAsOpenAISchema.mockReturnValue(builtIn);
    mockedLiteRT.generateRaw.mockResolvedValue('answer');
  });

  it('keeps only the ext tools the router selected, plus built-ins (lines 642-648)', async () => {
    mockGetToolExtensions.mockReturnValue(extWithSchemas(['mcp_a', 'mcp_b', 'mcp_c', 'mcp_d']));
    mockSelectRelevantTools.mockResolvedValue(['mcp_b']);

    const ctx = createContext({
      enabledToolIds: ['web_search'],
      messages: [makeMessage({ role: 'user', content: 'do a thing' })],
    });
    await runToolLoop(ctx);

    expect(mockSelectRelevantTools).toHaveBeenCalled();
    const toolsPassed = mockedLiteRT.prepareConversation.mock.calls[0][2]!.tools as any[];
    const names = toolsPassed.map(t => t.function.name);
    expect(names).toEqual(expect.arrayContaining(['web_search', 'calculator', 'mcp_b']));
    expect(names).not.toContain('mcp_a');
  });

  it('keeps built-in tools only when the router names nothing usable (lines 643-645)', async () => {
    mockGetToolExtensions.mockReturnValue(extWithSchemas(['mcp_a', 'mcp_b', 'mcp_c', 'mcp_d']));
    mockSelectRelevantTools.mockResolvedValue([]);

    const ctx = createContext({
      enabledToolIds: ['web_search'],
      messages: [makeMessage({ role: 'user', content: 'do a thing' })],
    });
    await runToolLoop(ctx);

    const toolsPassed = mockedLiteRT.prepareConversation.mock.calls[0][2]!.tools as any[];
    const names = toolsPassed.map(t => t.function.name);
    expect(names).toEqual(['web_search', 'calculator']);
  });

  it('falls back to all tools when the router throws (lines 649-651)', async () => {
    mockGetToolExtensions.mockReturnValue(extWithSchemas(['mcp_a', 'mcp_b', 'mcp_c', 'mcp_d']));
    mockSelectRelevantTools.mockRejectedValue(new Error('router boom'));

    const ctx = createContext({
      enabledToolIds: ['web_search'],
      messages: [makeMessage({ role: 'user', content: 'do a thing' })],
    });
    await runToolLoop(ctx);

    const toolsPassed = mockedLiteRT.prepareConversation.mock.calls[0][2]!.tools as any[];
    const names = toolsPassed.map(t => t.function.name);
    expect(names).toEqual(expect.arrayContaining(['web_search', 'calculator', 'mcp_a', 'mcp_b', 'mcp_c', 'mcp_d']));
  });

  it('does not route when total tools are at or below the threshold', async () => {
    // Only 1 ext tool -> total = 3 (<= 5) -> shouldRoute false, selectRelevantTools not called.
    mockGetToolExtensions.mockReturnValue(extWithSchemas(['mcp_a']));
    mockSelectRelevantTools.mockResolvedValue(['mcp_a']);

    const ctx = createContext({
      enabledToolIds: ['web_search'],
      messages: [makeMessage({ role: 'user', content: 'do a thing' })],
    });
    await runToolLoop(ctx);

    expect(mockSelectRelevantTools).not.toHaveBeenCalled();
  });
});
