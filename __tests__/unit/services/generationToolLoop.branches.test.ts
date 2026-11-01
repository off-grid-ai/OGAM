/**
 * Generation tool loop — the less common branches.
 *
 *  - parseToolCallsFromText: <invoke> blocks and namespaced wrapper blocks (pure parsing).
 *  - Gemma-style text tool calls from a llama model: colon arguments, a body with no name, web_search's
 *    `queries` folded into `query` (seen at the search provider).
 *  - buildLiteRTHistory: which earlier turns go to LiteRT.
 *  - The LiteRT loop: an empty turn, streamed tokens and reasoning, the retry without tools after the
 *    native function-call parser fails, a native error that is not that.
 *  - The date/time context a calendar tool gets.
 *  - Tool routing on LiteRT when many tools are on: what the router picked, nothing usable, a router error,
 *    too few tools to route.
 *
 * runToolLoop and the parsers are called directly; everything under them is real: llmService,
 * liteRTService, the tool registry and built-in tools (web_search, calculator), the LiteRT tool router, the
 * stores. Faked (device / network): llama.rn and the LiteRT native module (harness/generationDevice), the
 * search provider at fetch (harness/webSearchFake). The extra tools are a tool extension registered through
 * the app's own registerToolExtension, standing in for a connected MCP server's tools.
 */
import { launchGeneration, type GenerationDevice } from '../../harness/generationDevice';
import { installWebSearchFake, type WebSearchFake } from '../../harness/webSearchFake';
import { createMessage } from '../../utils/factories';
import type { Message } from '../../../src/types';
// Pure parsers: no device state, so the module instance does not matter.
import { parseToolCallsFromText, buildLiteRTHistory } from '../../../src/services/generationToolLoop';

let d: GenerationDevice;
let search: WebSearchFake | null = null;
let unregister: (() => void) | null = null;

beforeEach(async () => {
  const mod = require('@react-native-async-storage/async-storage');
  await (mod.default ?? mod).clear(); // each test is a fresh install
});

afterEach(() => {
  search?.restore();
  search = null;
  unregister?.();
  unregister = null;
});

const loop = () => require('../../../src/services/generationToolLoop');
const msg = (overrides: Partial<Message> = {}): Message => createMessage({ content: 'Hello', ...overrides } as any);

/** Run one tool-loop turn and collect what it reports back. */
async function runTurn(ctx: Partial<Record<string, unknown>> & { messages: Message[]; enabledToolIds: string[] }) {
  const finals: string[] = [];
  const streamed: Array<{ content?: string; reasoningContent?: string }> = [];
  const routed: string[][] = [];
  await loop().runToolLoop({
    conversationId: d.conversationId,
    isAborted: () => false,
    onThinkingDone: () => {},
    onFinalResponse: (c: string) => finals.push(c),
    onStream: (s: any) => streamed.push(typeof s === 'string' ? { content: s } : s),
    // The loop takes back what it streamed when that turned out to be a tool call (the screen clears it).
    onStreamReset: () => { streamed.length = 0; },
    onToolsRouted: (names: string[]) => routed.push(names),
    ...ctx,
  });
  // A streamed answer reaches the caller as stream chunks; one that never streamed comes as the final.
  const answer = finals.join('') || streamed.map(c => c.content ?? '').join('');
  return { finals, streamed, routed, answer };
}

/** The tools JSON the LiteRT conversation was last reset with (native resetConversation's 5th argument). */
const liteRTToolNames = (dev: GenerationDevice, call = -1): string[] => {
  const json = dev.boundary.litert.calls.resetConversation.at(call)?.[4] as string;
  return json ? JSON.parse(json).map((t: any) => t.function.name) : [];
};

// ===========================================================================
// parseToolCallsFromText — <invoke> blocks + namespaced wrapper
// ===========================================================================
describe('parseToolCallsFromText — invoke & namespaced blocks', () => {
  const parse = parseToolCallsFromText;

  it('parses <invoke name="..."><parameter ...> blocks', () => {
    const result = parse('Pre <invoke name="read_url"><parameter name="url">https://x.com</parameter></invoke> Post');

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe('read_url');
    expect(result.toolCalls[0].arguments).toEqual({ url: 'https://x.com' });
    expect(result.cleanText).toBe('Pre  Post');
  });

  it('parses multiple parameters inside one invoke block', () => {
    const result = parse('<invoke name="calc"><parameter name="a">1</parameter><parameter name="b">2</parameter></invoke>');
    expect(result.toolCalls[0].arguments).toEqual({ a: '1', b: '2' });
  });

  it('parses the invoke inside a namespaced wrapper block: ns:tool_call ... </ns:tool_call>', () => {
    // The top-level invoke pass sees the invoke, then the namespace pass re-parses the wrapper body:
    // both add the call.
    const result = parse('mcp:tool_call <invoke name="search"><parameter name="q">hi</parameter></invoke></mcp:tool_call>');

    expect(result.toolCalls).toHaveLength(2);
    expect(result.toolCalls.every((c: any) => c.name === 'search')).toBe(true);
    expect(result.toolCalls[0].arguments).toEqual({ q: 'hi' });
    expect(result.cleanText).toBe('');
  });

  it('strips a namespace wrapper whose body has no invoke', () => {
    const result = parse('ns:tool_call some prose </ns:tool_call>');
    expect(result.toolCalls).toHaveLength(0);
    expect(result.cleanText).toBe('');
  });

  it('skips a namespaced wrapper already inside an earlier matched block', () => {
    const result = parse('<tool_call>{"name":"web_search","arguments":{"query":"x mcp:tool_call</mcp:tool_call>"}}</tool_call>');
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe('web_search');
  });
});

// ===========================================================================
// Gemma-style text tool calls from a llama model
// ===========================================================================
describe('runToolLoop — Gemma text tool calls (llama)', () => {
  beforeEach(async () => {
    d = await launchGeneration();
    search = installWebSearchFake();
  });

  const textThenFinal = (text: string) => d.boundary.llama!.scriptCompletions([{ text }, { text: 'Final.' }]);

  it('reads colon arguments that repeat the tool name before a JSON body', async () => {
    textThenFinal('<|tool_call>call:web_search:web_search{"query":"jsonbody"}<tool_call|>');

    const { answer } = await runTurn({ messages: [msg()], enabledToolIds: ['web_search'] });

    expect(search!.queries).toEqual(['jsonbody']);
    expect(answer).toBe('Final.');
  });

  it('runs web_search on the last question when the colon arguments hold no key', async () => {
    textThenFinal('<|tool_call>call:web_search: !!!nokeyhere<tool_call|>');

    await runTurn({ messages: [msg()], enabledToolIds: ['web_search'] });

    expect(search!.queries).toEqual(['Hello']);
  });

  it('hands the answer to the caller as the final reply when the caller does not stream', async () => {
    textThenFinal('<|tool_call>call:web_search{"query":"quiet"}<tool_call|>');

    const { finals, streamed } = await runTurn({ messages: [msg()], enabledToolIds: ['web_search'], onStream: undefined });

    expect(search!.queries).toEqual(['quiet']);
    expect(streamed).toEqual([]);
    expect(finals).toEqual(['Final.']);
  });

  it('ignores a tool-call body with no tool name', async () => {
    d.boundary.llama!.scriptCompletions([{ text: '<|tool_call>   {"query":"x"}<tool_call|>' }]);

    await runTurn({ messages: [msg()], enabledToolIds: ['web_search'] });

    expect(search!.queries).toEqual([]);
    expect(d.boundary.llama!.calls.completion).toHaveLength(1);
  });

  it('folds a web_search queries[] list into its first query', async () => {
    textThenFinal('<|tool_call>call:web_search{"queries":["first","second"]}<tool_call|>');

    await runTurn({ messages: [msg()], enabledToolIds: ['web_search'] });

    expect(search!.queries).toEqual(['first']);
  });

  it('folds a web_search queries string into query', async () => {
    textThenFinal('<|tool_call>call:web_search{"queries":"onlyone"}<tool_call|>');

    await runTurn({ messages: [msg()], enabledToolIds: ['web_search'] });

    expect(search!.queries).toEqual(['onlyone']);
  });
});

// ===========================================================================
// buildLiteRTHistory
// ===========================================================================
describe('buildLiteRTHistory', () => {
  const history = buildLiteRTHistory;

  it('keeps earlier user/assistant turns and drops system and blank ones', () => {
    expect(history([
      msg({ role: 'user', content: 'first question' }),
      msg({ role: 'assistant', content: 'an answer' }),
      msg({ role: 'system', content: 'ignored system' }),
      msg({ role: 'assistant', content: '   ' }),
      msg({ role: 'user', content: 'latest question' }), // the turn being asked: not history
    ])).toEqual([
      { role: 'user', content: 'first question' },
      { role: 'assistant', content: 'an answer' },
    ]);
  });

  it('is empty when the question is the first message', () => {
    expect(history([msg({ role: 'user', content: 'only one' })])).toEqual([]);
  });

  it('drops a turn whose content is not text', () => {
    expect(history([
      msg({ role: 'assistant', content: ['array', 'content'] as any }),
      msg({ role: 'user', content: 'now' }),
    ])).toEqual([]);
  });
});

// ===========================================================================
// The LiteRT loop
// ===========================================================================
describe('runToolLoop — LiteRT', () => {
  beforeEach(async () => {
    d = await launchGeneration({ engine: 'litert' });
  });
  const sends = () => d.boundary.litert.calls.sendMessage.length;

  it('answers an empty turn with the no-response marker and sends nothing', async () => {
    const before = sends();

    const { finals } = await runTurn({
      messages: [msg({ role: 'system', content: 'sys' }), msg({ role: 'user', content: '', attachments: [] })],
      enabledToolIds: ['calculator'],
    });

    expect(sends()).toBe(before);
    expect(finals).toEqual(['_(No response)_']);
  });

  it('streams the native tokens and reasoning', async () => {
    d.boundary.litert.scriptTurn({ reasoning: 'reason', content: 'tok' });

    const { streamed, answer } = await runTurn({ messages: [msg({ role: 'user', content: 'hi' })], enabledToolIds: ['calculator'] });

    expect(streamed).toEqual(expect.arrayContaining([
      expect.objectContaining({ content: 'tok' }),
      expect.objectContaining({ reasoningContent: 'reason' }),
    ]));
    expect(answer).toBe('tok');
  });

  it('asks again without tools when the native function-call parser fails', async () => {
    d.boundary.litert.scriptError('Failed to parse FC calls (Status Code: 3)');
    d.boundary.litert.scriptTurn({ content: 'recovered answer' });
    const before = sends();

    const { answer } = await runTurn({ messages: [msg({ role: 'user', content: 'hi' })], enabledToolIds: ['calculator'] });

    expect(sends()).toBe(before + 2);
    expect(liteRTToolNames(d, -2)).toEqual(['calculator']);
    expect(liteRTToolNames(d)).toEqual([]); // the retry is reset with no tools
    expect(answer).toBe('recovered answer');
  });

  it('raises any other native error without asking again', async () => {
    d.boundary.litert.scriptError('out of memory');
    const before = sends();

    await expect(runTurn({ messages: [msg({ role: 'user', content: 'hi' })], enabledToolIds: ['calculator'] }))
      .rejects.toThrow('out of memory');

    expect(sends()).toBe(before + 1);
  });
});

// ===========================================================================
// The date/time context
// ===========================================================================
describe('runToolLoop — date/time context (llama)', () => {
  beforeEach(async () => {
    d = await launchGeneration();
    d.boundary.llama!.scriptCompletion({ text: 'ok' });
  });
  const sentMessages = () => (d.boundary.llama!.calls.completion[0][0] as any).messages as Array<{ role: string; content: any }>;
  const text = (c: any) => (typeof c === 'string' ? c : (c as any[]).map(p => p.text ?? '').join(''));

  it('adds the exact local time to the latest question when a calendar tool is on, and keeps the date in the system prompt', async () => {
    await runTurn({
      // The calendar tools come from the Pro calendar extension; the id being on is what asks for the time.
      enabledToolIds: ['web_search', 'create_calendar_event'],
      messages: [msg({ role: 'system', content: 'You are helpful.' }), msg({ role: 'user', content: 'Schedule a sync' })],
    });

    const sent = sentMessages();
    // The stable date stays in the system prefix (cacheable turn to turn); the exact time goes on the
    // latest question, so the large system + tools prefix is not invalidated each turn (the TTFT fix).
    expect(text(sent.find(m => m.role === 'system')!.content)).toContain('The current date is');
    const user = text([...sent].reverse().find(m => m.role === 'user')!.content);
    expect(user).toContain('Current local date and time');
    expect(user).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(user).toContain('in half an hour');
  });

  it('keeps the date-only context when no time-sensitive tool is on', async () => {
    await runTurn({
      enabledToolIds: ['web_search'],
      messages: [msg({ role: 'system', content: 'You are helpful.' }), msg({ role: 'user', content: 'hi' })],
    });

    const sys = text(sentMessages().find(m => m.role === 'system')!.content);
    expect(sys).toContain('current date is');
    expect(sys).not.toContain('current date and time is');
  });
});

describe('runToolLoop — a llama model without native tool calling', () => {
  it('on an iPhone, puts the tool extension hints in the system prompt for the model to follow as text', async () => {
    d = await launchGeneration({ load: false, ram: { platform: 'ios', totalBytes: 8 * 1024 ** 3, availBytes: 4 * 1024 ** 3 } });
    // This model's chat template has no tool use (llama.rn reports no Jinja tool caps).
    const initLlama = d.boundary.llama!.module.initLlama;
    const open = initLlama.getMockImplementation()!;
    initLlama.mockImplementation(async (params: unknown) => {
      const ctx = await open(params);
      ctx.model = { ...ctx.model, chatTemplates: { jinja: { defaultCaps: { toolCalls: false }, toolUse: false, toolUseCaps: { toolCalls: false } } } };
      return ctx;
    });
    await d.activeModelService.loadTextModel('m');
    expect(d.llmService.supportsToolCalling()).toBe(false);
    const { registerToolExtension } = require('../../../src/services/tools/extensions');
    unregister = registerToolExtension({
      id: 'hinted', canHandle: () => false, execute: async () => ({}), enabledToolCount: () => 0,
      getSystemPromptHint: () => ' Call server tools as <mcp_tool_call>{json}</mcp_tool_call>.',
      parseToolCalls: () => [], stripFromVisibleText: (t: string) => t,
    });
    d.boundary.llama!.scriptCompletion({ text: 'ok' });

    await runTurn({ enabledToolIds: ['web_search'], messages: [msg({ role: 'system', content: 'You are helpful.' }), msg({ role: 'user', content: 'hi' })] });

    const sent = (d.boundary.llama!.calls.completion[0][0] as any).messages as Array<{ role: string; content: any }>;
    expect(String(sent.find(m => m.role === 'system')!.content)).toContain('<mcp_tool_call>');
  });
});

// ===========================================================================
// Tool routing on LiteRT
// ===========================================================================
describe('runToolLoop — tool routing (LiteRT)', () => {
  /** A connected server's tools, registered through the app's own extension registry. */
  function extensionTools(names: string[]) {
    const { registerToolExtension } = require('../../../src/services/tools/extensions');
    unregister = registerToolExtension({
      id: 'test-mcp',
      canHandle: (name: string) => names.includes(name),
      execute: async (call: any) => ({ toolCallId: call.id, name: call.name, content: 'ok', durationMs: 1 }),
      getSystemPromptHint: () => '',
      enabledToolCount: () => names.length,
      parseToolCalls: () => [],
      stripFromVisibleText: (t: string) => t,
      getOpenAISchemas: () => names.map(n => ({ type: 'function', function: { name: n, description: `${n} tool` } })),
    });
  }
  const ask = () => runTurn({ enabledToolIds: ['web_search', 'calculator'], messages: [msg({ role: 'user', content: 'do a thing' })] });

  beforeEach(async () => {
    d = await launchGeneration({ engine: 'litert' });
  });

  it('keeps the built-ins plus only the server tools the router picked', async () => {
    extensionTools(['mcp_a', 'mcp_b', 'mcp_c', 'mcp_d']);
    d.boundary.litert.scriptTurns([{ content: 'mcp_b' }, { content: 'answer' }]); // router pass, then the turn

    const { answer, routed } = await ask();

    expect(liteRTToolNames(d)).toEqual(expect.arrayContaining(['web_search', 'calculator', 'mcp_b']));
    expect(liteRTToolNames(d)).not.toContain('mcp_a');
    expect(routed.at(-1)).toEqual(expect.arrayContaining(['mcp_b']));
    expect(answer).toBe('answer');
  });

  it('keeps only the built-ins when the router says no tool is needed', async () => {
    extensionTools(['mcp_a', 'mcp_b', 'mcp_c', 'mcp_d']);
    d.boundary.litert.scriptTurns([{ content: 'none' }, { content: 'answer' }]);

    await ask();

    expect(liteRTToolNames(d)).toEqual(['web_search', 'calculator']);
  });

  it('keeps every tool when the router pass fails natively', async () => {
    extensionTools(['mcp_a', 'mcp_b', 'mcp_c', 'mcp_d']);
    d.boundary.litert.scriptError('router boom'); // the router pass fails
    d.boundary.litert.scriptTurn({ content: 'answer' });

    const { answer } = await ask();

    expect(liteRTToolNames(d)).toEqual(expect.arrayContaining(['web_search', 'calculator', 'mcp_a', 'mcp_b', 'mcp_c', 'mcp_d']));
    expect(answer).toBe('answer');
  });

  it('does not route when there are few tools: one native pass, every tool sent', async () => {
    extensionTools(['mcp_a']);
    d.boundary.litert.scriptTurn({ content: 'answer' });
    const before = d.boundary.litert.calls.sendMessage.length;

    await ask();

    expect(d.boundary.litert.calls.sendMessage.length).toBe(before + 1);
    expect(liteRTToolNames(d)).toEqual(expect.arrayContaining(['web_search', 'calculator', 'mcp_a']));
  });
});
