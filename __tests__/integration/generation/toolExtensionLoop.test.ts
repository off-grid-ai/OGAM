/**
 * Integration test: registered ToolExtension flows through runToolLoop.
 *
 * Verifies:
 * 1. Extension system-prompt hint is appended to the system message.
 * 2. Extension tool calls parsed from LLM text are collected.
 * 3. Extension executor is called instead of the built-in executeToolCall.
 * 4. Extension tool calls result in a tool-result message in the chat store.
 * 5. Free path (no extensions): behaviour is identical to today.
 */

import { runToolLoop, ToolLoopContext } from '../../../src/services/generationToolLoop';
import {
  registerToolExtension,
  _clearExtensionsForTesting,
  ToolExtension,
} from '../../../src/services/tools/extensions';
import type { ToolCall } from '../../../src/services/tools/types';
import { useChatStore } from '../../../src/stores';
import { resetStores } from '../../utils/testHelpers';

// Mock the LLM so we control what it "says"
jest.mock('../../../src/services/llm');
jest.mock('../../../src/services/litert');
jest.mock('../../../src/services/activeModelService');

const { llmService } = require('../../../src/services/llm');
const { liteRTService } = require('../../../src/services/litert');

// Mock executeToolCall so built-in tools don't actually run
jest.mock('../../../src/services/tools', () => ({
  getToolsAsOpenAISchema: jest.fn(() => []),
  executeToolCall: jest.fn().mockResolvedValue({ name: 'builtin', content: 'builtin-result', durationMs: 1 }),
}));

// Mock the stores index: pull in the REAL chat + app stores (the loop reads/writes
// them and the test asserts on stored messages), stub the remote server store so we
// stay on the local path. Requiring the submodules directly avoids loading the full
// stores index (auth/whisper/project), which fails to initialise in this test env.
jest.mock('../../../src/stores', () => {
  const { useChatStore: realChatStore } = jest.requireActual('../../../src/stores/chatStore');
  const { useAppStore: realAppStore } = jest.requireActual('../../../src/stores/appStore');
  return {
    useChatStore: realChatStore,
    useAppStore: realAppStore,
    useRemoteServerStore: {
      getState: () => ({ activeServerId: null, activeRemoteTextModelId: null }),
    },
  };
});

// Fake extension that parses <mcp_call>tool_name</mcp_call> tags
const MCP_TOOL_NAME = 'mcp_fake_tool';
const MCP_HINT = '\n\nMCP tools available:\n- mcp_fake_tool: A fake MCP tool';
const MCP_RESULT = 'mcp-result-content';

function makeFakeExtension(executorMock: jest.Mock): ToolExtension {
  return {
    id: 'mcp',
    getSystemPromptHint: () => MCP_HINT,
    parseToolCalls: (text: string): ToolCall[] => {
      const match = /<mcp_call>([\s\S]*?)<\/mcp_call>/.exec(text);
      if (!match) return [];
      return [{ id: 'mcp-tc-1', name: match[1].trim(), arguments: {} }];
    },
    stripFromVisibleText: (text: string) => text.replace(/<mcp_call>[\s\S]*?<\/mcp_call>/g, '').trim(),
    canHandle: (name: string) => name === MCP_TOOL_NAME,
    execute: executorMock,
    enabledToolCount: () => 1,
  };
}

function makeCtx(overrides: Partial<ToolLoopContext> = {}): ToolLoopContext {
  // createConversation takes a modelId and returns the generated conversation UUID
  const conversationId = useChatStore.getState().createConversation('test-model');
  return {
    conversationId,
    messages: [
      { id: 'sys', role: 'system', content: 'You are helpful.', timestamp: 0 },
      { id: 'u1', role: 'user', content: 'Run the MCP tool.', timestamp: 1 },
    ],
    enabledToolIds: [],
    isAborted: () => false,
    onThinkingDone: jest.fn(),
    onFinalResponse: jest.fn(),
    ...overrides,
  };
}

describe('tool extension loop integration', () => {
  beforeEach(() => {
    resetStores();
    _clearExtensionsForTesting();
    jest.clearAllMocks();
    liteRTService.isModelLoaded.mockReturnValue(false);
    llmService.isModelLoaded.mockReturnValue(true);
    llmService.stopGeneration.mockResolvedValue(undefined);
  });

  describe('free path — no extensions registered', () => {
    it('calls onFinalResponse with the LLM text', async () => {
      llmService.generateResponseWithTools.mockResolvedValue({
        fullResponse: 'Hello world',
        toolCalls: [],
      });
      const ctx = makeCtx();
      await runToolLoop(ctx);
      expect(ctx.onFinalResponse).toHaveBeenCalledWith('Hello world');
    });
  });

  function setupProExtension(
    firstResponse = `<mcp_call>${MCP_TOOL_NAME}</mcp_call>`,
    secondResponse = 'Done.',
  ): jest.Mock {
    const executorMock = jest.fn().mockResolvedValue({
      name: MCP_TOOL_NAME, content: MCP_RESULT, durationMs: 5,
    });
    registerToolExtension(makeFakeExtension(executorMock));
    llmService.generateResponseWithTools
      .mockResolvedValueOnce({ fullResponse: firstResponse, toolCalls: [] })
      .mockResolvedValueOnce({ fullResponse: secondResponse, toolCalls: [] });
    return executorMock;
  }

  describe('pro path — extension registered', () => {
    it('appends extension hint to the system prompt sent to LLM', async () => {
      setupProExtension();

      const ctx = makeCtx();
      await runToolLoop(ctx);

      // System prompt in the first LLM call should contain the extension hint
      const firstCallMessages = llmService.generateResponseWithTools.mock.calls[0][0] as any[];
      const sysMsg = firstCallMessages.find((m: any) => m.role === 'system');
      expect(sysMsg.content).toContain(MCP_HINT);
    });

    it('routes execution to the extension executor, not built-in executeToolCall', async () => {
      const executorMock = setupProExtension();

      const ctx = makeCtx();
      await runToolLoop(ctx);

      expect(executorMock).toHaveBeenCalledTimes(1);
      expect(executorMock).toHaveBeenCalledWith(
        expect.objectContaining({ name: MCP_TOOL_NAME }),
      );

      const { executeToolCall } = require('../../../src/services/tools');
      expect(executeToolCall).not.toHaveBeenCalled();
    });

    it('stores tool result in chat store', async () => {
      setupProExtension();

      const ctx = makeCtx();
      await runToolLoop(ctx);

      const messages = useChatStore.getState().conversations.find(c => c.id === ctx.conversationId)?.messages ?? [];
      const toolResultMsg = messages.find(m => m.role === 'tool' && m.toolName === MCP_TOOL_NAME);
      expect(toolResultMsg).toBeDefined();
      expect(toolResultMsg?.content).toBe(MCP_RESULT);
    });

    it('strips extension syntax from visible text', async () => {
      setupProExtension(`Thinking...<mcp_call>${MCP_TOOL_NAME}</mcp_call>`, 'Final answer.');

      const ctx = makeCtx();
      await runToolLoop(ctx);

      // The assistant message stored for the tool-call turn must not contain the raw tag
      const messages = useChatStore.getState().conversations.find(c => c.id === ctx.conversationId)?.messages ?? [];
      const assistantMsg = messages.find(m => m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0);
      expect(assistantMsg?.content).not.toContain('<mcp_call>');
    });
  });
});
