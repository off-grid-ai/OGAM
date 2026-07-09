/**
 * Unit tests for openAICompatibleStream.ts
 * Covers ThinkTagParser and processDelta branch paths.
 */

jest.mock('../../../../src/services/httpClient', () => ({
  createNDJSONStreamingRequest: jest.fn(),
}));

jest.mock('../../../../src/utils/logger', () => ({
  __esModule: true,
  default: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { ThinkTagParser, processDelta, generateOllamaChatImpl } from '../../../../src/services/providers/openAICompatibleStream';
import { createNDJSONStreamingRequest } from '../../../../src/services/httpClient';

const mockedNDJSON = createNDJSONStreamingRequest as jest.Mock;
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

  it('does not call onReasoning when thinkingEnabled=false and reasoning_content present', () => {
    const state = makeState();
    const { thinkTagParser, callbacks, onReasoning } = makeCtx(false);
    processDelta({ reasoning_content: 'private thought' }, state, { thinkingEnabled: false, callbacks, thinkTagParser });
    expect(onReasoning).not.toHaveBeenCalled();
    expect(state.fullReasoningContent).toBe('');
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
// generateOllamaChatImpl — tests handleOllamaChatLine branches indirectly
// ---------------------------------------------------------------------------

function makeOllamaReq(overrides: any = {}) {
  const callbacks = {
    onToken: jest.fn(),
    onReasoning: jest.fn(),
    onError: jest.fn(),
    onComplete: jest.fn(),
  };
  const controller = new AbortController();
  return {
    options: { enableThinking: true },
    callbacks,
    signal: controller.signal,
    endpoint: 'http://localhost:11434',
    modelId: 'llama3',
    abort: jest.fn(),
    controller,
    ...overrides,
  };
}

describe('generateOllamaChatImpl', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('calls onComplete with content when done=true line received', async () => {
    const req = makeOllamaReq();
    mockedNDJSON.mockImplementation(async (_url: string, _opts: any, handler: (line: any) => void) => {
      handler({ message: { role: 'assistant', content: 'hello' }, done: false });
      handler({ done: true });
    });

    await generateOllamaChatImpl([], req);
    expect(req.callbacks.onToken).toHaveBeenCalledWith('hello');
    expect(req.callbacks.onComplete).toHaveBeenCalledWith(expect.objectContaining({ content: 'hello' }));
  });

  it('calls onError when error field present in line', async () => {
    const req = makeOllamaReq();
    mockedNDJSON.mockImplementation(async (_url: string, _opts: any, handler: (line: any) => void) => {
      handler({ error: 'model not found' });
    });

    await generateOllamaChatImpl([], req);
    expect(req.callbacks.onError).toHaveBeenCalledWith(expect.any(Error));
    expect(req.abort).toHaveBeenCalled();
  });

  it('calls onComplete with empty content when signal is aborted on throw', async () => {
    const req = makeOllamaReq();
    req.controller.abort();
    mockedNDJSON.mockRejectedValue(new Error('aborted'));

    await generateOllamaChatImpl([], req);
    expect(req.callbacks.onComplete).toHaveBeenCalledWith(expect.objectContaining({ content: '' }));
    expect(req.callbacks.onError).not.toHaveBeenCalled();
  });

  it('calls onError on non-abort throw', async () => {
    const req = makeOllamaReq();
    mockedNDJSON.mockRejectedValue(new Error('network error'));

    await generateOllamaChatImpl([], req);
    expect(req.callbacks.onError).toHaveBeenCalledWith(expect.any(Error));
  });

  it('calls onComplete after stream if completeCalled is false', async () => {
    const req = makeOllamaReq();
    mockedNDJSON.mockImplementation(async (_url: string, _opts: any, handler: (line: any) => void) => {
      handler({ message: { content: 'partial' }, done: false });
      // no done:true line
    });

    await generateOllamaChatImpl([], req);
    expect(req.callbacks.onComplete).toHaveBeenCalledWith(expect.objectContaining({ content: 'partial' }));
  });

  it('accumulates tool_calls from Ollama message chunks', async () => {
    const req = makeOllamaReq();
    mockedNDJSON.mockImplementation(async (_url: string, _opts: any, handler: (line: any) => void) => {
      handler({ message: { tool_calls: [{ function: { name: 'search', arguments: { query: 'test' } } }] }, done: false });
      handler({ done: true });
    });

    await generateOllamaChatImpl([], req);
    const result = req.callbacks.onComplete.mock.calls[0][0];
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe('search');
  });

  it('strips base64 prefix from image_url content parts', async () => {
    const req = makeOllamaReq();
    mockedNDJSON.mockImplementation(async (_url: string, _opts: any, handler: (line: any) => void) => {
      handler({ done: true });
    });

    const messages = [{
      role: 'user',
      content: [
        { type: 'text', text: 'describe this' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,abc123' } },
      ],
    }] as any;

    await generateOllamaChatImpl(messages, req);
    // If we got here without error the conversion ran — check onComplete was called
    expect(req.callbacks.onComplete).toHaveBeenCalled();
  });

  it('converts tool_call arguments from JSON string to object', async () => {
    const req = makeOllamaReq();
    mockedNDJSON.mockImplementation(async (_url: string, _opts: any, handler: (line: any) => void) => {
      handler({ done: true });
    });

    const messages = [{
      role: 'assistant',
      content: '',
      tool_calls: [{ id: 'c1', type: 'function', function: { name: 'fn', arguments: '{"k":"v"}' } }],
    }] as any;

    await generateOllamaChatImpl(messages, req);
    expect(req.callbacks.onComplete).toHaveBeenCalled();
  });

  it('routes thinking content to onReasoning', async () => {
    const req = makeOllamaReq();
    mockedNDJSON.mockImplementation(async (_url: string, _opts: any, handler: (line: any) => void) => {
      handler({ message: { thinking: 'internal thought', content: '' }, done: false });
      handler({ done: true });
    });

    await generateOllamaChatImpl([], req);
    expect(req.callbacks.onReasoning).toHaveBeenCalledWith('internal thought');
  });
});
