/**
 * Generation Tool Loop Unit Tests
 *
 * Tests for the tool-calling generation loop that orchestrates
 * LLM calls, tool execution, and result re-injection.
 * Priority: P0 (Critical) - Core tool-calling functionality.
 */

import { runToolLoop, ToolLoopContext, parseToolCallsFromText } from '../../../src/services/generationToolLoop';
import { llmService } from '../../../src/services/llm';
import { liteRTService } from '../../../src/services/litert';
import { Message } from '../../../src/types';
import { createMessage } from '../../utils/factories';
import type { ToolCall, ToolResult } from '../../../src/services/tools/types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockAddMessage = jest.fn();
const mockSetStreamingMessage = jest.fn();
const mockSetIsThinking = jest.fn();
let mockAppState: any = {
  downloadedModels: [],
  activeModelId: null,
  settings: {
    temperature: 0.7,
    maxTokens: 1024,
    topP: 0.9,
    liteRTTemperature: 0.7,
    liteRTTopP: 0.9,
  },
};

jest.mock('../../../src/stores', () => ({
  useChatStore: {
    getState: () => ({
      addMessage: mockAddMessage,
      setStreamingMessage: mockSetStreamingMessage,
      setIsThinking: mockSetIsThinking,
    }),
  },
  useRemoteServerStore: {
    getState: () => ({
      activeServerId: null,
    }),
  },
  useAppStore: {
    getState: () => mockAppState,
  },
}));

jest.mock('../../../src/services/llm', () => ({
  llmService: {
    generateResponseWithTools: jest.fn(),
    supportsThinking: jest.fn(() => false),
    isThinkingEnabled: jest.fn(() => false),
    supportsToolCalling: jest.fn(() => false),
    stopGeneration: jest.fn().mockResolvedValue(undefined),
    isModelLoaded: jest.fn(() => true),
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

const mockGetToolsAsOpenAISchema = jest.fn((_ids?: string[]) => [{ type: 'function', function: { name: 'mock_tool' } }]);
const mockExecuteToolCall = jest.fn();

jest.mock('../../../src/services/tools', () => ({
  getToolsAsOpenAISchema: (ids: string[]) => mockGetToolsAsOpenAISchema(ids),
  executeToolCall: (call: Record<string, unknown>) => mockExecuteToolCall(call),
}));

const mockedGenerateResponseWithTools = llmService.generateResponseWithTools as jest.Mock;
const mockedLiteRTService = liteRTService as jest.Mocked<typeof liteRTService>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMessage(overrides: Partial<Message> = {}): Message {
  return createMessage({ content: 'Hello', ...overrides } as any);
}

function makeToolCall(overrides: Partial<ToolCall> = {}): ToolCall {
  return {
    id: 'tc-1',
    name: 'web_search',
    arguments: { query: 'test' },
    ...overrides,
  };
}

function makeToolResult(overrides: Partial<ToolResult> = {}): ToolResult {
  return {
    toolCallId: 'tc-1',
    name: 'web_search',
    content: 'Search results here',
    durationMs: 120,
    ...overrides,
  };
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runToolLoop', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockExecuteToolCall.mockReset();
    mockedGenerateResponseWithTools.mockReset();
    mockAppState = {
      downloadedModels: [],
      activeModelId: null,
      settings: {
        temperature: 0.7,
        maxTokens: 1024,
        topP: 0.9,
        liteRTTemperature: 0.7,
        liteRTTopP: 0.9,
      },
    };
    mockGetToolsAsOpenAISchema.mockReturnValue([
      { type: 'function', function: { name: 'web_search' } },
    ]);
    mockedLiteRTService.isModelLoaded.mockReturnValue(false);
    mockedLiteRTService.prepareConversation.mockResolvedValue(undefined);
    mockedLiteRTService.generateRaw.mockResolvedValue('LiteRT response');
  });

  // ==========================================================================
  // Final response (no tool calls)
  // ==========================================================================
  describe('final response with no tool calls', () => {
    it('returns final response when model produces no tool calls', async () => {
      mockedGenerateResponseWithTools.mockResolvedValue({
        fullResponse: 'Here is the answer.',
        toolCalls: [],
      });

      const ctx = createContext();
      await runToolLoop(ctx);

      expect(ctx.onThinkingDone).toHaveBeenCalledTimes(1);
      expect(ctx.onFinalResponse).toHaveBeenCalledWith('Here is the answer.');
    });

    it('calls onFirstToken callback when final response is produced', async () => {
      mockedGenerateResponseWithTools.mockResolvedValue({
        fullResponse: 'Answer',
        toolCalls: [],
      });

      const onFirstToken = jest.fn();
      const ctx = createContext({ callbacks: { onFirstToken } });
      await runToolLoop(ctx);

      expect(onFirstToken).toHaveBeenCalledTimes(1);
    });

    it('calls onFinalResponse with "_(No response)_" when fullResponse is empty and no tokens were streamed', async () => {
      mockedGenerateResponseWithTools.mockResolvedValue({
        fullResponse: '',
        toolCalls: [],
      });

      const ctx = createContext();
      await runToolLoop(ctx);

      // emitFinalResponse now always calls onFinalResponse when nothing was streamed —
      // empty displayResponse falls back to the "_(No response)_" sentinel value
      expect(ctx.onFinalResponse).toHaveBeenCalledWith('_(No response)_');
      expect(ctx.onThinkingDone).toHaveBeenCalledTimes(1);
    });

    it('does not add any messages to chat store when no tool calls', async () => {
      mockedGenerateResponseWithTools.mockResolvedValue({
        fullResponse: 'Direct answer',
        toolCalls: [],
      });

      const ctx = createContext();
      await runToolLoop(ctx);

      expect(mockAddMessage).not.toHaveBeenCalled();
    });
  });

  describe('LiteRT image forwarding', () => {
    it('forwards all image attachments from the last user message to LiteRT', async () => {
      mockAppState = {
        ...mockAppState,
        downloadedModels: [{ id: 'litert-1', engine: 'litert' }],
        activeModelId: 'litert-1',
      };
      mockedLiteRTService.isModelLoaded.mockReturnValue(true);

      const ctx = createContext({
        messages: [
          makeMessage({ role: 'system', content: 'You are helpful.' }),
          makeMessage({
            role: 'user',
            content: 'Compare these images',
            attachments: [
              { id: 'img-1', type: 'image', uri: 'file:///one.png' },
              { id: 'doc-1', type: 'document', uri: 'file:///note.pdf' },
              { id: 'img-2', type: 'image', uri: 'file:///two.png' },
            ],
          }),
        ],
      });

      await runToolLoop(ctx);

      expect(mockedLiteRTService.generateRaw).toHaveBeenCalledWith(
        'Compare these images',
        expect.objectContaining({ imageUris: ['file:///one.png', 'file:///two.png'] }),
        expect.objectContaining({
          onToken: expect.any(Function),
          onReasoning: expect.any(Function),
        }),
      );
    });

    it('forwards an audio attachment even when the turn has no text', async () => {
      mockAppState = {
        ...mockAppState,
        downloadedModels: [{ id: 'litert-1', engine: 'litert' }],
        activeModelId: 'litert-1',
      };
      mockedLiteRTService.isModelLoaded.mockReturnValue(true);

      const ctx = createContext({
        messages: [
          makeMessage({ role: 'system', content: 'You are helpful.' }),
          makeMessage({
            role: 'user',
            content: '',
            attachments: [
              { id: 'aud-1', type: 'audio', uri: 'file:///clip.wav' },
            ],
          }),
        ],
      });

      await runToolLoop(ctx);

      // The empty-text guard must NOT short-circuit an audio-only turn.
      expect(mockedLiteRTService.generateRaw).toHaveBeenCalledWith(
        '',
        expect.objectContaining({ audioUris: ['file:///clip.wav'] }),
        expect.objectContaining({
          onToken: expect.any(Function),
          onReasoning: expect.any(Function),
        }),
      );
    });
  });

  // ==========================================================================
  // Tool execution loop
  // ==========================================================================
  describe('tool execution loop', () => {
    it('executes a tool call and re-injects the result', async () => {
      const toolResult = makeToolResult();
      mockExecuteToolCall.mockResolvedValue(toolResult);

      // First call: model requests a tool call
      // Second call: model returns final response
      mockedGenerateResponseWithTools
        .mockResolvedValueOnce({
          fullResponse: 'Let me search for that.',
          toolCalls: [makeToolCall()],
        })
        .mockResolvedValueOnce({
          fullResponse: 'Based on the search results, here is the answer.',
          toolCalls: [],
        });

      const ctx = createContext();
      await runToolLoop(ctx);

      // Tool was executed
      expect(mockExecuteToolCall).toHaveBeenCalledTimes(1);
      expect(mockExecuteToolCall).toHaveBeenCalledWith(makeToolCall());

      // Final response was delivered
      expect(ctx.onFinalResponse).toHaveBeenCalledWith(
        'Based on the search results, here is the answer.',
      );

      // LLM was called twice (initial + after tool result)
      expect(mockedGenerateResponseWithTools).toHaveBeenCalledTimes(2);
    });

    // Text-format tool-call parsing — small local models emit tool calls as text
    // (no structured tool_calls). resolveToolCalls must recover them.
    describe('text tool-call format parsing', () => {
      // Returns the given text as the first turn's response (no structured calls),
      // then a plain final answer on the second turn.
      function mockTextToolCall(text: string) {
        mockExecuteToolCall.mockResolvedValue(makeToolResult());
        mockedGenerateResponseWithTools
          .mockResolvedValueOnce({ fullResponse: text, toolCalls: [] })
          .mockResolvedValueOnce({ fullResponse: 'Final answer.', toolCalls: [] });
      }

      it('parses Gemma native <|tool_call> with JSON args', async () => {
        mockTextToolCall('<|tool_call>call:web_search{"query":"weather"}<tool_call|>');
        await runToolLoop(createContext());
        expect(mockExecuteToolCall).toHaveBeenCalledWith(
          expect.objectContaining({ name: 'web_search', arguments: { query: 'weather' } }),
        );
      });

      it('parses Gemma <|tool_call> with unquoted keys (fixUnquotedKeys)', async () => {
        mockTextToolCall('<|tool_call>call:web_search{query: "rain"}<tool_call|>');
        await runToolLoop(createContext());
        expect(mockExecuteToolCall).toHaveBeenCalledWith(
          expect.objectContaining({ name: 'web_search', arguments: { query: 'rain' } }),
        );
      });

      it('parses an unclosed Gemma <|tool_call> at end of text', async () => {
        mockTextToolCall('Let me check. <|tool_call>call:web_search{"query":"news"}');
        await runToolLoop(createContext());
        expect(mockExecuteToolCall).toHaveBeenCalledWith(
          expect.objectContaining({ name: 'web_search', arguments: { query: 'news' } }),
        );
      });

      it('parses Gemma colon-style args', async () => {
        mockTextToolCall('<|tool_call>call:web_search:query: today<tool_call|>');
        await runToolLoop(createContext());
        expect(mockExecuteToolCall).toHaveBeenCalledWith(
          expect.objectContaining({ name: 'web_search' }),
        );
      });

      it('parses <tool_call> function-call style: name({...})', async () => {
        mockTextToolCall('<tool_call>web_search({"query":"stocks"})</tool_call>');
        await runToolLoop(createContext());
        expect(mockExecuteToolCall).toHaveBeenCalledWith(
          expect.objectContaining({ name: 'web_search', arguments: { query: 'stocks' } }),
        );
      });

      it('parses <tool_call> bare style: name{...}', async () => {
        mockTextToolCall('<tool_call>web_search{"query":"prices"}</tool_call>');
        await runToolLoop(createContext());
        expect(mockExecuteToolCall).toHaveBeenCalledWith(
          expect.objectContaining({ name: 'web_search', arguments: { query: 'prices' } }),
        );
      });

      it('parses standard <tool_call> JSON {name, arguments}', async () => {
        mockTextToolCall('<tool_call>{"name":"web_search","arguments":{"query":"json"}}</tool_call>');
        await runToolLoop(createContext());
        expect(mockExecuteToolCall).toHaveBeenCalledWith(
          expect.objectContaining({ name: 'web_search', arguments: { query: 'json' } }),
        );
      });

      it('backfills an empty web_search query from the last user message (no-args style)', async () => {
        mockTextToolCall('<tool_call>web_search</tool_call>');
        await runToolLoop(createContext({ messages: [makeMessage({ content: 'find recent AI news' })] }));
        expect(mockExecuteToolCall).toHaveBeenCalledWith(
          expect.objectContaining({ name: 'web_search', arguments: { query: 'find recent AI news' } }),
        );
      });
    });

    it('adds assistant and tool result messages to chat store', async () => {
      mockExecuteToolCall.mockResolvedValue(makeToolResult());

      mockedGenerateResponseWithTools
        .mockResolvedValueOnce({
          fullResponse: 'Searching...',
          toolCalls: [makeToolCall()],
        })
        .mockResolvedValueOnce({
          fullResponse: 'Done.',
          toolCalls: [],
        });

      const ctx = createContext();
      await runToolLoop(ctx);

      // Two messages added: assistant (with tool calls) + tool result
      expect(mockAddMessage).toHaveBeenCalledTimes(2);

      // First: assistant message with tool calls
      const assistantMsg = mockAddMessage.mock.calls[0][1];
      expect(assistantMsg.role).toBe('assistant');
      expect(assistantMsg.content).toBe('Searching...');
      expect(assistantMsg.toolCalls).toHaveLength(1);
      expect(assistantMsg.toolCalls[0].name).toBe('web_search');
      expect(assistantMsg.toolCalls[0].arguments).toBe(JSON.stringify({ query: 'test' }));

      // Second: tool result message
      const toolMsg = mockAddMessage.mock.calls[1][1];
      expect(toolMsg.role).toBe('tool');
      expect(toolMsg.content).toBe('Search results here');
      expect(toolMsg.toolCallId).toBe('tc-1');
      expect(toolMsg.toolName).toBe('web_search');
      expect(toolMsg.generationTimeMs).toBe(120);
    });

    it('handles tool result with error', async () => {
      mockExecuteToolCall.mockResolvedValue(
        makeToolResult({ error: 'Network timeout', content: '' }),
      );

      mockedGenerateResponseWithTools
        .mockResolvedValueOnce({
          fullResponse: '',
          toolCalls: [makeToolCall()],
        })
        .mockResolvedValueOnce({
          fullResponse: 'Sorry, the search failed.',
          toolCalls: [],
        });

      const ctx = createContext();
      await runToolLoop(ctx);

      // Tool result message should contain the error
      const toolMsg = mockAddMessage.mock.calls[1][1];
      expect(toolMsg.content).toBe('Error: Network timeout');
    });

    it('executes multiple tool calls in a single iteration', async () => {
      const tc1 = makeToolCall({ id: 'tc-1', name: 'web_search', arguments: { query: 'a' } });
      const tc2 = makeToolCall({ id: 'tc-2', name: 'web_search', arguments: { query: 'b' } });

      mockExecuteToolCall
        .mockResolvedValueOnce(makeToolResult({ toolCallId: 'tc-1', name: 'web_search' }))
        .mockResolvedValueOnce(makeToolResult({ toolCallId: 'tc-2', name: 'web_search' }));

      mockedGenerateResponseWithTools
        .mockResolvedValueOnce({
          fullResponse: 'Searching both...',
          toolCalls: [tc1, tc2],
        })
        .mockResolvedValueOnce({
          fullResponse: 'Here are both results.',
          toolCalls: [],
        });

      const ctx = createContext();
      await runToolLoop(ctx);

      expect(mockExecuteToolCall).toHaveBeenCalledTimes(2);
      // 1 assistant + 2 tool results = 3 messages
      expect(mockAddMessage).toHaveBeenCalledTimes(3);
    });

    it('passes tool schemas from getToolsAsOpenAISchema to LLM', async () => {
      const schemas = [{ type: 'function', function: { name: 'custom_tool' } }];
      mockGetToolsAsOpenAISchema.mockReturnValue(schemas);

      mockedGenerateResponseWithTools.mockResolvedValue({
        fullResponse: 'Answer',
        toolCalls: [],
      });

      const ctx = createContext({ enabledToolIds: ['custom_tool'] });
      await runToolLoop(ctx);

      expect(mockGetToolsAsOpenAISchema).toHaveBeenCalledWith(['custom_tool']);
      expect(mockedGenerateResponseWithTools).toHaveBeenCalledWith(
        expect.any(Array),
        { tools: schemas },
      );
    });
  });

  // ==========================================================================
  // MAX_TOOL_ITERATIONS limit
  // ==========================================================================
  describe('iteration limit', () => {
    it('stops after MAX_TOOL_ITERATIONS (3) even if model keeps requesting tools', async () => {
      const toolCall = makeToolCall();
      mockExecuteToolCall.mockResolvedValue(makeToolResult());

      // Model always requests tool calls, but on the 3rd iteration it should
      // still return the final response
      mockedGenerateResponseWithTools.mockResolvedValue({
        fullResponse: 'Still thinking...',
        toolCalls: [toolCall],
      });

      const ctx = createContext();
      await runToolLoop(ctx);

      // On iteration 2 (0-indexed), the condition
      // `iteration === MAX_TOOL_ITERATIONS - 1` triggers the final response.
      // So generateResponseWithTools is called 3 times total.
      expect(mockedGenerateResponseWithTools).toHaveBeenCalledTimes(3);

      // The last iteration should produce the final response
      expect(ctx.onFinalResponse).toHaveBeenCalledWith('Still thinking...');
      expect(ctx.onThinkingDone).toHaveBeenCalledTimes(1);
    });

    it('executes tools for iterations 0 through 1 but not on iteration 2', async () => {
      const toolCall = makeToolCall();
      mockExecuteToolCall.mockResolvedValue(makeToolResult());

      mockedGenerateResponseWithTools.mockResolvedValue({
        fullResponse: 'Thinking...',
        toolCalls: [toolCall],
      });

      const ctx = createContext();
      await runToolLoop(ctx);

      // Tools are executed for iterations 0-1 (2 iterations), not on iteration 2
      expect(mockExecuteToolCall).toHaveBeenCalledTimes(2);
    });
  });

  // ==========================================================================
  // Abort signal
  // ==========================================================================
  describe('abort handling', () => {
    it('breaks out of loop immediately when aborted before first LLM call', async () => {
      const ctx = createContext({ isAborted: () => true });
      await runToolLoop(ctx);

      expect(mockedGenerateResponseWithTools).not.toHaveBeenCalled();
      expect(ctx.onFinalResponse).not.toHaveBeenCalled();
    });

    it('stops executing tool calls when aborted mid-iteration', async () => {
      let aborted = false;
      const tc1 = makeToolCall({ id: 'tc-1', name: 'tool_a' });
      const tc2 = makeToolCall({ id: 'tc-2', name: 'tool_b' });

      mockExecuteToolCall.mockImplementation(async (call: ToolCall) => {
        if (call.id === 'tc-1') {
          aborted = true; // Abort after first tool completes
        }
        return makeToolResult({ toolCallId: call.id, name: call.name });
      });

      mockedGenerateResponseWithTools
        .mockResolvedValueOnce({
          fullResponse: '',
          toolCalls: [tc1, tc2],
        })
        .mockResolvedValueOnce({
          fullResponse: 'Should not reach.',
          toolCalls: [],
        });

      const ctx = createContext({ isAborted: () => aborted });
      await runToolLoop(ctx);

      // Only first tool should be executed; second is skipped due to abort
      expect(mockExecuteToolCall).toHaveBeenCalledTimes(1);
    });

    it('does not produce a final response when aborted between iterations', async () => {
      mockExecuteToolCall.mockResolvedValueOnce(makeToolResult());

      mockedGenerateResponseWithTools
        .mockResolvedValueOnce({
          fullResponse: '',
          toolCalls: [makeToolCall()],
        })
        .mockResolvedValueOnce({
          fullResponse: 'Should not reach.',
          toolCalls: [],
        });

      let abortAfterFirstTool = false;
      const ctx = createContext({
        isAborted: () => abortAfterFirstTool,
        callbacks: {
          onToolCallComplete: () => {
            abortAfterFirstTool = true;
          },
        },
      });

      await runToolLoop(ctx);

      // The loop ran one iteration (LLM + tool execution), then abort
      // prevented the second iteration, so no final response was produced.
      expect(mockedGenerateResponseWithTools).toHaveBeenCalledTimes(1);
      expect(mockExecuteToolCall).toHaveBeenCalledTimes(1);
      expect(ctx.onFinalResponse).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // Callbacks
  // ==========================================================================
  describe('callbacks', () => {
    it('calls onToolCallStart before executing each tool call', async () => {
      const onToolCallStart = jest.fn();
      mockExecuteToolCall.mockResolvedValue(makeToolResult());

      mockedGenerateResponseWithTools
        .mockResolvedValueOnce({
          fullResponse: '',
          toolCalls: [makeToolCall({ name: 'web_search', arguments: { query: 'test' } })],
        })
        .mockResolvedValueOnce({
          fullResponse: 'Done.',
          toolCalls: [],
        });

      const ctx = createContext({ callbacks: { onToolCallStart } });
      await runToolLoop(ctx);

      expect(onToolCallStart).toHaveBeenCalledTimes(1);
      expect(onToolCallStart).toHaveBeenCalledWith('web_search', { query: 'test' });
    });

    it('calls onToolCallComplete after executing each tool call', async () => {
      const onToolCallComplete = jest.fn();
      const result = makeToolResult();
      mockExecuteToolCall.mockResolvedValue(result);

      mockedGenerateResponseWithTools
        .mockResolvedValueOnce({
          fullResponse: '',
          toolCalls: [makeToolCall()],
        })
        .mockResolvedValueOnce({
          fullResponse: 'Done.',
          toolCalls: [],
        });

      const ctx = createContext({ callbacks: { onToolCallComplete } });
      await runToolLoop(ctx);

      expect(onToolCallComplete).toHaveBeenCalledTimes(1);
      expect(onToolCallComplete).toHaveBeenCalledWith('web_search', result);
    });

    it('calls onToolCallStart and onToolCallComplete for multiple tool calls', async () => {
      const onToolCallStart = jest.fn();
      const onToolCallComplete = jest.fn();

      const tc1 = makeToolCall({ id: 'tc-1', name: 'tool_a', arguments: { x: 1 } });
      const tc2 = makeToolCall({ id: 'tc-2', name: 'tool_b', arguments: { y: 2 } });

      mockExecuteToolCall
        .mockResolvedValueOnce(makeToolResult({ name: 'tool_a' }))
        .mockResolvedValueOnce(makeToolResult({ name: 'tool_b' }));

      mockedGenerateResponseWithTools
        .mockResolvedValueOnce({
          fullResponse: '',
          toolCalls: [tc1, tc2],
        })
        .mockResolvedValueOnce({
          fullResponse: 'All done.',
          toolCalls: [],
        });

      const ctx = createContext({
        callbacks: { onToolCallStart, onToolCallComplete },
      });
      await runToolLoop(ctx);

      expect(onToolCallStart).toHaveBeenCalledTimes(2);
      expect(onToolCallStart).toHaveBeenNthCalledWith(1, 'tool_a', { x: 1 });
      expect(onToolCallStart).toHaveBeenNthCalledWith(2, 'tool_b', { y: 2 });

      expect(onToolCallComplete).toHaveBeenCalledTimes(2);
    });

    it('does not throw when callbacks are undefined', async () => {
      mockExecuteToolCall.mockResolvedValue(makeToolResult());

      mockedGenerateResponseWithTools
        .mockResolvedValueOnce({
          fullResponse: '',
          toolCalls: [makeToolCall()],
        })
        .mockResolvedValueOnce({
          fullResponse: 'Done.',
          toolCalls: [],
        });

      const ctx = createContext({ callbacks: undefined });

      // Should not throw
      await expect(runToolLoop(ctx)).resolves.toBeUndefined();
    });

    it('calls onFirstToken only on final response, not during tool iterations', async () => {
      const onFirstToken = jest.fn();
      mockExecuteToolCall.mockResolvedValue(makeToolResult());

      mockedGenerateResponseWithTools
        .mockResolvedValueOnce({
          fullResponse: 'Searching...',
          toolCalls: [makeToolCall()],
        })
        .mockResolvedValueOnce({
          fullResponse: 'Final answer.',
          toolCalls: [],
        });

      const ctx = createContext({ callbacks: { onFirstToken } });
      await runToolLoop(ctx);

      expect(onFirstToken).toHaveBeenCalledTimes(1);
    });
  });

  // ==========================================================================
  // Message construction
  // ==========================================================================
  describe('message construction', () => {
    it('builds assistant message with serialized tool call arguments', async () => {
      const args = { query: 'hello world', limit: 5 };
      mockExecuteToolCall.mockResolvedValue(makeToolResult());

      mockedGenerateResponseWithTools
        .mockResolvedValueOnce({
          fullResponse: 'Thinking...',
          toolCalls: [makeToolCall({ id: 'tc-x', name: 'search', arguments: args })],
        })
        .mockResolvedValueOnce({
          fullResponse: 'Done.',
          toolCalls: [],
        });

      const ctx = createContext();
      await runToolLoop(ctx);

      const assistantMsg = mockAddMessage.mock.calls[0][1];
      expect(assistantMsg.toolCalls[0].arguments).toBe(JSON.stringify(args));
    });

    it('uses empty string for assistant content when fullResponse is empty', async () => {
      mockExecuteToolCall.mockResolvedValue(makeToolResult());

      mockedGenerateResponseWithTools
        .mockResolvedValueOnce({
          fullResponse: '',
          toolCalls: [makeToolCall()],
        })
        .mockResolvedValueOnce({
          fullResponse: 'Done.',
          toolCalls: [],
        });

      const ctx = createContext();
      await runToolLoop(ctx);

      const assistantMsg = mockAddMessage.mock.calls[0][1];
      expect(assistantMsg.content).toBe('');
    });

    it('passes conversationId to addMessage for both assistant and tool messages', async () => {
      mockExecuteToolCall.mockResolvedValue(makeToolResult());

      mockedGenerateResponseWithTools
        .mockResolvedValueOnce({
          fullResponse: '',
          toolCalls: [makeToolCall()],
        })
        .mockResolvedValueOnce({
          fullResponse: 'Done.',
          toolCalls: [],
        });

      const ctx = createContext({ conversationId: 'my-conv-42' });
      await runToolLoop(ctx);

      expect(mockAddMessage).toHaveBeenCalledTimes(2);
      expect(mockAddMessage.mock.calls[0][0]).toBe('my-conv-42');
      expect(mockAddMessage.mock.calls[1][0]).toBe('my-conv-42');
    });

    it('tool result message uses tc.id for toolCallId when present', async () => {
      mockExecuteToolCall.mockResolvedValue(makeToolResult());

      mockedGenerateResponseWithTools
        .mockResolvedValueOnce({
          fullResponse: '',
          toolCalls: [makeToolCall({ id: 'call_abc123' })],
        })
        .mockResolvedValueOnce({
          fullResponse: 'Done.',
          toolCalls: [],
        });

      const ctx = createContext();
      await runToolLoop(ctx);

      const toolMsg = mockAddMessage.mock.calls[1][1];
      expect(toolMsg.toolCallId).toBe('call_abc123');
    });

    it('messages are appended to loopMessages for subsequent LLM calls', async () => {
      mockExecuteToolCall.mockResolvedValue(makeToolResult());

      mockedGenerateResponseWithTools
        .mockResolvedValueOnce({
          fullResponse: 'Let me check.',
          toolCalls: [makeToolCall()],
        })
        .mockResolvedValueOnce({
          fullResponse: 'Final.',
          toolCalls: [],
        });

      const originalMessages = [makeMessage({ content: 'What is the weather?' })];
      const ctx = createContext({ messages: originalMessages });
      await runToolLoop(ctx);

      // Second LLM call should receive original + assistant + tool result messages
      const secondCallMessages = mockedGenerateResponseWithTools.mock.calls[1][0];
      expect(secondCallMessages.length).toBe(3); // original + assistant + tool result
      expect(secondCallMessages[0].content).toBe('What is the weather?');
      expect(secondCallMessages[1].role).toBe('assistant');
      expect(secondCallMessages[2].role).toBe('tool');
    });
  });

  // ==========================================================================
  // Multi-iteration scenarios
  // ==========================================================================
  describe('multi-iteration scenarios', () => {
    it('handles two rounds of tool calls before final response', async () => {
      mockExecuteToolCall.mockResolvedValue(makeToolResult());

      mockedGenerateResponseWithTools
        .mockResolvedValueOnce({
          fullResponse: 'Searching...',
          toolCalls: [makeToolCall({ id: 'tc-1' })],
        })
        .mockResolvedValueOnce({
          fullResponse: 'Need more info...',
          toolCalls: [makeToolCall({ id: 'tc-2' })],
        })
        .mockResolvedValueOnce({
          fullResponse: 'Here is the complete answer.',
          toolCalls: [],
        });

      const ctx = createContext();
      await runToolLoop(ctx);

      expect(mockedGenerateResponseWithTools).toHaveBeenCalledTimes(3);
      expect(mockExecuteToolCall).toHaveBeenCalledTimes(2);
      expect(ctx.onFinalResponse).toHaveBeenCalledWith('Here is the complete answer.');
      // 2 assistant + 2 tool = 4 messages added
      expect(mockAddMessage).toHaveBeenCalledTimes(4);
    });
  });

  // ==========================================================================
  // Remote provider path (forceRemote)
  // ==========================================================================
  describe('remote provider path via forceRemote', () => {
    it('throws "No remote provider active" when forceRemote=true and activeServerId is null', async () => {
      // activeServerId is null in the mock, so callRemoteLLMWithTools throws
      const ctx = createContext({ forceRemote: true } as any);
      await expect(runToolLoop(ctx)).rejects.toThrow('No remote provider active');
    });

    it('covers useRemote calculation — providerRegistry.hasProvider branch', async () => {
      const { providerRegistry } = require('../../../src/services/providers');
      // hasProvider returns true but no local model loaded → useRemote=true path
      (providerRegistry.hasProvider as jest.Mock).mockReturnValueOnce(true);
      const { useRemoteServerStore } = require('../../../src/stores');
      useRemoteServerStore.getState = () => ({ activeServerId: 'srv-1' });

      const ctx = createContext();
      // callRemoteLLMWithTools will throw since getProvider returns null
      await expect(runToolLoop(ctx)).rejects.toThrow();

      // Restore
      useRemoteServerStore.getState = () => ({ activeServerId: null });
      (providerRegistry.hasProvider as jest.Mock).mockReturnValue(false);
    });
  });

  // ==========================================================================
  // isNonRetryableError paths
  // ==========================================================================
  describe('non-retryable errors skip retry', () => {
    it('fails immediately on "No model loaded" error without retry', async () => {
      mockedGenerateResponseWithTools.mockRejectedValue(new Error('No model loaded: context missing'));
      const ctx = createContext();
      await expect(runToolLoop(ctx)).rejects.toThrow('No model loaded');
      // Should only be called once (no retry)
      expect(mockedGenerateResponseWithTools).toHaveBeenCalledTimes(1);
    });

    it('fails immediately on "aborted" error without retry', async () => {
      mockedGenerateResponseWithTools.mockRejectedValue(new Error('Request aborted by user'));
      const ctx = createContext();
      await expect(runToolLoop(ctx)).rejects.toThrow('aborted');
      expect(mockedGenerateResponseWithTools).toHaveBeenCalledTimes(1);
    });
  });
});

// ===========================================================================
// parseToolCallsFromText
// ===========================================================================

describe('parseToolCallsFromText', () => {
  it('parses a valid tool_call tag with name and arguments', () => {
    const text = 'Some text <tool_call>{"name":"web_search","arguments":{"query":"test"}}</tool_call> more text';
    const result = parseToolCallsFromText(text);

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe('web_search');
    expect(result.toolCalls[0].arguments).toEqual({ query: 'test' });
  });

  it('returns cleaned text with tags removed', () => {
    const text = 'Before <tool_call>{"name":"web_search","arguments":{"query":"test"}}</tool_call> After';
    const result = parseToolCallsFromText(text);

    expect(result.cleanText).toBe('Before  After');
  });

  it('handles multiple tool_call tags', () => {
    const text = [
      '<tool_call>{"name":"web_search","arguments":{"query":"first"}}</tool_call>',
      'middle text',
      '<tool_call>{"name":"web_search","arguments":{"query":"second"}}</tool_call>',
    ].join(' ');

    const result = parseToolCallsFromText(text);

    expect(result.toolCalls).toHaveLength(2);
    expect(result.toolCalls[0].arguments).toEqual({ query: 'first' });
    expect(result.toolCalls[1].arguments).toEqual({ query: 'second' });
    expect(result.cleanText).toBe('middle text');
  });

  it('handles malformed JSON gracefully (returns empty toolCalls for that tag)', () => {
    const text = 'Hello <tool_call>{bad json here}</tool_call> world';
    const result = parseToolCallsFromText(text);

    expect(result.toolCalls).toHaveLength(0);
    expect(result.cleanText).toBe('Hello  world');
  });

  it('returns original text when no tags are present', () => {
    const text = 'Just a regular response with no tool calls.';
    const result = parseToolCallsFromText(text);

    expect(result.toolCalls).toHaveLength(0);
    expect(result.cleanText).toBe(text);
  });

  it('supports "parameters" as alias for "arguments"', () => {
    const text = '<tool_call>{"name":"web_search","parameters":{"query":"alias test"}}</tool_call>';
    const result = parseToolCallsFromText(text);

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe('web_search');
    expect(result.toolCalls[0].arguments).toEqual({ query: 'alias test' });
  });

  // XML-like format: <tool_call><function=NAME><parameter=KEY>VALUE</tool_call>
  it.each([
    {
      desc: 'closed tag with single param',
      text: '<tool_call><function=web_search><parameter=query>Off Grid Mobile AI</tool_call>',
      name: 'web_search', args: { query: 'Off Grid Mobile AI' }, clean: '',
    },
    {
      desc: 'unclosed tag (EOS)',
      text: 'Let me search for that.\n<tool_call>\n<function=web_search>\n<parameter=query>\nOff Grid Mobile AI',
      name: 'web_search', args: { query: 'Off Grid Mobile AI' }, clean: 'Let me search for that.',
    },
    {
      desc: 'single parameter (read_url)',
      text: '<tool_call><function=read_url><parameter=url>https://example.com</tool_call>',
      name: 'read_url', args: { url: 'https://example.com' },
    },
    {
      desc: 'multiple parameters',
      text: '<tool_call><function=calculator><parameter=expression>2+2<parameter=format>decimal</tool_call>',
      name: 'calculator', args: { expression: '2+2', format: 'decimal' },
    },
    {
      desc: 'strips closing XML tags from values',
      text: '<tool_call><function=read_url><parameter=url>https://www.wednesday.is\n</parameter>\n</function></tool_call>',
      name: 'read_url', args: { url: 'https://www.wednesday.is' },
    },
    {
      desc: 'cleans surrounding text',
      text: 'Before text <tool_call><function=calculator><parameter=expression>2+2</tool_call> after text',
      name: 'calculator', args: { expression: '2+2' }, clean: 'Before text  after text',
    },
  ])('parses XML-like format: $desc', ({ text, name, args, clean }) => {
    const result = parseToolCallsFromText(text);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe(name);
    expect(result.toolCalls[0].arguments).toEqual(args);
    if (clean !== undefined) expect(result.cleanText).toBe(clean);
  });
});

// ===========================================================================
// MAX_TOTAL_TOOL_CALLS cap (integration with runToolLoop)
// ===========================================================================

describe('runToolLoop – MAX_TOTAL_TOOL_CALLS cap', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockExecuteToolCall.mockReset();
    mockedGenerateResponseWithTools.mockReset();
    mockGetToolsAsOpenAISchema.mockReturnValue([
      { type: 'function', function: { name: 'web_search' } },
    ]);
  });

  it('caps total tool calls across iterations at 5', async () => {
    // Each iteration returns 3 tool calls. After 2 iterations that would be 6,
    // but the cap should limit it to 5 total executeToolCall invocations.
    const makeThreeToolCalls = (prefix: string): ToolCall[] => [
      { id: `${prefix}-1`, name: 'web_search', arguments: { query: 'a' } },
      { id: `${prefix}-2`, name: 'web_search', arguments: { query: 'b' } },
      { id: `${prefix}-3`, name: 'web_search', arguments: { query: 'c' } },
    ];

    mockExecuteToolCall.mockResolvedValue({
      toolCallId: 'any',
      name: 'web_search',
      content: 'result',
      durationMs: 10,
    });

    // Iteration 0: 3 tool calls (all executed, total = 3)
    // Iteration 1: 3 tool calls (only 2 executed due to cap, total = 5)
    // Iteration 2: would have tool calls but hits final iteration limit
    mockedGenerateResponseWithTools
      .mockResolvedValueOnce({
        fullResponse: '',
        toolCalls: makeThreeToolCalls('iter0'),
      })
      .mockResolvedValueOnce({
        fullResponse: '',
        toolCalls: makeThreeToolCalls('iter1'),
      })
      .mockResolvedValueOnce({
        fullResponse: 'Final answer after capped tools.',
        toolCalls: [],
      });

    const ctx = createContext();
    await runToolLoop(ctx);

    // 3 from iteration 0 + 2 from iteration 1 (capped) = 5 total
    expect(mockExecuteToolCall).toHaveBeenCalledTimes(5);
  });
});

// ===========================================================================
// Web search fallback query
// ===========================================================================

describe('runToolLoop – web search fallback query', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockExecuteToolCall.mockReset();
    mockedGenerateResponseWithTools.mockReset();
    mockGetToolsAsOpenAISchema.mockReturnValue([
      { type: 'function', function: { name: 'web_search' } },
    ]);
  });

  beforeEach(() => {
    mockSetStreamingMessage.mockClear();
  });

  it('uses last user message as query when web_search is called with empty args', async () => {
    mockExecuteToolCall.mockResolvedValue({
      toolCallId: 'tc-empty',
      name: 'web_search',
      content: 'Search results',
      durationMs: 50,
    });

    mockedGenerateResponseWithTools
      .mockResolvedValueOnce({
        fullResponse: 'Let me search.',
        toolCalls: [{ id: 'tc-empty', name: 'web_search', arguments: {} }],
      })
      .mockResolvedValueOnce({
        fullResponse: 'Here are the results.',
        toolCalls: [],
      });

    const userMessage = makeMessage({ role: 'user', content: 'What is the weather in Tokyo?' });
    const ctx = createContext({ messages: [userMessage] });
    await runToolLoop(ctx);

    // The tool call should have been executed with the user's message as fallback query
    expect(mockExecuteToolCall).toHaveBeenCalledTimes(1);
    const executedCall = mockExecuteToolCall.mock.calls[0][0];
    expect(executedCall.arguments.query).toBe('What is the weather in Tokyo?');
  });
});

// ===========================================================================
// Token streaming via onStream
// ===========================================================================

describe('runToolLoop – token streaming', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockExecuteToolCall.mockReset();
    mockedGenerateResponseWithTools.mockReset();
    mockSetStreamingMessage.mockClear();
    mockGetToolsAsOpenAISchema.mockReturnValue([
      { type: 'function', function: { name: 'web_search' } },
    ]);
  });

  function createStreamingContext(overrides: Partial<ToolLoopContext> = {}): ToolLoopContext {
    return {
      conversationId: 'conv-1',
      messages: [makeMessage()],
      enabledToolIds: ['web_search'],
      isAborted: () => false,
      onThinkingDone: jest.fn(),
      onStream: jest.fn(),
      onStreamReset: jest.fn(),
      onFinalResponse: jest.fn(),
      callbacks: { onFirstToken: jest.fn() },
      ...overrides,
    };
  }

  it('passes onStream through to generateResponseWithTools', async () => {
    mockedGenerateResponseWithTools.mockResolvedValue({ fullResponse: 'Answer', toolCalls: [] });

    const ctx = createStreamingContext();
    await runToolLoop(ctx);

    const callOptions = mockedGenerateResponseWithTools.mock.calls[0][1];
    expect(callOptions.onStream).toBeDefined();
    expect(typeof callOptions.onStream).toBe('function');
  });

  it('does not pass onStream when ctx.onStream is undefined', async () => {
    mockedGenerateResponseWithTools.mockResolvedValue({ fullResponse: 'Answer', toolCalls: [] });

    const ctx = createStreamingContext({ onStream: undefined });
    await runToolLoop(ctx);

    const callOptions = mockedGenerateResponseWithTools.mock.calls[0][1];
    expect(callOptions.onStream).toBeUndefined();
  });

  it('streams tokens to ctx.onStream and fires onThinkingDone + onFirstToken on first token', async () => {
    // Mock generateResponseWithTools to call onStream with tokens
    mockedGenerateResponseWithTools.mockImplementation(async (_msgs: any, opts: any) => {
      if (opts.onStream) {
        opts.onStream('Hello');
        opts.onStream(' world');
      }
      return { fullResponse: 'Hello world', toolCalls: [] };
    });

    const ctx = createStreamingContext();
    await runToolLoop(ctx);

    expect(ctx.onStream).toHaveBeenCalledTimes(2);
    expect(ctx.onStream).toHaveBeenNthCalledWith(1, 'Hello');
    expect(ctx.onStream).toHaveBeenNthCalledWith(2, ' world');
    expect(ctx.onThinkingDone).toHaveBeenCalledTimes(1);
    expect(ctx.callbacks?.onFirstToken).toHaveBeenCalledTimes(1);
  });

  it('skips onFinalResponse when content was already streamed', async () => {
    mockedGenerateResponseWithTools.mockImplementation(async (_msgs: any, opts: any) => {
      if (opts.onStream) opts.onStream('Streamed');
      return { fullResponse: 'Streamed', toolCalls: [] };
    });

    const ctx = createStreamingContext();
    await runToolLoop(ctx);

    expect(ctx.onFinalResponse).not.toHaveBeenCalled();
  });

  it('calls onStreamReset and clears streaming message when tool calls follow streamed content', async () => {
    mockExecuteToolCall.mockResolvedValue(makeToolResult());

    mockedGenerateResponseWithTools
      .mockImplementationOnce(async (_msgs: any, opts: any) => {
        if (opts.onStream) opts.onStream('Searching...');
        return { fullResponse: 'Searching...', toolCalls: [makeToolCall()] };
      })
      .mockResolvedValueOnce({ fullResponse: 'Done.', toolCalls: [] });

    const ctx = createStreamingContext();
    await runToolLoop(ctx);

    expect(ctx.onStreamReset).toHaveBeenCalledTimes(1);
    expect(mockSetStreamingMessage).toHaveBeenCalledWith('');
  });

  it('does not call onStreamReset when no content was streamed before tool calls', async () => {
    mockExecuteToolCall.mockResolvedValue(makeToolResult());

    mockedGenerateResponseWithTools
      .mockResolvedValueOnce({ fullResponse: '', toolCalls: [makeToolCall()] })
      .mockResolvedValueOnce({ fullResponse: 'Done.', toolCalls: [] });

    const ctx = createStreamingContext();
    await runToolLoop(ctx);

    expect(ctx.onStreamReset).not.toHaveBeenCalled();
    expect(mockSetStreamingMessage).not.toHaveBeenCalled();
  });

  it('does not stream tokens when aborted', async () => {
    mockedGenerateResponseWithTools.mockImplementation(async (_msgs: any, opts: any) => {
      if (opts.onStream) opts.onStream('Should not appear');
      return { fullResponse: 'Aborted', toolCalls: [] };
    });

    const ctx = createStreamingContext({ isAborted: () => true });
    await runToolLoop(ctx);

    // Loop exits before calling generateResponseWithTools due to abort check
    expect(ctx.onStream).not.toHaveBeenCalled();
  });

  it('fires onFirstToken only once across multiple streaming tokens', async () => {
    mockedGenerateResponseWithTools.mockImplementation(async (_msgs: any, opts: any) => {
      if (opts.onStream) {
        opts.onStream('A');
        opts.onStream('B');
        opts.onStream('C');
      }
      return { fullResponse: 'ABC', toolCalls: [] };
    });

    const ctx = createStreamingContext();
    await runToolLoop(ctx);

    expect(ctx.callbacks?.onFirstToken).toHaveBeenCalledTimes(1);
    expect(ctx.onThinkingDone).toHaveBeenCalledTimes(1);
  });
});

// ==========================================================================
// resolveToolCalls – <tool_call> tag parsing
// ==========================================================================
describe('runToolLoop – resolveToolCalls via embedded tool_call tags', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetToolsAsOpenAISchema.mockReturnValue([
      { type: 'function', function: { name: 'web_search' } },
    ]);
  });

  it('parses and executes tool calls embedded in response text', async () => {
    const embeddedResponse = '<tool_call>{"name":"web_search","arguments":{"query":"test"}}</tool_call>';
    let callCount = 0;
    mockedGenerateResponseWithTools.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return { fullResponse: embeddedResponse, toolCalls: [] };
      }
      return { fullResponse: 'Final answer', toolCalls: [] };
    });
    mockExecuteToolCall.mockResolvedValue({
      toolCallId: 'tc-1', name: 'web_search', content: 'results', durationMs: 10,
    });

    const ctx = createContext();
    await runToolLoop(ctx);

    expect(mockExecuteToolCall).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'web_search' }),
    );
    expect(ctx.onFinalResponse).toHaveBeenCalledWith('Final answer');
  });

  it('returns response as-is when <tool_call> tags parse to no valid calls', async () => {
    mockedGenerateResponseWithTools.mockResolvedValue({
      fullResponse: '<tool_call>{invalid json here}</tool_call>',
      toolCalls: [],
    });

    const ctx = createContext();
    await runToolLoop(ctx);

    // No tools executed, response passed through
    expect(mockExecuteToolCall).not.toHaveBeenCalled();
    expect(ctx.onFinalResponse).toHaveBeenCalledWith('<tool_call>{invalid json here}</tool_call>');
  });
});

// ==========================================================================
// callLLMWithRetry – retry logic
// ==========================================================================
describe('runToolLoop – retry on transient errors', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetToolsAsOpenAISchema.mockReturnValue([
      { type: 'function', function: { name: 'web_search' } },
    ]);
  });

  it('retries on transient error and succeeds', async () => {
    jest.useFakeTimers();
    let callCount = 0;
    mockedGenerateResponseWithTools.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) throw new Error('Context busy');
      return { fullResponse: 'Recovered', toolCalls: [] };
    });

    const ctx = createContext();
    const promise = runToolLoop(ctx);
    await jest.runAllTimersAsync();
    await promise;

    expect(mockedGenerateResponseWithTools).toHaveBeenCalledTimes(2);
    expect(llmService.stopGeneration).toHaveBeenCalled();
    expect(ctx.onFinalResponse).toHaveBeenCalledWith('Recovered');
    jest.useRealTimers();
  });

  it('fails immediately on non-retryable error (No model loaded)', async () => {
    mockedGenerateResponseWithTools.mockRejectedValue(new Error('No model loaded'));

    const ctx = createContext();
    await expect(runToolLoop(ctx)).rejects.toThrow('No model loaded');
    expect(mockedGenerateResponseWithTools).toHaveBeenCalledTimes(1);
    expect(llmService.stopGeneration).not.toHaveBeenCalled();
  });
});

// ==========================================================================
// getLastUserQuery – empty fallback
// ==========================================================================
describe('runToolLoop – web_search empty query fallback', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetToolsAsOpenAISchema.mockReturnValue([
      { type: 'function', function: { name: 'web_search' } },
    ]);
  });

  it('uses empty string fallback when no user message exists', async () => {
    let callCount = 0;
    mockedGenerateResponseWithTools.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return { fullResponse: '', toolCalls: [{ id: 'tc-1', name: 'web_search', arguments: { query: '' } }] };
      }
      return { fullResponse: 'Done', toolCalls: [] };
    });
    mockExecuteToolCall.mockResolvedValue({
      toolCallId: 'tc-1', name: 'web_search', content: 'results', durationMs: 5,
    });

    // Only assistant messages – getLastUserQuery returns ''
    const ctx = createContext({
      messages: [makeMessage({ role: 'assistant', content: 'Previous response' })],
    });
    await runToolLoop(ctx);

    // Tool was still called (empty query fallback – no user message to replace with)
    expect(mockExecuteToolCall).toHaveBeenCalled();
  });

  describe('isAborted — abort at loop start', () => {
    it('returns immediately without calling LLM when already aborted', async () => {
      let aborted = true;
      const ctx = createContext({ isAborted: () => aborted });
      await runToolLoop(ctx);
      expect(mockedGenerateResponseWithTools).not.toHaveBeenCalled();
    });

    it('aborts mid-loop when isAborted becomes true after first iteration', async () => {
      let callCount = 0;
      mockedGenerateResponseWithTools.mockImplementation(async () => {
        callCount++;
        return {
          fullResponse: '',
          toolCalls: [{ id: `tc-${callCount}`, name: 'web_search', arguments: { query: 'test' } }],
        };
      });
      mockExecuteToolCall.mockResolvedValue({ toolCallId: 'tc-1', name: 'web_search', content: 'result', durationMs: 5 });

      let aborted = false;
      const ctx = createContext({
        isAborted: () => {
          // Abort before the second iteration
          if (callCount >= 1) aborted = true;
          return aborted;
        },
      });
      await runToolLoop(ctx);
      // Only one LLM call should have happened before abort
      expect(mockedGenerateResponseWithTools).toHaveBeenCalledTimes(1);
    });
  });
});

// ===========================================================================
// callRemoteLLMWithTools — provider generate callbacks
// ===========================================================================

describe('callRemoteLLMWithTools via forceRemote', () => {
  const { providerRegistry } = require('../../../src/services/providers');
  const { useRemoteServerStore } = require('../../../src/stores');

  let mockProvider: any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockProvider = {
      generate: jest.fn(),
      capabilities: { supportsVision: false, supportsToolCalling: true, supportsThinking: false },
    };
    (providerRegistry.getProvider as jest.Mock).mockReturnValue(mockProvider);
    useRemoteServerStore.getState = () => ({ activeServerId: 'srv-remote' });
    mockGetToolsAsOpenAISchema.mockReturnValue([{ type: 'function', function: { name: 'web_search' } }]);
  });

  afterEach(() => {
    useRemoteServerStore.getState = () => ({ activeServerId: null });
    (providerRegistry.getProvider as jest.Mock).mockReturnValue(null);
  });

  it('resolves with fullResponse and empty toolCalls when onComplete fires without toolCalls', async () => {
    mockProvider.generate.mockImplementation((_msgs: any, _opts: any, callbacks: any) => {
      callbacks.onToken('hello ');
      callbacks.onToken('world');
      callbacks.onComplete({ content: 'hello world', toolCalls: undefined });
    });

    const ctx = createContext({ forceRemote: true });
    await runToolLoop(ctx);

    expect(ctx.onFinalResponse).toHaveBeenCalledWith('hello world');
  });

  it('accumulates streaming tokens via onToken and fires onStream', async () => {
    const onStream = jest.fn();
    mockProvider.generate.mockImplementation((_msgs: any, _opts: any, callbacks: any) => {
      callbacks.onToken('chunk1');
      callbacks.onReasoning('reasoning text');
      callbacks.onComplete({ content: 'chunk1', toolCalls: [] });
    });

    const ctx = createContext({ forceRemote: true, onStream });
    await runToolLoop(ctx);

    expect(onStream).toHaveBeenCalledWith(expect.objectContaining({ content: 'chunk1' }));
    expect(onStream).toHaveBeenCalledWith(expect.objectContaining({ reasoningContent: 'reasoning text' }));
  });

  it('rejects when onError callback fires', async () => {
    mockProvider.generate.mockImplementation((_msgs: any, _opts: any, callbacks: any) => {
      callbacks.onError(new Error('remote failure'));
    });

    const ctx = createContext({ forceRemote: true });
    await expect(runToolLoop(ctx)).rejects.toThrow('remote failure');
  });

  it('resolves toolCalls with string arguments parsed as JSON', async () => {
    mockProvider.generate.mockImplementation((_msgs: any, _opts: any, callbacks: any) => {
      callbacks.onComplete({
        content: '',
        toolCalls: [{ id: 'tc-1', name: 'web_search', arguments: '{"query":"test"}' }],
      });
    });
    mockExecuteToolCall.mockResolvedValue({ toolCallId: 'tc-1', name: 'web_search', content: 'result', durationMs: 5 });
    mockedGenerateResponseWithTools.mockResolvedValue({ fullResponse: 'final', toolCalls: [] });

    // Second call (after tool execution) returns final response
    let callCount = 0;
    mockProvider.generate.mockImplementation((_msgs: any, _opts: any, callbacks: any) => {
      callCount++;
      if (callCount === 1) {
        callbacks.onComplete({
          content: '',
          toolCalls: [{ id: 'tc-1', name: 'web_search', arguments: '{"query":"test"}' }],
        });
      } else {
        callbacks.onComplete({ content: 'final answer', toolCalls: [] });
      }
    });

    const ctx = createContext({ forceRemote: true });
    await runToolLoop(ctx);

    expect(mockExecuteToolCall).toHaveBeenCalled();
  });

  it('throws Remote provider not found when getProvider returns null', async () => {
    (providerRegistry.getProvider as jest.Mock).mockReturnValue(null);

    const ctx = createContext({ forceRemote: true });
    await expect(runToolLoop(ctx)).rejects.toThrow('Remote provider not found');
  });
});

// ---------------------------------------------------------------------------
// LiteRT tool call cap (buildLiteRTToolCallHandler via runToolLoop)
// ---------------------------------------------------------------------------

describe('runToolLoop – LiteRT tool call cap', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockExecuteToolCall.mockResolvedValue({ toolCallId: 'tc-1', name: 'web_search', content: 'result', durationMs: 10 });
    mockAppState = {
      downloadedModels: [{ id: 'litert-model', engine: 'litert', liteRTVision: false }],
      activeModelId: 'litert-model',
      settings: { temperature: 0.7, maxTokens: 512, topP: 0.9, liteRTTemperature: 0.7, liteRTTopP: 0.9 },
    };
    mockedLiteRTService.isModelLoaded.mockReturnValue(true);
    mockedLiteRTService.prepareConversation.mockResolvedValue(undefined);
  });

  it('executes up to MAX_LITERT_TOOL_CALLS (3) tool calls without hitting cap', async () => {
    let capturedToolHandler: ((name: string, args: Record<string, unknown>) => Promise<string>) | undefined;
    mockedLiteRTService.generateRaw.mockImplementation(async (_text, _images, handlers) => {
      capturedToolHandler = handlers?.onToolCall;
      return 'final answer';
    });

    const ctx = createContext();
    await runToolLoop(ctx);

    // Call the handler exactly 3 times — all should execute the tool
    const results = await Promise.all([
      capturedToolHandler?.('web_search', { query: 'q1' }),
      capturedToolHandler?.('web_search', { query: 'q2' }),
      capturedToolHandler?.('web_search', { query: 'q3' }),
    ]);

    expect(mockExecuteToolCall).toHaveBeenCalledTimes(3);
    results.forEach(r => expect(r).toBe('result'));
  });

  it('returns cap message on the 4th call and does not execute the tool', async () => {
    let capturedToolHandler: ((name: string, args: Record<string, unknown>) => Promise<string>) | undefined;
    mockedLiteRTService.generateRaw.mockImplementation(async (_text, _images, handlers) => {
      capturedToolHandler = handlers?.onToolCall;
      return 'final answer';
    });

    const ctx = createContext();
    await runToolLoop(ctx);

    // Exhaust the 3-call allowance
    await capturedToolHandler?.('web_search', { query: 'q1' });
    await capturedToolHandler?.('web_search', { query: 'q2' });
    await capturedToolHandler?.('web_search', { query: 'q3' });

    // 4th call should be refused
    const capResult = await capturedToolHandler?.('web_search', { query: 'q4' });

    expect(mockExecuteToolCall).toHaveBeenCalledTimes(3);
    expect(capResult).toContain('Tool call limit reached');
    expect(capResult).toContain('Answer now');
  });

  it('returns Aborted immediately when context is aborted', async () => {
    let capturedToolHandler: ((name: string, args: Record<string, unknown>) => Promise<string>) | undefined;
    mockedLiteRTService.generateRaw.mockImplementation(async (_text, _images, handlers) => {
      capturedToolHandler = handlers?.onToolCall;
      return 'answer';
    });

    let aborted = false;
    const ctx = createContext({ isAborted: () => aborted });
    await runToolLoop(ctx);

    aborted = true;
    const result = await capturedToolHandler?.('web_search', { query: 'q' });

    expect(mockExecuteToolCall).not.toHaveBeenCalled();
    expect(result).toBe('Aborted');
  });

  it('cap counter resets per generation (new runToolLoop call resets count)', async () => {
    let capturedHandler: ((name: string, args: Record<string, unknown>) => Promise<string>) | undefined;
    mockedLiteRTService.generateRaw.mockImplementation(async (_text, _images, handlers) => {
      capturedHandler = handlers?.onToolCall;
      return 'answer';
    });

    const ctx = createContext();

    // First generation: exhaust cap
    await runToolLoop(ctx);
    await capturedHandler?.('web_search', { query: 'q1' });
    await capturedHandler?.('web_search', { query: 'q2' });
    await capturedHandler?.('web_search', { query: 'q3' });
    const cappedResult = await capturedHandler?.('web_search', { query: 'q4' });
    expect(cappedResult).toContain('Tool call limit reached');

    // Second generation: counter resets, calls work again
    await runToolLoop(ctx);
    const freshResult = await capturedHandler?.('web_search', { query: 'q1-fresh' });
    expect(freshResult).toBe('result');
    expect(mockExecuteToolCall).toHaveBeenCalledTimes(4); // 3 + 1
  });
});
