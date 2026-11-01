/**
 * Integration test: a registered ToolExtension flows through runToolLoop.
 *
 * Verifies:
 * 1. The extension's system-prompt hint is appended to the system message the model receives.
 * 2. Extension tool calls parsed from the model's text are collected.
 * 3. The call runs through the extension (on its MCP server), not the built-in tools.
 * 4. The tool result lands as a tool-result message in the chat store.
 * 5. The extension's call syntax is stripped from the visible text.
 * 6. Free path (no extensions): the model's text is the final response.
 *
 * Real: runToolLoop, llmService, activeModelService, the tool-extension registry, the pro
 * McpToolExtension with mcpService, McpClient and mcpStore, the chat store. Faked, because they are
 * the phone or the network: llama.rn, the disk and RAM (generationDevice), and the MCP server at
 * the HTTP boundary (mcpHttpFake).
 */
import { launchGeneration, type GenerationDevice } from '../../harness/generationDevice';
import { installMcpHttpFake, type McpHttpFake } from '../../harness/mcpHttpFake';

jest.mock('react-native-tcp-socket', () => {
  const { createNativeTcpBoundary } = require('../../utils/nativeSyncBoundaries');
  return { __esModule: true, default: createNativeTcpBoundary() };
});
jest.mock('react-native-zeroconf', () => {
  const { createNativeDiscoveryBoundary } = require('../../utils/nativeSyncBoundaries');
  return { __esModule: true, default: createNativeDiscoveryBoundary() };
});

const MCP_TOOL_NAME = 'mcp_fake_tool';
const SERVER = { id: 'srv-docs', name: 'Docs', url: 'https://docs.example.test/mcp' };
const CALL = `<mcp_tool_call>{"name":"${MCP_TOOL_NAME}","arguments":{}}</mcp_tool_call>`;
/** What the MCP server answers when it runs the tool. */
const MCP_RESULT = `Docs ran ${MCP_TOOL_NAME}`;

let device: GenerationDevice;
let mcp: McpHttpFake | undefined;

/**
 * Launch with a downloaded llama model. withNativeTools: false is a GGUF whose chat template has no
 * tool-calling support (llama.rn reports no jinja tool caps), so tools must be described in text.
 */
async function launch(withNativeTools = true): Promise<void> {
  device = await launchGeneration({ engine: 'llama', load: false });
  if (!withNativeTools) {
    const initLlama = device.boundary.llama!.module.initLlama;
    const open = initLlama.getMockImplementation()!;
    initLlama.mockImplementation(async (params: unknown) => {
      const context = await open(params);
      context.model = { ...context.model, chatTemplates: { jinja: { defaultCaps: { toolCalls: false }, toolUse: false } } };
      return context;
    });
  }
  await device.activeModelService.loadTextModel(device.modelId);
}

beforeEach(async () => {
  await launch();
});

afterEach(() => {
  mcp?.restore();
  mcp = undefined;
});

async function runLoop(onFinalResponse: (text: string) => void = () => {}) {
  const { runToolLoop } = require('../../../src/services/generationToolLoop');
  await runToolLoop({
    conversationId: device.conversationId,
    messages: [
      { id: 'sys', role: 'system', content: 'You are helpful.', timestamp: 0 },
      { id: 'u1', role: 'user', content: 'Run the MCP tool.', timestamp: 1 },
    ],
    enabledToolIds: [],
    isAborted: () => false,
    onThinkingDone: () => {},
    onFinalResponse,
  });
}

/** The person connected an MCP server and turned its tool on; the app registered the MCP extension. */
async function setupMcp(firstResponse = CALL, secondResponse = 'Done.') {
  mcp = installMcpHttpFake({
    [SERVER.url]: {
      label: 'Docs',
      tools: [{ name: MCP_TOOL_NAME, description: 'A fake MCP tool', inputSchema: { type: 'object', properties: {} } }],
    },
  });
  const { useMcpStore } = require('@offgrid/pro/mcp/mcpStore');
  const { connectServer } = require('@offgrid/pro/mcp/mcpService');
  const { McpToolExtension } = require('@offgrid/pro/mcp/McpToolExtension');
  const { registerToolExtension } = require('../../../src/services/tools/extensions');
  useMcpStore.getState().addServer(SERVER);
  await connectServer(SERVER.id);
  useMcpStore.getState().setEnabledTools([MCP_TOOL_NAME]);
  registerToolExtension(McpToolExtension);
  device.boundary.llama!.scriptCompletions([{ text: firstResponse }, { text: secondResponse }]);
}

const chatMessages = () =>
  device.useChatStore.getState().getConversationMessages(device.conversationId) as Array<{
    role: string; content: string; toolName?: string; toolCalls?: unknown[];
  }>;

/** The system message of the first native completion. */
function firstSystemPrompt(): string {
  const params = device.boundary.llama!.calls.completion[0][0] as { messages?: Array<{ role: string; content: unknown }>; prompt?: string };
  const system = params.messages?.find(m => m.role === 'system')?.content;
  return typeof system === 'string' ? system : JSON.stringify(system ?? params.prompt ?? '');
}

describe('tool extension loop integration', () => {
  describe('free path — no extensions registered', () => {
    it('calls onFinalResponse with the LLM text', async () => {
      device.boundary.llama!.scriptCompletion({ text: 'Hello world' });
      const finals: string[] = [];
      await runLoop(text => finals.push(text));
      expect(finals).toEqual(['Hello world']);
    });
  });

  describe('pro path — extension registered', () => {
    it('appends extension hint to the system prompt sent to a model without native tool calling', async () => {
      await launch(false);
      await setupMcp();
      await runLoop();

      const system = firstSystemPrompt();
      expect(system).toContain('MCP tools available');
      expect(system).toContain(`- ${MCP_TOOL_NAME}: A fake MCP tool`);
      expect(mcp!.calls).toEqual([{ url: SERVER.url, tool: MCP_TOOL_NAME }]);
    });

    it('offers the extension tool structurally (no text hint) to a model with native tool calling', async () => {
      await setupMcp();
      await runLoop();

      const params = device.boundary.llama!.calls.completion[0][0] as { tools?: Array<{ function: { name: string } }> };
      expect((params.tools ?? []).map(t => t.function.name)).toContain(MCP_TOOL_NAME);
      expect(firstSystemPrompt()).not.toContain('MCP tools available');
    });

    it('routes execution to the extension (its MCP server runs the tool)', async () => {
      await setupMcp();
      await runLoop();

      expect(mcp!.calls).toEqual([{ url: SERVER.url, tool: MCP_TOOL_NAME }]);
    });

    it('stores tool result in chat store', async () => {
      await setupMcp();
      await runLoop();

      const toolResult = chatMessages().find(m => m.role === 'tool' && m.toolName === MCP_TOOL_NAME);
      expect(toolResult).toBeDefined();
      expect(toolResult?.content).toBe(MCP_RESULT);
    });

    it('strips extension syntax from visible text', async () => {
      await setupMcp(`Thinking...${CALL}`, 'Final answer.');
      await runLoop();

      // The assistant message stored for the tool-call turn must not contain the raw tag
      const assistant = chatMessages().find(m => m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0);
      expect(assistant).toBeDefined();
      expect(assistant?.content).not.toContain('<mcp_tool_call>');
    });
  });
});
