/**
 * QA matrix: MCP tool-calling end-to-end through the REAL tool loop.
 *
 * Drives runToolLoop with the REAL McpToolExtension + REAL McpClient (only the
 * XHR transport is faked) so the whole seam is exercised: the model emits a
 * tool call → the extension routes it to the MCP client → the client hits the
 * (faked) server → the typed ToolResult is folded back into the answer the user
 * sees. Every assertion is on the TERMINAL artifact (onFinalResponse text or the
 * stored tool-result message), never merely "was called".
 *
 * Axes crossed here:
 *   engine        : llama (generateResponseWithTools) × litert (generateRaw + onToolCall)
 *   tool source   : MCP tool (real McpToolExtension over a faked MCP server)
 *   outcome       : success · tool-level isError · malformed 200 · non-text block
 *   loop          : single call · final-answer folding
 *
 * These are GREEN guard tests: each fails if the seam under test is deleted or
 * inverted (e.g. if the loop stopped folding the tool result into the final
 * answer, or if a tool-level error were reported as an empty success).
 */

import { runToolLoop, ToolLoopContext } from '../../../src/services/generationToolLoop';
import {
  registerToolExtension,
  _clearExtensionsForTesting,
} from '../../../src/services/tools/extensions';
import { useChatStore, useAppStore } from '../../../src/stores';
import { resetStores } from '../../utils/testHelpers';
import { McpToolExtension } from '../../../pro/mcp/McpToolExtension';
import { useMcpStore } from '../../../pro/mcp/mcpStore';
import { McpClient } from '../../../pro/mcp/mcpClient';
import { _registerClientDirect } from '../../../pro/mcp/mcpService';

jest.mock('../../../src/services/llm');
jest.mock('../../../src/services/litert');
jest.mock('../../../src/services/activeModelService');

const { llmService } = require('../../../src/services/llm');
const { liteRTService } = require('../../../src/services/litert');

jest.mock('../../../src/services/tools', () => ({
  getToolsAsOpenAISchema: jest.fn(() => []),
  executeToolCall: jest.fn().mockResolvedValue({ name: 'builtin', content: 'builtin', durationMs: 1 }),
}));

const SERVER_ID = 'srv1';
const TOOL = 'search_docs';

/** Install a fake XHR that replays a fixed sequence of HTTP responses. */
function installXhr(responses: Array<{ status: number; contentType?: string; text: string; sessionId?: string; wwwAuth?: string }>): { sent: string[] } {
  let i = 0;
  const sent: string[] = [];
  (global as any).XMLHttpRequest = class {
    status = 0; responseText = ''; timeout = 0;
    onload: any; onerror: any; ontimeout: any;
    open() {}
    setRequestHeader() {}
    getResponseHeader(name: string) {
      const r = responses[Math.min(i, responses.length - 1)];
      const n = name.toLowerCase();
      if (n === 'content-type') return r.contentType ?? 'application/json';
      if (n === 'mcp-session-id') return r.sessionId ?? null;
      if (n === 'www-authenticate') return r.wwwAuth ?? null;
      return null;
    }
    send(payload: string) {
      sent.push(payload);
      const r = responses[Math.min(i, responses.length - 1)];
      i++;
      this.status = r.status;
      this.responseText = r.text;
      setTimeout(() => this.onload(), 0);
    }
  };
  return { sent };
}

function rpcOk(result: unknown): string {
  return JSON.stringify({ jsonrpc: '2.0', id: 1, result });
}

/** Register the tool in the MCP store and wire a live client so the extension routes to it. */
function wireMcpServer(): void {
  const store = useMcpStore.getState();
  store.setServerTools(SERVER_ID, [
    { name: TOOL, description: 'search the docs', inputSchema: { type: 'object', properties: {} } } as any,
  ]);
  store.setConnectionState(SERVER_ID, 'connected');
  _registerClientDirect(SERVER_ID, new McpClient({ url: 'https://mcp.example/rpc' }));
}

function makeCtx(overrides: Partial<ToolLoopContext> = {}): ToolLoopContext {
  const conversationId = useChatStore.getState().createConversation('test-model');
  return {
    conversationId,
    messages: [
      { id: 'sys', role: 'system', content: 'You are helpful.', timestamp: 0 },
      { id: 'u1', role: 'user', content: 'Search the docs for widgets.', timestamp: 1 },
    ],
    enabledToolIds: [],
    isAborted: () => false,
    onThinkingDone: jest.fn(),
    onFinalResponse: jest.fn(),
    ...overrides,
  };
}

/** The MCP call the model emits, in the extension's text format. */
const MCP_CALL_TEXT = `<mcp_tool_call>{"name":"${TOOL}","arguments":{"q":"widgets"}}</mcp_tool_call>`;

function activateLiteRT(): void {
  useAppStore.setState({
    downloadedModels: [{ id: 'lm', name: 'LiteRT', engine: 'litert' } as any],
    activeModelId: 'lm',
  } as any);
  liteRTService.isModelLoaded.mockReturnValue(true);
}

function finalText(ctx: ToolLoopContext): string {
  return (ctx.onFinalResponse as jest.Mock).mock.calls.map(c => c[0]).join('');
}

function storedToolResult(ctx: ToolLoopContext) {
  const msgs = useChatStore.getState().conversations.find(c => c.id === ctx.conversationId)?.messages ?? [];
  return msgs.find(m => m.role === 'tool' && m.toolName === TOOL);
}

beforeEach(() => {
  resetStores();
  useMcpStore.setState({ servers: [], serverTools: {}, toolOwners: {}, enabledTools: [], knownToolNames: [], connectionStates: {} } as any);
  _clearExtensionsForTesting();
  jest.clearAllMocks();
  registerToolExtension(McpToolExtension);
  liteRTService.isModelLoaded.mockReturnValue(false);
  llmService.isModelLoaded.mockReturnValue(true);
  llmService.supportsToolCalling.mockReturnValue(false);
  llmService.stopGeneration.mockResolvedValue(undefined);
  wireMcpServer();
});

// ---------------------------------------------------------------------------
// LLAMA engine (generateResponseWithTools; MCP call parsed from text)
// ---------------------------------------------------------------------------
describe('llama engine × MCP tool', () => {
  it('success: the tool result is folded into the answer the user sees', async () => {
    installXhr([rpcOk({ content: [{ type: 'text', text: 'Widget docs: the widget spins.' }] })].map(t => ({ status: 200, text: t })));
    llmService.generateResponseWithTools
      .mockResolvedValueOnce({ fullResponse: MCP_CALL_TEXT, toolCalls: [] })
      .mockResolvedValueOnce({ fullResponse: 'The widget spins.', toolCalls: [] });

    const ctx = makeCtx();
    await runToolLoop(ctx);

    // TERMINAL: the model's final turn saw the tool output and answered from it.
    expect(finalText(ctx)).toContain('The widget spins.');
    // The tool result actually reached the transcript (not empty).
    expect(storedToolResult(ctx)?.content).toContain('the widget spins');
    // And the model's second call received the tool result as a tool-role message.
    const secondCallMsgs = llmService.generateResponseWithTools.mock.calls[1][0] as any[];
    expect(secondCallMsgs.some((m: any) => m.role === 'tool' && String(m.content).includes('the widget spins'))).toBe(true);
  });

  it('tool-level isError: model is told the tool FAILED, never an empty success', async () => {
    installXhr([{ status: 200, text: rpcOk({ isError: true, content: [{ type: 'text', text: 'rate limited' }] }) }]);
    llmService.generateResponseWithTools
      .mockResolvedValueOnce({ fullResponse: MCP_CALL_TEXT, toolCalls: [] })
      .mockResolvedValueOnce({ fullResponse: 'Sorry, the search failed.', toolCalls: [] });

    const ctx = makeCtx();
    await runToolLoop(ctx);

    const stored = storedToolResult(ctx);
    // The explicit-failure contract: the model-facing content states failure, not ''.
    expect(stored?.content).toMatch(/failed/i);
    expect(stored?.content).toMatch(/rate limited/);
    expect(stored?.content).not.toBe('');
    // The failure text was handed to the follow-up generation.
    const secondCallMsgs = llmService.generateResponseWithTools.mock.calls[1][0] as any[];
    expect(secondCallMsgs.some((m: any) => m.role === 'tool' && /failed/i.test(String(m.content)))).toBe(true);
  });

  it('malformed 200 (no result): surfaced as a failure the model can see, not empty success', async () => {
    installXhr([{ status: 200, text: JSON.stringify({ jsonrpc: '2.0', id: 1 }) }]);
    llmService.generateResponseWithTools
      .mockResolvedValueOnce({ fullResponse: MCP_CALL_TEXT, toolCalls: [] })
      .mockResolvedValueOnce({ fullResponse: 'The search did not return anything.', toolCalls: [] });

    const ctx = makeCtx();
    await runToolLoop(ctx);

    const stored = storedToolResult(ctx);
    expect(stored?.content).toMatch(/failed/i);
    expect(stored?.content).toMatch(/malformed/i);
  });

  it('non-text block only: the model is told extra content exists, not handed nothing', async () => {
    installXhr([{ status: 200, text: rpcOk({ content: [{ type: 'image', data: 'base64' }] }) }]);
    llmService.generateResponseWithTools
      .mockResolvedValueOnce({ fullResponse: MCP_CALL_TEXT, toolCalls: [] })
      .mockResolvedValueOnce({ fullResponse: 'Here is the image result.', toolCalls: [] });

    const ctx = makeCtx();
    await runToolLoop(ctx);

    const stored = storedToolResult(ctx);
    // Non-text content is NOTED, never silently dropped to ''.
    expect(stored?.content).toMatch(/non-text/i);
    expect(stored?.content).toMatch(/image/);
    expect(stored?.content).not.toBe('');
  });
});

// ---------------------------------------------------------------------------
// LITERT engine (generateRaw + native onToolCall callback)
// ---------------------------------------------------------------------------
describe('litert engine × MCP tool', () => {
  /** Make the mocked native SDK invoke the tool-call handler once, then answer. */
  function driveLiteRTOneToolCall(finalAnswer: string): void {
    liteRTService.generateRaw.mockImplementation(
      async (_text: string, _media: any, handlers: any) => {
        // Native SDK calls back into JS with the model's tool call.
        await handlers.onToolCall(TOOL, { q: 'widgets' });
        return finalAnswer;
      },
    );
    liteRTService.prepareConversation.mockResolvedValue(undefined);
  }

  it('success: litert folds the tool result into the answer the user sees', async () => {
    activateLiteRT();
    installXhr([{ status: 200, text: rpcOk({ content: [{ type: 'text', text: 'Widget docs: it spins.' }] }) }]);
    driveLiteRTOneToolCall('The widget spins.');

    const ctx = makeCtx();
    await runToolLoop(ctx);

    expect(finalText(ctx)).toContain('The widget spins.');
    expect(storedToolResult(ctx)?.content).toContain('it spins');
  });

  it('tool-level isError: the failure string is returned to the native SDK, not ""', async () => {
    activateLiteRT();
    installXhr([{ status: 200, text: rpcOk({ isError: true, content: [{ type: 'text', text: 'rate limited' }] }) }]);

    let handedToModel = '';
    liteRTService.prepareConversation.mockResolvedValue(undefined);
    liteRTService.generateRaw.mockImplementation(
      async (_t: string, _m: any, handlers: any) => {
        handedToModel = await handlers.onToolCall(TOOL, { q: 'widgets' });
        return 'Sorry, the search failed.';
      },
    );

    const ctx = makeCtx();
    await runToolLoop(ctx);

    // What the native SDK receives for the tool call must state the failure.
    expect(handedToModel).toMatch(/failed/i);
    expect(handedToModel).toMatch(/rate limited/);
    expect(handedToModel).not.toBe('');
    expect(storedToolResult(ctx)?.content).toMatch(/failed/i);
  });

  it('non-text block only: litert hands the model a note, never ""', async () => {
    activateLiteRT();
    installXhr([{ status: 200, text: rpcOk({ content: [{ type: 'resource', resource: {} }] }) }]);

    let handedToModel = '';
    liteRTService.prepareConversation.mockResolvedValue(undefined);
    liteRTService.generateRaw.mockImplementation(
      async (_t: string, _m: any, handlers: any) => {
        handedToModel = await handlers.onToolCall(TOOL, {});
        return 'Result attached.';
      },
    );

    const ctx = makeCtx();
    await runToolLoop(ctx);

    expect(handedToModel).toMatch(/non-text/i);
    expect(handedToModel).not.toBe('');
  });

  it('litert caps runaway tool calls: the 4th+ call in one response is blocked', async () => {
    activateLiteRT();
    installXhr([{ status: 200, text: rpcOk({ content: [{ type: 'text', text: 'ok' }] }) }]);
    const handed: string[] = [];
    liteRTService.prepareConversation.mockResolvedValue(undefined);
    liteRTService.generateRaw.mockImplementation(
      async (_t: string, _m: any, handlers: any) => {
        for (let i = 0; i < 5; i++) handed.push(await handlers.onToolCall(TOOL, {}));
        return 'done';
      },
    );

    const ctx = makeCtx();
    await runToolLoop(ctx);

    // First 3 execute for real; 4th and 5th are refused with the stop-now instruction.
    expect(handed.slice(0, 3).every(h => h === 'ok')).toBe(true);
    expect(handed[3]).toMatch(/limit reached/i);
    expect(handed[4]).toMatch(/limit reached/i);
  });
});

// ---------------------------------------------------------------------------
// Loop: chained + multiple distinct MCP tools (llama path)
// ---------------------------------------------------------------------------
describe('llama engine × MCP loop shapes', () => {
  it('chained calls: two sequential tool rounds both fold into the final answer', async () => {
    installXhr([
      { status: 200, text: rpcOk({ content: [{ type: 'text', text: 'FIRST-RESULT' }] }) },
      { status: 200, text: rpcOk({ content: [{ type: 'text', text: 'SECOND-RESULT' }] }) },
    ]);
    llmService.generateResponseWithTools
      .mockResolvedValueOnce({ fullResponse: MCP_CALL_TEXT, toolCalls: [] })
      .mockResolvedValueOnce({ fullResponse: MCP_CALL_TEXT, toolCalls: [] })
      .mockResolvedValue({ fullResponse: 'Both steps done.', toolCalls: [] });

    const ctx = makeCtx();
    await runToolLoop(ctx);

    const msgs = useChatStore.getState().conversations.find(c => c.id === ctx.conversationId)?.messages ?? [];
    const toolMsgs = msgs.filter(m => m.role === 'tool' && m.toolName === TOOL);
    // Both rounds ran and both results are in the transcript.
    expect(toolMsgs.length).toBe(2);
    expect(toolMsgs[0].content).toContain('FIRST-RESULT');
    expect(toolMsgs[1].content).toContain('SECOND-RESULT');
    expect(finalText(ctx)).toContain('Both steps done.');
  });
});
