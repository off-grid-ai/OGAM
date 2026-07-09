/**
 * Extra coverage for McpToolExtension — drives the REAL extension against the REAL
 * mcpStore + remoteServerStore + schemaTrim + mcpService parse/prompt logic. The only
 * boundary stubbed is executeMcpTool (the network round-trip to a live MCP client),
 * which cannot run in jest because it needs a connected native transport.
 *
 * Every branch of the extension is exercised on both sides:
 *   - getOpenAISchemas: aggressive trim (on-device) vs pruneToolNoise (remote), missing
 *     owner, missing tool, fallback empty parameters.
 *   - getSystemPromptHint: real prompt built from the stores; empty when no tools.
 *   - parseToolCalls / stripFromVisibleText: real tag parser, calls vs no-calls.
 *   - canHandle: owned vs unowned.
 *   - execute: success path + never-throw error path.
 *   - enabledToolCount: only counts enabled tools that resolve to a connected server.
 */

// executeMcpTool is the sole boundary (needs a live native MCP client). Keep the rest
// of mcpService REAL so getMcpToolsPrompt / parseMcpToolCallsFromText run for real.
const mockExecuteMcpTool = jest.fn();
jest.mock('@offgrid/pro/mcp/mcpService', () => {
  const actual = jest.requireActual('@offgrid/pro/mcp/mcpService');
  return {
    __esModule: true,
    ...actual,
    executeMcpTool: (...args: unknown[]) => mockExecuteMcpTool(...args),
  };
});

import { McpToolExtension } from '@offgrid/pro/mcp/McpToolExtension';
import { useMcpStore } from '@offgrid/pro/mcp/mcpStore';
import { useRemoteServerStore } from '@offgrid/core/stores';
import { SMALL_MODEL_TOOL_BUDGET } from '@offgrid/pro/mcp/schemaTrim';
import type { McpTool } from '@offgrid/pro/mcp/types';

// A compact tool (under the small-model budget) — passes through trimming untouched.
const compactTool: McpTool = {
  name: 'notion_search',
  description: 'Search Notion pages.',
  inputSchema: {
    type: 'object',
    properties: { query: { type: 'string', description: 'the query' } },
    required: ['query'],
  },
};

// A large tool that exceeds the budget, with both required and optional params plus
// grammar-breaking noise keys ($schema/$ref/$defs, additionalProperties, default).
function makeLargeTool(): McpTool {
  const bigDesc = 'x'.repeat(40);
  const props: Record<string, any> = {
    required_key: { type: 'string', description: 'must stay', enum: ['a', 'b'] },
  };
  // Many fat optional props so the serialized size blows past the budget.
  for (let i = 0; i < 12; i++) {
    props[`opt_${i}`] = {
      type: 'string',
      description: `${bigDesc}${i}`,
      default: 'zzz',
      pattern: '^.*$',
    };
  }
  return {
    name: 'huge_tool',
    description: `A very long description. ${'y'.repeat(300)}`,
    inputSchema: {
      // @ts-expect-error — noise keys are stripped by the trimmer; not part of McpTool typing.
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      properties: props,
      required: ['required_key'],
      additionalProperties: false,
    },
  };
}

function resetStores() {
  useMcpStore.setState({
    servers: [],
    connectionStates: {},
    serverTools: {},
    enabledTools: [],
    knownToolNames: [],
    toolOwners: {},
  });
  useRemoteServerStore.setState({ activeRemoteTextModelId: null });
}

beforeEach(() => {
  jest.clearAllMocks();
  resetStores();
});

describe('getOpenAISchemas', () => {
  it('aggressively trims to required-only when NO remote text model is active (on-device)', () => {
    const large = makeLargeTool();
    useMcpStore.setState({
      serverTools: { s1: [large] },
      toolOwners: { huge_tool: 's1' },
      enabledTools: ['huge_tool'],
    });
    useRemoteServerStore.setState({ activeRemoteTextModelId: null });

    const schemas = McpToolExtension.getOpenAISchemas!() as any[];
    expect(schemas).toHaveLength(1);
    const params = schemas[0].function.parameters;
    // Aggressive trim keeps ONLY required params and drops all optionals + noise keys.
    expect(Object.keys(params.properties)).toEqual(['required_key']);
    expect(params.$schema).toBeUndefined();
    expect(params.additionalProperties).toBeUndefined();
    // Description is truncated to the first sentence.
    expect(schemas[0].function.description).toBe('A very long description.');
  });

  it('only prunes noise (keeps optional params) when a remote text model IS active', () => {
    const large = makeLargeTool();
    useMcpStore.setState({
      serverTools: { s1: [large] },
      toolOwners: { huge_tool: 's1' },
      enabledTools: ['huge_tool'],
    });
    useRemoteServerStore.setState({ activeRemoteTextModelId: 'gpt-x' });

    const schemas = McpToolExtension.getOpenAISchemas!() as any[];
    const params = schemas[0].function.parameters;
    // pruneToolNoise NEVER drops params — the optionals survive for a capable server.
    expect(Object.keys(params.properties).length).toBeGreaterThan(1);
    expect(Object.keys(params.properties)).toContain('required_key');
    expect(Object.keys(params.properties)).toContain('opt_0');
    // But grammar-breaking noise keys are still stripped so llama.cpp can compile it.
    expect(params.$schema).toBeUndefined();
    expect(params.additionalProperties).toBeUndefined();
  });

  it('passes a compact tool through unchanged (under the budget)', () => {
    useMcpStore.setState({
      serverTools: { s1: [compactTool] },
      toolOwners: { notion_search: 's1' },
      enabledTools: ['notion_search'],
    });
    const schemas = McpToolExtension.getOpenAISchemas!() as any[];
    expect(schemas[0].function.parameters).toEqual(compactTool.inputSchema);
  });

  it('drops an enabled tool with no owner (toolOwners miss → null → filtered)', () => {
    useMcpStore.setState({
      serverTools: {},
      toolOwners: {},
      enabledTools: ['orphan'],
    });
    expect(McpToolExtension.getOpenAISchemas!()).toEqual([]);
  });

  it('drops an enabled tool whose owner has no matching tool in serverTools', () => {
    useMcpStore.setState({
      serverTools: { s1: [compactTool] }, // owner exists but does not list "ghost"
      toolOwners: { ghost: 's1' },
      enabledTools: ['ghost'],
    });
    expect(McpToolExtension.getOpenAISchemas!()).toEqual([]);
  });

  it('falls back to an empty-object schema when a tool has no inputSchema', () => {
    const noSchema = { name: 'bare', description: 'no schema' } as unknown as McpTool;
    useMcpStore.setState({
      serverTools: { s1: [noSchema] },
      toolOwners: { bare: 's1' },
      enabledTools: ['bare'],
    });
    const schemas = McpToolExtension.getOpenAISchemas!() as any[];
    expect(schemas[0].function.parameters).toEqual({ type: 'object', properties: {} });
  });
});

describe('getSystemPromptHint', () => {
  it('returns an empty hint when no tools are enabled', () => {
    expect(McpToolExtension.getSystemPromptHint()).toBe('');
  });

  it('builds a prompt listing the enabled, resolvable tools', () => {
    useMcpStore.setState({
      serverTools: { s1: [compactTool] },
      toolOwners: { notion_search: 's1' },
      enabledTools: ['notion_search'],
    });
    const hint = McpToolExtension.getSystemPromptHint();
    expect(hint).toContain('mcp_tool_call');
    expect(hint).toContain('- notion_search: Search Notion pages.');
  });

  it('returns an empty hint when enabled tools resolve to nothing (all orphaned)', () => {
    useMcpStore.setState({
      serverTools: {},
      toolOwners: {},
      enabledTools: ['orphan'],
    });
    expect(McpToolExtension.getSystemPromptHint()).toBe('');
  });
});

describe('parseToolCalls / stripFromVisibleText', () => {
  const withCall =
    'Sure. <mcp_tool_call>{"name":"notion_search","arguments":{"query":"hi"}}</mcp_tool_call> done';

  it('extracts a real tool call with name + arguments', () => {
    const calls = McpToolExtension.parseToolCalls(withCall);
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe('notion_search');
    expect(calls[0].arguments).toEqual({ query: 'hi' });
    expect(typeof calls[0].id).toBe('string');
  });

  it('returns no calls when the text has no mcp tags', () => {
    useMcpStore.setState({ enabledTools: ['notion_search'] }); // exercises the log branch
    expect(McpToolExtension.parseToolCalls('just a normal reply')).toEqual([]);
  });

  it('strips the tool-call tags from the visible text', () => {
    const cleaned = McpToolExtension.stripFromVisibleText(withCall);
    expect(cleaned).not.toContain('mcp_tool_call');
    expect(cleaned).toContain('Sure.');
    expect(cleaned).toContain('done');
  });

  it('leaves text without tags unchanged (trimmed)', () => {
    expect(McpToolExtension.stripFromVisibleText('  hello world  ')).toBe('hello world');
  });
});

describe('canHandle', () => {
  it('is true for a tool name present in toolOwners', () => {
    useMcpStore.setState({ toolOwners: { notion_search: 's1' } });
    expect(McpToolExtension.canHandle('notion_search')).toBe(true);
  });

  it('is false for a tool name not owned by any server', () => {
    useMcpStore.setState({ toolOwners: { notion_search: 's1' } });
    expect(McpToolExtension.canHandle('unknown_tool')).toBe(false);
  });
});

describe('execute', () => {
  it('returns content + toolCallId on success and never sets error', async () => {
    mockExecuteMcpTool.mockResolvedValue({ content: 'the result', durationMs: 42 });
    const r = await McpToolExtension.execute({ id: 'c1', name: 'notion_search', arguments: { query: 'x' } });
    expect(r).toMatchObject({ toolCallId: 'c1', name: 'notion_search', content: 'the result', durationMs: 42 });
    expect(r.error).toBeUndefined();
    expect(mockExecuteMcpTool).toHaveBeenCalledWith('notion_search', { query: 'x' });
  });

  it('returns a typed error result (does NOT throw) when the call rejects with an Error', async () => {
    mockExecuteMcpTool.mockRejectedValue(new Error('Server "notion" is not connected'));
    const r = await McpToolExtension.execute({ id: 'c2', name: 'notion_search', arguments: {} });
    expect(r.toolCallId).toBe('c2');
    expect(r.content).toBe('');
    expect(r.error).toContain('not connected');
    expect(typeof r.durationMs).toBe('number');
  });

  it('uses the fallback message when the rejection is not an Error instance', async () => {
    mockExecuteMcpTool.mockRejectedValue('boom-string');
    const r = await McpToolExtension.execute({ id: 'c3', name: 'notion_search', arguments: {} });
    expect(r.error).toBe('MCP tool execution failed');
    expect(r.content).toBe('');
  });
});

describe('enabledToolCount', () => {
  it('counts only enabled tools that resolve to a connected server tool', () => {
    useMcpStore.setState({
      serverTools: { s1: [compactTool] },
      toolOwners: { notion_search: 's1', dangling: 's1' }, // dangling not in serverTools
      // "no_owner" has no entry in toolOwners at all.
      enabledTools: ['notion_search', 'dangling', 'no_owner'],
    });
    expect(McpToolExtension.enabledToolCount()).toBe(1);
  });

  it('is zero when no enabled tool resolves (all left behind by disconnected servers)', () => {
    useMcpStore.setState({
      serverTools: {},
      toolOwners: { a: 's1', b: 's2' },
      enabledTools: ['a', 'b'],
    });
    expect(McpToolExtension.enabledToolCount()).toBe(0);
  });
});

// Guard the assumption the aggressive-trim tests rely on: the large fixture really does
// exceed the small-model budget (otherwise the trim would no-op and the branch tests
// would be meaningless — a false green).
describe('fixture sanity', () => {
  it('the large tool exceeds SMALL_MODEL_TOOL_BUDGET so trimming actually engages', () => {
    const large = makeLargeTool();
    const size = JSON.stringify({
      name: large.name,
      description: large.description,
      parameters: large.inputSchema,
    }).length;
    expect(size).toBeGreaterThan(SMALL_MODEL_TOOL_BUDGET);
  });
});
