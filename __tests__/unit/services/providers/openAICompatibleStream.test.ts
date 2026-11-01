/**
 * openAICompatibleStream — the reasoning/answer split of a streamed reply (ThinkTagParser, processDelta) and
 * Ollama's native chat stream (generateOllamaChatImpl).
 *
 * Real: the stream code, httpClient's NDJSON streaming request and parser, the logger. Faked (network,
 * harness/chatStreamServer): Ollama's /api/chat at the streaming XMLHttpRequest.
 */
import { ThinkTagParser, processDelta, generateOllamaChatImpl } from '../../../../src/services/providers/openAICompatibleStream';
import { installChatStreamServer, type ChatStreamServer } from '../../../harness/chatStreamServer';
import type { OpenAIStreamState } from '../../../../src/services/providers/openAICompatibleTypes';

function makeState(overrides: Partial<OpenAIStreamState> = {}): OpenAIStreamState {
  return {
    fullContent: '',
    fullReasoningContent: '',
    toolCalls: [],
    currentToolCall: null,
    completeCalled: false,
    streamErrorOccurred: false,
    ...overrides,
  };
}

function makeCtx(thinkingEnabled = true) {
  const onToken = jest.fn();
  const onReasoning = jest.fn();
  const callbacks = { onToken, onReasoning, onError: jest.fn(), onComplete: jest.fn() };
  const thinkTagParser = new ThinkTagParser();
  return { thinkingEnabled, callbacks, thinkTagParser, onToken, onReasoning };
}

// ---------------------------------------------------------------------------
// ThinkTagParser
// ---------------------------------------------------------------------------

describe('ThinkTagParser', () => {
  it('routes plain text to onToken', () => {
    const parser = new ThinkTagParser();
    const onToken = jest.fn();
    const onReasoning = jest.fn();
    parser.process('hello world', onToken, onReasoning);
    expect(onToken).toHaveBeenCalledWith('hello world');
    expect(onReasoning).not.toHaveBeenCalled();
  });

  it('routes <think>...</think> content to onReasoning', () => {
    const parser = new ThinkTagParser();
    const onToken = jest.fn();
    const onReasoning = jest.fn();
    parser.process('<think>reasoning here</think>', onToken, onReasoning);
    expect(onReasoning).toHaveBeenCalledWith('reasoning here');
    expect(onToken).not.toHaveBeenCalled();
  });

  it('splits content before and after think block', () => {
    const parser = new ThinkTagParser();
    const tokens: string[] = [];
    const reasoning: string[] = [];
    parser.process('before<think>inside</think>after', t => tokens.push(t), r => reasoning.push(r));
    expect(tokens.join('')).toBe('beforeafter');
    expect(reasoning.join('')).toBe('inside');
  });

  it('handles think tag split across two chunks', () => {
    const parser = new ThinkTagParser();
    const tokens: string[] = [];
    const reasoning: string[] = [];
    const cb = (t: string) => tokens.push(t);
    const rc = (r: string) => reasoning.push(r);
    // First chunk ends mid-tag
    parser.process('hi<thi', cb, rc);
    parser.process('nk>thought</think>done', cb, rc);
    expect(tokens.join('')).toBe('hidone');
    expect(reasoning.join('')).toBe('thought');
  });

  it('handles close tag split across two chunks', () => {
    const parser = new ThinkTagParser();
    const tokens: string[] = [];
    const reasoning: string[] = [];
    parser.process('<think>partial</thi', t => tokens.push(t), r => reasoning.push(r));
    parser.process('nk>rest', t => tokens.push(t), r => reasoning.push(r));
    // reasoning gets 'partial', 'rest' goes to onToken after close tag
    expect(reasoning.join('')).toBe('partial');
    expect(tokens.join('')).toBe('rest');
  });

  it('emits text before think tag via onToken', () => {
    const parser = new ThinkTagParser();
    const onToken = jest.fn();
    parser.process('prefix<think>x</think>', onToken, jest.fn());
    expect(onToken).toHaveBeenCalledWith('prefix');
  });

  // DR1: remote providers can stream Gemma/Qwen channel reasoning as delta.content.
  // The streaming parser must recognise ALL reasoning formats (the shared grammar),
  // not just <think>, or the reasoning leaks into the visible answer.
  it('routes Gemma 4 channel thought to onReasoning (not the visible answer)', () => {
    const parser = new ThinkTagParser();
    const tokens: string[] = [];
    const reasoning: string[] = [];
    parser.process('<|channel>thought\nweighing options<channel|>Here is the answer.', t => tokens.push(t), r => reasoning.push(r));
    expect(reasoning.join('')).toBe('weighing options');
    expect(tokens.join('')).toBe('Here is the answer.');
  });

  it('routes Qwen analysis/final channel to onReasoning (not the visible answer)', () => {
    const parser = new ThinkTagParser();
    const tokens: string[] = [];
    const reasoning: string[] = [];
    parser.process('<|channel|>analysis<|message|>step by step<|channel|>final<|message|>Final answer.', t => tokens.push(t), r => reasoning.push(r));
    expect(reasoning.join('')).toBe('step by step');
    expect(tokens.join('')).toBe('Final answer.');
  });

  it('handles a Gemma channel open split across two chunks', () => {
    const parser = new ThinkTagParser();
    const tokens: string[] = [];
    const reasoning: string[] = [];
    const cb = (t: string) => tokens.push(t);
    const rc = (r: string) => reasoning.push(r);
    parser.process('hi<|chan', cb, rc);
    parser.process('nel>thought\ndeep<channel|>done', cb, rc);
    expect(tokens.join('')).toBe('hidone');
    expect(reasoning.join('')).toBe('deep');
  });
});

// ---------------------------------------------------------------------------
// processDelta
// ---------------------------------------------------------------------------

describe('processDelta', () => {
  it('calls onToken for delta.content (no think tags)', () => {
    const state = makeState();
    const { thinkTagParser, callbacks, onToken } = makeCtx();
    processDelta({ content: 'hello' }, state, { thinkingEnabled: true, callbacks, thinkTagParser });
    expect(onToken).toHaveBeenCalledWith('hello');
    expect(state.fullContent).toBe('hello');
  });

  it('STILL surfaces the DEDICATED reasoning_content field when thinkingEnabled=false (B16/B17)', () => {
    // A provider's structured `reasoning_content` field is real reasoning output and is always
    // surfaced — remote models have no local thinking toggle (B17), so suppressing it hid
    // legitimate reasoning. Only INLINE <think> tags respect the local toggle (see the
    // "suppresses think-tag reasoning when thinkingEnabled=false" case below).
    const state = makeState();
    const { thinkTagParser, callbacks, onReasoning } = makeCtx(false);
    processDelta({ reasoning_content: 'private thought' }, state, { thinkingEnabled: false, callbacks, thinkTagParser });
    expect(onReasoning).toHaveBeenCalledWith('private thought');
    expect(state.fullReasoningContent).toBe('private thought');
  });

  it('calls onReasoning for reasoning_content when thinkingEnabled=true', () => {
    const state = makeState();
    const { thinkTagParser, callbacks, onReasoning } = makeCtx(true);
    processDelta({ reasoning_content: 'thought' }, state, { thinkingEnabled: true, callbacks, thinkTagParser });
    expect(onReasoning).toHaveBeenCalledWith('thought');
    expect(state.fullReasoningContent).toBe('thought');
  });

  it('falls back to delta.reasoning field', () => {
    const state = makeState();
    const { thinkTagParser, callbacks, onReasoning } = makeCtx(true);
    processDelta({ reasoning: 'ollama thought' }, state, { thinkingEnabled: true, callbacks, thinkTagParser });
    expect(onReasoning).toHaveBeenCalledWith('ollama thought');
  });

  it('falls back to delta.thinking field', () => {
    const state = makeState();
    const { thinkTagParser, callbacks, onReasoning } = makeCtx(true);
    processDelta({ thinking: 'anthropic thought' }, state, { thinkingEnabled: true, callbacks, thinkTagParser });
    expect(onReasoning).toHaveBeenCalledWith('anthropic thought');
  });

  it('accumulates tool_calls with id', () => {
    const state = makeState();
    const { thinkTagParser, callbacks } = makeCtx();
    processDelta({
      tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'get_weather', arguments: '{"city"' } }],
    }, state, { thinkingEnabled: true, callbacks, thinkTagParser });
    expect(state.toolCalls).toHaveLength(1);
    expect(state.toolCalls[0].id).toBe('call-1');
    expect(state.toolCalls[0].function.name).toBe('get_weather');
  });

  it('appends arguments to existing tool call (no new id)', () => {
    const state = makeState();
    state.toolCalls = [{ id: 'call-1', type: 'function', function: { name: 'get_weather', arguments: '{"city"' } }];
    state.currentToolCall = state.toolCalls[0];
    const { thinkTagParser, callbacks } = makeCtx();
    processDelta({
      tool_calls: [{ function: { arguments: ':"NY"}' } }],
    }, state, { thinkingEnabled: true, callbacks, thinkTagParser });
    expect(state.currentToolCall?.function?.arguments).toBe('{"city":"NY"}');
  });

  it('suppresses think-tag reasoning when thinkingEnabled=false', () => {
    const state = makeState();
    const { thinkTagParser, callbacks, onReasoning, onToken } = makeCtx(false);
    processDelta({ content: '<think>hidden</think>visible' }, state, { thinkingEnabled: false, callbacks, thinkTagParser });
    // reasoning suppressed, visible text goes to onToken
    expect(onReasoning).not.toHaveBeenCalled();
    expect(onToken).toHaveBeenCalledWith('visible');
  });

  it('ignores delta with no content, no reasoning, no tool_calls', () => {
    const state = makeState();
    const { thinkTagParser, callbacks, onToken, onReasoning } = makeCtx();
    processDelta({}, state, { thinkingEnabled: true, callbacks, thinkTagParser });
    expect(onToken).not.toHaveBeenCalled();
    expect(onReasoning).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// generateOllamaChatImpl — Ollama's native /api/chat
// ---------------------------------------------------------------------------

describe('generateOllamaChatImpl', () => {
  let server: ChatStreamServer;
  beforeEach(() => { server = installChatStreamServer(); });
  afterEach(() => server.restore());

  /** One chat request to the Ollama server, with what the provider reports collected. */
  function ollamaRequest(options: Record<string, unknown> = { enableThinking: true }, opts: { endpoint?: string } = {}) {
    const controller = new AbortController();
    const seen = { tokens: [] as string[], reasoning: [] as string[], done: [] as any[], errors: [] as Error[] };
    const req = {
      options,
      callbacks: {
        onToken: (t: string) => seen.tokens.push(t),
        onReasoning: (r: string) => seen.reasoning.push(r),
        onComplete: (r: any) => seen.done.push(r),
        onError: (e: Error) => seen.errors.push(e),
      },
      signal: controller.signal,
      endpoint: opts.endpoint ?? 'http://localhost:11434',
      modelId: 'llama3',
      abort: () => controller.abort(),
    };
    return { req, seen, controller };
  }

  it('posts the chat to /api/chat, streams the answer and completes with it at done', async () => {
    server.reply({ ndjson: [
      { message: { role: 'assistant', content: 'hel' }, done: false },
      { message: { role: 'assistant', content: 'lo' }, done: false },
      { message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop' },
    ] });
    const { req, seen } = ollamaRequest({ enableThinking: true, temperature: 0.4, topP: 0.8 }, { endpoint: 'http://localhost:11434//' });

    await generateOllamaChatImpl([{ role: 'user', content: 'hi' }] as any, req as any);

    expect(server.requests).toHaveLength(1);
    expect(server.requests[0].url).toBe('http://localhost:11434/api/chat');
    expect(server.requests[0].body).toEqual(expect.objectContaining({
      model: 'llama3', stream: true, think: true,
      messages: [{ role: 'user', content: 'hi' }],
      options: { temperature: 0.4, top_p: 0.8 },
    }));
    expect(seen.tokens.join('')).toBe('hello');
    expect(seen.done).toHaveLength(1);
    expect(seen.done[0].content).toBe('hello');
    expect(seen.errors).toEqual([]);
  });

  it('reports an error line from Ollama and stops the request', async () => {
    server.reply({ ndjson: [{ error: 'model not found' }] });
    const { req, seen, controller } = ollamaRequest();

    await generateOllamaChatImpl([], req as any);

    expect(seen.errors.map(e => e.message)).toEqual([expect.stringContaining('model not found')]);
    expect(controller.signal.aborted).toBe(true);
    expect(seen.done).toEqual([]);
  });

  it('sends nothing for a chat stopped before it was sent, and completes it empty', async () => {
    const { req, seen, controller } = ollamaRequest();
    controller.abort();

    await generateOllamaChatImpl([{ role: 'user', content: 'hi' }] as any, req as any);

    expect(server.requests).toHaveLength(0);
    expect(seen.done.map(r => r.content)).toEqual(['']);
    expect(seen.errors).toEqual([]);
  });

  it('reports a dropped connection as an error', async () => {
    server.reply({ networkError: true });
    const { req, seen } = ollamaRequest();

    await generateOllamaChatImpl([], req as any);

    expect(seen.errors.map(e => e.message)).toEqual(['Network error']);
    expect(seen.done).toEqual([]);
  });

  it('reports an HTTP error status as an error', async () => {
    server.reply({ status: 500, body: JSON.stringify({ error: 'boom' }) });
    const { req, seen } = ollamaRequest();

    await generateOllamaChatImpl([], req as any);

    expect(seen.errors).toHaveLength(1);
    expect(seen.done).toEqual([]);
  });

  it('completes with what streamed when the stream ends without a done line', async () => {
    server.reply({ ndjson: [{ message: { content: 'partial' }, done: false }] });
    const { req, seen } = ollamaRequest();

    await generateOllamaChatImpl([], req as any);

    expect(seen.done.map(r => r.content)).toEqual(['partial']);
  });

  it('completes with the tool calls Ollama streamed', async () => {
    server.reply({ ndjson: [
      { message: { tool_calls: [{ function: { name: 'search', arguments: { query: 'test' } } }] }, done: false },
      { done: true },
    ] });
    const { req, seen } = ollamaRequest({ enableThinking: true, tools: [{ type: 'function', function: { name: 'search' } }] });

    await generateOllamaChatImpl([], req as any);

    expect(server.requests[0].body.tools).toEqual([{ type: 'function', function: { name: 'search' } }]);
    expect(seen.done[0].toolCalls).toHaveLength(1);
    expect(seen.done[0].toolCalls[0].name).toBe('search');
    expect(JSON.parse(seen.done[0].toolCalls[0].arguments)).toEqual({ query: 'test' });
  });

  it('sends images as raw base64 in the message images list', async () => {
    const { req } = ollamaRequest();

    await generateOllamaChatImpl([{
      role: 'user',
      content: [
        { type: 'text', text: 'describe this' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,abc123' } },
      ],
    }] as any, req as any);

    expect(server.requests[0].body.messages).toEqual([{ role: 'user', content: 'describe this', images: ['abc123'] }]);
  });

  it('sends earlier tool-call arguments as objects, the way Ollama reads them', async () => {
    const { req } = ollamaRequest();

    await generateOllamaChatImpl([
      { role: 'assistant', content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'fn', arguments: '{"k":"v"}' } }] },
      { role: 'tool', content: 'result', tool_call_id: 'c1' },
    ] as any, req as any);

    const [assistant, tool] = server.requests[0].body.messages;
    expect(assistant.tool_calls[0].function.arguments).toEqual({ k: 'v' });
    expect(tool).toEqual({ role: 'tool', content: 'result', tool_call_id: 'c1' });
  });

  it('streams Ollama thinking to onReasoning and keeps it beside the answer', async () => {
    server.reply({ ndjson: [
      { message: { thinking: 'internal thought', content: '' }, done: false },
      { message: { content: 'answer' }, done: false },
      { done: true },
    ] });
    const { req, seen } = ollamaRequest();

    await generateOllamaChatImpl([], req as any);

    expect(seen.reasoning.join('')).toBe('internal thought');
    expect(seen.done[0].content).toBe('answer');
  });

  it('asks a levels-only model for a thinking level from the reasoning budget', async () => {
    const levels: Array<[number | undefined, string]> = [[undefined, 'medium'], [512, 'low'], [2048, 'medium'], [8192, 'high']];
    for (const [budget] of levels) {
      const { req } = ollamaRequest({ enableThinking: true, reasoningBudget: budget });
      await generateOllamaChatImpl([], { ...req, thinkingLevelsOnly: true } as any);
    }

    expect(server.requests.map(r => r.body.think)).toEqual(levels.map(([, level]) => level));
  });
});
