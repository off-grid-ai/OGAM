/**
 * OpenAI-compatible provider — a chat with a server on the network (LM Studio, llama.cpp server, Ollama,
 * a hosted API).
 *
 * Real: the provider, its message builder, the stream code, httpClient's SSE / NDJSON streaming requests and
 * parsers, the app store (settings). Faked (network / device): the server at the streaming XMLHttpRequest
 * (harness/chatStreamServer), and the image file on disk (react-native-fs).
 */
import RNFS from 'react-native-fs';
import { OpenAICompatibleProvider, createOpenAIProvider } from '../../../../src/services/providers/openAICompatibleProvider';
import { useAppStore } from '../../../../src/stores';
import { installChatStreamServer, type ChatStreamServer } from '../../../harness/chatStreamServer';
import type { Message } from '../../../../src/types';

let server: ChatStreamServer;
let provider: OpenAICompatibleProvider;

beforeEach(() => {
  server = installChatStreamServer();
  provider = new OpenAICompatibleProvider('test-server', { endpoint: 'http://192.168.1.50:1234', modelId: 'llama2' });
});

afterEach(() => server.restore());

const hi: Message[] = [{ id: '1', role: 'user', content: 'Hi', timestamp: 0 }];
const delta = (d: Record<string, unknown>, finish: string | null = null) => ({ choices: [{ index: 0, delta: d, finish_reason: finish }] });
const stop = delta({}, 'stop');

/** Run provider.generate and collect what it reports. */
async function generate(p: OpenAICompatibleProvider, messages: Message[] = hi, options: Record<string, unknown> = {}) {
  const seen = { tokens: [] as string[], reasoning: [] as string[], done: [] as any[], errors: [] as Error[] };
  await p.generate(messages, options as any, {
    onToken: t => seen.tokens.push(t),
    onReasoning: r => seen.reasoning.push(r),
    onComplete: r => seen.done.push(r),
    onError: e => seen.errors.push(e),
  });
  return seen;
}

describe('OpenAICompatibleProvider — setup', () => {
  it('has its id and type, also when made by the factory', () => {
    expect(provider.id).toBe('test-server');
    expect(provider.type).toBe('openai-compatible');
    const p = createOpenAIProvider('my-server', 'http://localhost:1234', { apiKey: 'my-key', modelId: 'model-id' });
    expect(p.id).toBe('my-server');
    expect(p.getLoadedModelId()).toBe('model-id');
  });

  it('starts with the default capabilities', () => {
    expect(provider.capabilities).toEqual(expect.objectContaining({
      supportsVision: false, supportsToolCalling: true, supportsThinking: false,
    }));
  });

  it('takes vision only from what discovery reported, never from the model name', async () => {
    for (const name of ['llava-v1.6-7b', 'gpt-4-vision-preview', 'claude-3-opus']) {
      await provider.loadModel(name);
      expect(provider.capabilities.supportsVision).toBe(false);
    }
    provider.updateCapabilities({ supportsVision: true });
    expect(provider.capabilities.supportsVision).toBe(true);
    provider.updateCapabilities({ supportsVision: false });
    expect(provider.capabilities.supportsVision).toBe(false);
  });

  it('merges capability updates without dropping the others', () => {
    provider.updateCapabilities({ supportsVision: true });
    provider.updateCapabilities({ supportsThinking: true });

    expect(provider.capabilities).toEqual(expect.objectContaining({
      supportsVision: true, supportsThinking: true, supportsToolCalling: true,
    }));
  });

  it('loads, reports and unloads the model it is pointed at', async () => {
    await provider.loadModel('mistral-7b');
    expect(provider.getLoadedModelId()).toBe('mistral-7b');
    expect(provider.isModelLoaded()).toBe(true);
    expect(await provider.isReady()).toBe(true);

    await provider.unloadModel();

    expect(provider.getLoadedModelId()).toBeNull();
    expect(provider.isModelLoaded()).toBe(false);
  });

  it('is not ready with no model or no endpoint', async () => {
    const empty = new OpenAICompatibleProvider('empty', { endpoint: 'http://test:11434', modelId: '' });
    expect(empty.isModelLoaded()).toBe(false);
    expect(await empty.isReady()).toBe(false);
    const noEndpoint = new OpenAICompatibleProvider('no-ep', { endpoint: '', modelId: 'test-model' });
    expect(await noEndpoint.isReady()).toBe(false);
  });

  it('estimates four characters a token', async () => {
    expect(await provider.getTokenCount('Hello world this is a test')).toBe(Math.ceil(26 / 4));
  });

  it('a config change points the next request at the new endpoint and model', async () => {
    provider.updateConfig({ endpoint: 'http://new-endpoint:8080', modelId: 'new-model' });
    expect(provider.getLoadedModelId()).toBe('new-model');
    server.reply({ sse: [stop] });

    await generate(provider);

    expect(server.requests[0].url).toBe('http://new-endpoint:8080/v1/chat/completions');
    expect(server.requests[0].body.model).toBe('new-model');
  });

  it('dispose forgets the model', async () => {
    await provider.loadModel('test-model');

    await provider.dispose();

    expect(provider.isModelLoaded()).toBe(false);
  });
});

describe('OpenAICompatibleProvider — generate', () => {
  it('reports "No model selected" and sends nothing without a model', async () => {
    const empty = new OpenAICompatibleProvider('empty', { endpoint: 'http://test:1234', modelId: '' });

    const seen = await generate(empty);

    expect(seen.errors.map(e => e.message)).toEqual(['No model selected']);
    expect(server.requests).toHaveLength(0);
  });

  it('streams the reply from /v1/chat/completions and completes with it', async () => {
    await provider.loadModel('test-model');
    server.reply({ sse: [delta({ content: 'Hello' }), delta({ content: ' world' }), stop, '[DONE]'] });

    const seen = await generate(provider, hi, { temperature: 0.5 });

    expect(server.requests[0].url).toBe('http://192.168.1.50:1234/v1/chat/completions');
    expect(server.requests[0].body).toEqual(expect.objectContaining({ model: 'test-model', stream: true, temperature: 0.5 }));
    expect(server.requests[0].headers).toEqual(expect.objectContaining({ 'Content-Type': 'application/json', Accept: 'text/event-stream' }));
    expect(seen.tokens).toEqual(['Hello', ' world']);
    expect(seen.done).toHaveLength(1); // once, though [DONE] follows the stop
    expect(seen.done[0]).toEqual(expect.objectContaining({ content: 'Hello world', meta: { gpu: false, gpuBackend: 'Remote' } }));
    expect(seen.errors).toEqual([]);
  });

  it('completes once when the server sends the stop twice', async () => {
    await provider.loadModel('test-model');
    server.reply({ sse: [delta({ content: 'Hello' }), stop, stop] });

    const seen = await generate(provider);

    expect(seen.done.map(r => r.content)).toEqual(['Hello']);
  });

  it('sends the API key as a bearer token', async () => {
    const secure = new OpenAICompatibleProvider('secure', { endpoint: 'https://api.example.com', apiKey: 'secret-key', modelId: 'test-model' });
    server.reply({ sse: [stop] });

    await generate(secure);

    expect(server.requests[0].headers.Authorization).toBe('Bearer secret-key');
  });

  it('completes with the tool call the server streamed in pieces', async () => {
    await provider.loadModel('test-model');
    server.reply({ sse: [
      delta({ tool_calls: [{ index: 0, id: 'call_123', type: 'function', function: { name: 'web_search', arguments: '' } }] }),
      delta({ tool_calls: [{ index: 0, function: { arguments: '{"query":"test"}' } }] }),
      delta({}, 'tool_calls'),
    ] });
    const tools = [{ type: 'function', function: { name: 'web_search', description: 'Search', parameters: {} } }];

    const seen = await generate(provider, [{ id: '1', role: 'user', content: 'Search for test', timestamp: 0 }], { tools });

    expect(server.requests[0].body.tools).toEqual(tools);
    expect(server.requests[0].body.tool_choice).toBe('auto');
    expect(seen.done[0].toolCalls).toEqual([{ id: 'call_123', name: 'web_search', arguments: '{"query":"test"}' }]);
  });

  it('streams reasoning_content to onReasoning and keeps it beside the answer', async () => {
    await provider.loadModel('test-model');
    server.reply({ sse: [delta({ reasoning_content: 'thinking step' }), delta({ content: 'answer' }, 'stop')] });

    const seen = await generate(provider);

    expect(seen.reasoning.join('')).toBe('thinking step');
    expect(seen.done[0]).toEqual(expect.objectContaining({ content: 'answer', reasoningContent: 'thinking step' }));
  });

  it('works without an onReasoning callback', async () => {
    await provider.loadModel('test-model');
    server.reply({ sse: [delta({ reasoning_content: 'thinking...' }), delta({ content: 'done' }, 'stop')] });
    const done: any[] = [];

    await provider.generate(hi, {}, { onToken: () => {}, onComplete: r => done.push(r), onError: () => {} });

    expect(done.map(r => r.content)).toEqual(['done']);
  });

  it('completes with what streamed when the stream ends without a finish reason', async () => {
    await provider.loadModel('test-model');
    server.reply({ sse: [delta({ content: 'partial' })] });

    const seen = await generate(provider);

    expect(seen.done.map(r => r.content)).toEqual(['partial']);
  });

  it('keeps the tool calls when the stream ends without a finish reason', async () => {
    await provider.loadModel('test-model');
    server.reply({ sse: [delta({ tool_calls: [{ index: 0, id: 'tc-1', type: 'function', function: { name: 'web_search', arguments: '{"q":"test"}' } }] })] });

    const seen = await generate(provider);

    expect(seen.done[0].toolCalls).toEqual([expect.objectContaining({ name: 'web_search' })]);
  });

  it('reports an error the server sends in the stream, and does not complete', async () => {
    await provider.loadModel('test-model');
    server.reply({ sse: [{ error: { message: 'rate limit exceeded' } }, delta({ content: 'ignored' })] });

    const seen = await generate(provider);

    expect(seen.errors.map(e => e.message)).toEqual(['rate limit exceeded']);
    expect(seen.tokens).toEqual([]);
    expect(seen.done).toEqual([]);
  });

  it('reports a dropped connection as an error', async () => {
    await provider.loadModel('test-model');
    server.reply({ networkError: true });

    const seen = await generate(provider);

    expect(seen.errors.map(e => e.message)).toEqual(['Network error']);
    expect(seen.done).toEqual([]);
  });

  it('reports an HTTP error status as an error', async () => {
    await provider.loadModel('test-model');
    server.reply({ status: 401, body: JSON.stringify({ error: { message: 'bad key' } }) });

    const seen = await generate(provider);

    expect(seen.errors).toHaveLength(1);
    expect(seen.done).toEqual([]);
  });

  it('a stop mid-reply aborts the request, keeps what streamed and drops the rest', async () => {
    await provider.loadModel('test-model');
    server.reply({ sse: [delta({ content: 'Hello' }), delta({ content: ' late' }), stop], hold: true });
    const seen = { tokens: [] as string[], done: [] as any[], errors: [] as Error[] };
    const running = provider.generate(hi, {}, {
      onToken: t => seen.tokens.push(t), onComplete: r => seen.done.push(r), onError: e => seen.errors.push(e),
    });
    const deadline = Date.now() + 3000;
    while (seen.tokens.length === 0) {
      if (Date.now() > deadline) throw new Error('the reply never streamed');
      await new Promise(r => setTimeout(r, 5));
    }

    await provider.stopGeneration();
    server.release();
    await running;

    expect(server.aborted).toBe(1);
    expect(seen.tokens).toEqual(['Hello']);
    expect(seen.done.map(r => r.content)).toEqual(['Hello']);
    expect(seen.errors).toEqual([]);
    await expect(provider.stopGeneration()).resolves.toBeUndefined(); // nothing running: a no-op
  });

  it('a stop after the reply finished aborts nothing', async () => {
    await provider.loadModel('test-model');
    server.reply({ sse: [delta({ content: 'Hi' }, 'stop')] });
    const seen = await generate(provider);

    await provider.stopGeneration();

    expect(seen.done.map(r => r.content)).toEqual(['Hi']);
    expect(server.aborted).toBe(0);
  });
});

describe('OpenAICompatibleProvider — the thinking switch (enable_thinking)', () => {
  // The gate is a capability discovery found (acceptsThinkingKwarg), not the port.
  async function bodyFor(opts: { acceptsThinkingKwarg?: boolean; enableThinking?: boolean }) {
    const p = new OpenAICompatibleProvider('s', { endpoint: 'https://example.com:9999', modelId: 'qwen3' });
    if (opts.acceptsThinkingKwarg !== undefined) p.updateCapabilities({ acceptsThinkingKwarg: opts.acceptsThinkingKwarg });
    server.reply({ sse: [stop] });
    await generate(p, hi, { enableThinking: opts.enableThinking });
    return server.requests.at(-1)!.body;
  }

  it('sends enable_thinking true when the server takes the switch', async () => {
    expect((await bodyFor({ acceptsThinkingKwarg: true, enableThinking: true })).chat_template_kwargs).toEqual({ enable_thinking: true });
  });

  it('sends enable_thinking false when thinking is off', async () => {
    expect((await bodyFor({ acceptsThinkingKwarg: true, enableThinking: false })).chat_template_kwargs).toEqual({ enable_thinking: false });
  });

  it('leaves the switch out for a server that did not report taking it, on any port', async () => {
    expect((await bodyFor({ acceptsThinkingKwarg: false, enableThinking: true })).chat_template_kwargs).toBeUndefined();
    expect((await bodyFor({ enableThinking: true })).chat_template_kwargs).toBeUndefined();
  });

  it('sends an Ollama server (port 11434) to its native /api/chat with think, never the OpenAI switch', async () => {
    const p = new OpenAICompatibleProvider('s', { endpoint: 'http://192.168.1.50:11434', modelId: 'qwen3' });
    p.updateCapabilities({ acceptsThinkingKwarg: true });
    server.reply({ ndjson: [{ message: { content: 'ok' }, done: true }] });

    const seen = await generate(p, hi, { enableThinking: true });

    expect(server.requests[0].url).toBe('http://192.168.1.50:11434/api/chat');
    expect(server.requests[0].body.think).toBe(true);
    expect(server.requests[0].body.chat_template_kwargs).toBeUndefined();
    expect(seen.done.map(r => r.content)).toEqual(['ok']);
  });
});

describe('OpenAICompatibleProvider — the messages sent', () => {
  beforeEach(async () => {
    await provider.loadModel('test-model');
    server.reply({ sse: [stop] });
  });
  const sent = () => server.requests[0].body.messages as any[];

  it('puts the system prompt first', async () => {
    await generate(provider, [{ id: '1', role: 'user', content: 'Hello', timestamp: 0 }], { systemPrompt: 'You are helpful' });

    expect(sent()[0]).toEqual({ role: 'system', content: [{ type: 'text', text: 'You are helpful' }] });
  });

  it('uses the system prompt from settings when the request has none', async () => {
    useAppStore.getState().updateSettings({ systemPrompt: 'From settings' });

    await generate(provider);

    expect(sent()[0]).toEqual({ role: 'system', content: [{ type: 'text', text: 'From settings' }] });
  });

  it('keeps a system message the chat already has, without a second one', async () => {
    await generate(provider, [
      { id: 's', role: 'system', content: 'Custom system', timestamp: 0 },
      { id: '1', role: 'user', content: 'Hello', timestamp: 0 },
    ], { systemPrompt: 'Another prompt' });

    const systems = sent().filter(m => m.role === 'system');
    expect(systems).toEqual([{ role: 'system', content: [{ type: 'text', text: 'Custom system' }] }]);
  });

  it('sends a tool result with its call id', async () => {
    await generate(provider, [
      { id: '1', role: 'user', content: 'search', timestamp: 0 },
      { id: '2', role: 'tool', content: 'result data', toolCallId: 'call_abc', timestamp: 0 } as any,
    ]);

    expect(sent().find(m => m.role === 'tool')).toEqual(expect.objectContaining({
      content: [{ type: 'text', text: 'result data' }], tool_call_id: 'call_abc',
    }));
  });

  it('sends an earlier assistant turn with its tool calls', async () => {
    await generate(provider, [
      { id: '1', role: 'user', content: 'run tool', timestamp: 0 },
      { id: '2', role: 'assistant', content: '', timestamp: 0, toolCalls: [{ id: 'call_1', name: 'web_search', arguments: '{"query":"test"}' }] } as any,
    ]);

    const assistant = sent().find(m => m.role === 'assistant' && m.tool_calls);
    expect(assistant.tool_calls[0].function).toEqual({ name: 'web_search', arguments: '{"query":"test"}' });
  });
});

describe('OpenAICompatibleProvider — images', () => {
  const photo = (uri: string): Message[] => [{
    id: '1', role: 'user', content: 'What is in this image?', timestamp: 0,
    attachments: [{ id: 'a', type: 'image', uri }],
  } as any];
  /** The picture is on disk: react-native-fs finds it and reads it as base64. */
  const onDisk = (base64: string) => {
    (RNFS.exists as jest.Mock).mockResolvedValue(true);
    (RNFS.readFile as jest.Mock).mockResolvedValue(base64);
  };
  afterEach(() => {
    (RNFS.exists as jest.Mock).mockResolvedValue(false);
  });

  it('sends the picture as an image_url data URL to a server with vision', async () => {
    onDisk('abc123');
    await provider.loadModel('llava-v1.6-7b');
    provider.updateCapabilities({ supportsVision: true });
    server.reply({ sse: [delta({ content: 'I see an image' }, 'stop')] });

    await generate(provider, photo('file:///path/to/img.png'));

    const user = (server.requests[0].body.messages as any[]).find(m => m.role === 'user');
    expect(user.content).toEqual(expect.arrayContaining([
      { type: 'image_url', image_url: { url: 'data:image/png;base64,abc123' } },
    ]));
  });

  it('sends an Ollama server the raw base64 in the message images list', async () => {
    onDisk('abc123rawbase64');
    const ollama = new OpenAICompatibleProvider('ollama-server', { endpoint: 'http://192.168.1.10:11434', modelId: 'llava-v1.6' });
    ollama.updateCapabilities({ supportsVision: true });
    server.reply({ ndjson: [{ message: { content: 'I see it.' }, done: true }] });

    await generate(ollama, photo('file:///path/to/photo.png'));

    const user = (server.requests[0].body.messages as any[]).find(m => m.role === 'user');
    expect(user.images).toEqual(['abc123rawbase64']);
  });

  it('sends an Ollama message with no picture without an images list', async () => {
    const ollama = new OpenAICompatibleProvider('ollama-server', { endpoint: 'http://192.168.1.10:11434', modelId: 'llava-v1.6' });
    server.reply({ ndjson: [{ message: { content: 'Hello.' }, done: true }] });

    await generate(ollama, [{ id: '1', role: 'user', content: 'Hello', timestamp: 0 }]);

    const user = (server.requests[0].body.messages as any[]).find(m => m.role === 'user');
    expect(user).toEqual(expect.objectContaining({ content: 'Hello' }));
    expect(user.images).toBeUndefined();
  });
});
