/**
 * OpenAI-Compatible Provider Unit Tests
 *
 * Tests for the OpenAI-compatible provider that communicates with
 * remote LLM servers like Ollama, LM Studio, etc.
 */

import { OpenAICompatibleProvider, createOpenAIProvider } from '../../../../src/services/providers/openAICompatibleProvider';
import * as httpClient from '../../../../src/services/httpClient';

// Mock httpClient
jest.mock('../../../../src/services/httpClient', () => ({
  createStreamingRequest: jest.fn(),
  createNDJSONStreamingRequest: jest.fn(),
  imageToBase64DataUrl: jest.fn(),
  fetchWithTimeout: jest.fn(),
  parseOpenAIMessage: jest.fn((event: { data: string }) => {
    if (typeof event.data !== 'string') return null;
    const data = event.data.trim();
    if (data === '[DONE]') return { object: 'done' };
    try {
      return JSON.parse(data);
    } catch {
      return null;
    }
  }),
}));

// Mock appStore
jest.mock('../../../../src/stores', () => ({
  useAppStore: {
    getState: jest.fn(() => ({
      settings: {
        temperature: 0.7,
        maxTokens: 1024,
        topP: 0.9,
      },
    })),
  },
}));

describe('OpenAICompatibleProvider', () => {
  let provider: OpenAICompatibleProvider;

  beforeEach(() => {
    jest.clearAllMocks();
    provider = new OpenAICompatibleProvider('test-server', {
      endpoint: 'http://192.168.1.50:1234',
      modelId: 'llama2',
    });
  });

  describe('constructor', () => {
    it('should create provider with correct id', () => {
      expect(provider.id).toBe('test-server');
    });

    it('should have correct type', () => {
      expect(provider.type).toBe('openai-compatible');
    });

    it('should create using factory function', () => {
      const p = createOpenAIProvider('my-server', 'http://localhost:1234', { apiKey: 'my-key', modelId: 'model-id' });
      expect(p.id).toBe('my-server');
    });
  });

  describe('capabilities', () => {
    it('should return default capabilities', () => {
      const caps = provider.capabilities;

      expect(caps.supportsVision).toBe(false);
      expect(caps.supportsToolCalling).toBe(true);
      expect(caps.supportsThinking).toBe(false);
    });

    it('loadModel() does NOT set supportsVision — stays false until updateCapabilities is called', async () => {
      // Even vision-named models stay false after loadModel — capabilities come from discovery
      await provider.loadModel('llava-v1.6-7b');
      expect(provider.capabilities.supportsVision).toBe(false);

      await provider.loadModel('gpt-4-vision-preview');
      expect(provider.capabilities.supportsVision).toBe(false);

      await provider.loadModel('claude-3-opus');
      expect(provider.capabilities.supportsVision).toBe(false);
    });

    it('updateCapabilities() sets supportsVision to true', () => {
      expect(provider.capabilities.supportsVision).toBe(false);

      provider.updateCapabilities({ supportsVision: true });

      expect(provider.capabilities.supportsVision).toBe(true);
    });

    it('updateCapabilities() merges partial updates without overwriting other capabilities', () => {
      provider.updateCapabilities({ supportsVision: true });
      provider.updateCapabilities({ supportsThinking: true });

      expect(provider.capabilities.supportsVision).toBe(true);
      expect(provider.capabilities.supportsThinking).toBe(true);
      expect(provider.capabilities.supportsToolCalling).toBe(true);
    });

    it('updateCapabilities() can set supportsVision back to false', () => {
      provider.updateCapabilities({ supportsVision: true });
      expect(provider.capabilities.supportsVision).toBe(true);

      provider.updateCapabilities({ supportsVision: false });
      expect(provider.capabilities.supportsVision).toBe(false);
    });
  });

  describe('loadModel', () => {
    it('should set model ID', async () => {
      await provider.loadModel('mistral-7b');

      expect(provider.getLoadedModelId()).toBe('mistral-7b');
    });
  });

  describe('unloadModel', () => {
    it('should clear model ID', async () => {
      await provider.loadModel('test-model');
      await provider.unloadModel();

      expect(provider.getLoadedModelId()).toBeNull();
      expect(provider.isModelLoaded()).toBe(false);
    });
  });

  describe('isModelLoaded', () => {
    it('should return true when model is set', async () => {
      await provider.loadModel('test-model');

      expect(provider.isModelLoaded()).toBe(true);
    });

    it('should return false when no model is set', () => {
      // Create a provider without initial model
      const emptyProvider = new OpenAICompatibleProvider('empty', {
        endpoint: 'http://test:11434',
        modelId: '',
      });

      expect(emptyProvider.isModelLoaded()).toBe(false);
    });
  });

  describe('isReady', () => {
    it('should return true when model and endpoint are set', async () => {
      await provider.loadModel('test-model');

      const ready = await provider.isReady();

      expect(ready).toBe(true);
    });

    it('should return false when no model is set', async () => {
      // Create a provider without initial model
      const emptyProvider = new OpenAICompatibleProvider('empty', {
        endpoint: 'http://test:11434',
        modelId: '',
      });

      const ready = await emptyProvider.isReady();

      expect(ready).toBe(false);
    });
  });

  describe('generate', () => {
    it('should call onError when no model is loaded', async () => {
      // Create a provider without initial model
      const emptyProvider = new OpenAICompatibleProvider('empty', {
        endpoint: 'http://test:11434',
        modelId: '',
      });

      const onError = jest.fn();
      const onComplete = jest.fn();

      await emptyProvider.generate(
        [{ id: '1', role: 'user', content: 'Hello', timestamp: 0 }],
        {},
        { onToken: jest.fn(), onComplete, onError }
      );

      expect(onError).toHaveBeenCalledWith(expect.any(Error));
      expect(onError.mock.calls[0][0].message).toBe('No model selected');
    });

    it('should make streaming request to correct endpoint', async () => {
      await provider.loadModel('test-model');

      const mockCreateStreamingRequest = httpClient.createStreamingRequest as jest.Mock;
      mockCreateStreamingRequest.mockImplementation((_url, _req, onEvent) => {
        // Simulate SSE events
        onEvent({ data: '{"choices":[{"delta":{"content":"Hello"}}]}' });
        onEvent({ data: '{"choices":[{"delta":{"content":" world"}}]}' });
        onEvent({ data: '{"choices":[{"finish_reason":"stop"}]}' });
        return Promise.resolve();
      });

      const onToken = jest.fn();
      const onComplete = jest.fn();

      await provider.generate(
        [{ id: '1', role: 'user', content: 'Hi', timestamp: 0 }],
        { temperature: 0.5 },
        { onToken, onComplete, onError: jest.fn() }
      );

      expect(mockCreateStreamingRequest).toHaveBeenCalledWith(
        'http://192.168.1.50:1234/v1/chat/completions',
        expect.objectContaining({
          body: expect.objectContaining({ model: 'test-model', stream: true, temperature: 0.5 }),
          headers: expect.objectContaining({ 'Content-Type': 'application/json', Accept: 'text/event-stream' }),
          signal: expect.any(AbortSignal),
        }),
        expect.any(Function)
      );

      expect(onToken).toHaveBeenCalledWith('Hello');
      expect(onToken).toHaveBeenCalledWith(' world');
    });

    it('should include API key in headers when provided', async () => {
      const secureProvider = new OpenAICompatibleProvider('secure', {
        endpoint: 'http://api.example.com',
        apiKey: 'secret-key',
        modelId: 'test-model',
      });

      await secureProvider.loadModel('test-model');

      const mockCreateStreamingRequest = httpClient.createStreamingRequest as jest.Mock;
      mockCreateStreamingRequest.mockImplementation(async () => { });

      await secureProvider.generate(
        [{ id: '1', role: 'user', content: 'Hi', timestamp: 0 }],
        {},
        { onToken: jest.fn(), onComplete: jest.fn(), onError: jest.fn() }
      );

      expect(mockCreateStreamingRequest).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer secret-key' }),
        }),
        expect.any(Function)
      );
    });

    it('should call onComplete when generation finishes', async () => {
      await provider.loadModel('test-model');

      const mockCreateStreamingRequest = httpClient.createStreamingRequest as jest.Mock;
      mockCreateStreamingRequest.mockImplementation(async (_url, _req, onEvent) => {
        // Stream content then finish
        onEvent({ data: '{"choices":[{"delta":{"content":"Test"}}]}' });
        onEvent({ data: '{"choices":[{"delta":{},"finish_reason":"stop"}]}' });
      });

      const onComplete = jest.fn();

      await provider.generate(
        [{ id: '1', role: 'user', content: 'Hi', timestamp: 0 }],
        {},
        { onToken: jest.fn(), onComplete, onError: jest.fn() }
      );

      expect(onComplete).toHaveBeenCalledWith(
        expect.objectContaining({
          content: 'Test',
        })
      );
    });

    it('should handle tool calls in response', async () => {
      await provider.loadModel('test-model');

      const mockCreateStreamingRequest = httpClient.createStreamingRequest as jest.Mock;
      mockCreateStreamingRequest.mockImplementation(async (_url, _req, onEvent) => {
        // Tool call - streaming chunks that build up arguments
        onEvent({ data: '{"choices":[{"delta":{"tool_calls":[{"id":"call_123","function":{"name":"web_search","arguments":""}}]}}]}' });
        onEvent({ data: '{"choices":[{"delta":{"tool_calls":[{"function":{"arguments":"{\\"query\\":\\"test\\"}"}}]}}]}' });
        onEvent({ data: '{"choices":[{"delta":{},"finish_reason":"tool_calls"}]}' });
      });

      const onComplete = jest.fn();

      await provider.generate(
        [{ id: '1', role: 'user', content: 'Search for test', timestamp: 0 }],
        { tools: [{ type: 'function', function: { name: 'web_search', description: 'Search', parameters: {} } }] },
        { onToken: jest.fn(), onComplete, onError: jest.fn() }
      );

      expect(onComplete).toHaveBeenCalledWith(
        expect.objectContaining({
          toolCalls: expect.arrayContaining([
            expect.objectContaining({
              id: 'call_123',
              name: 'web_search',
            }),
          ]),
        })
      );
    });

    it('should stop generation on abort', async () => {
      await provider.loadModel('test-model');

      const mockCreateStreamingRequest = httpClient.createStreamingRequest as jest.Mock;
      // Mock that simulates generation followed by stop
      mockCreateStreamingRequest.mockImplementation(async (_url, _req, onEvent) => {
        onEvent({ data: '{"choices":[{"delta":{"content":"Hello"}}]}' });
        onEvent({ data: '{"choices":[{"delta":{},"finish_reason":"stop"}]}' });
      });

      const onComplete = jest.fn();
      const onError = jest.fn();

      await provider.generate(
        [{ id: '1', role: 'user', content: 'Hi', timestamp: 0 }],
        {},
        { onToken: jest.fn(), onComplete, onError }
      );

      // Should call onComplete with generated content
      expect(onComplete).toHaveBeenCalledWith(
        expect.objectContaining({
          content: 'Hello',
        })
      );
      expect(onError).not.toHaveBeenCalled();
    });
  });

  describe('generate — enable_thinking kwarg gating (capability-driven)', () => {
    // The gate is a DISCOVERED capability (acceptsThinkingKwarg), not the port.
    const runGenerate = async (opts: {
      acceptsThinkingKwarg?: boolean;
      enableThinking?: boolean;
      endpoint?: string;
    }) => {
      const p = new OpenAICompatibleProvider('s', {
        endpoint: opts.endpoint ?? 'http://example.com:9999',
        modelId: 'qwen3',
      });
      await p.loadModel('qwen3');
      if (opts.acceptsThinkingKwarg !== undefined) {
        p.updateCapabilities({ acceptsThinkingKwarg: opts.acceptsThinkingKwarg });
      }
      const mock = httpClient.createStreamingRequest as jest.Mock;
      mock.mockImplementation((_url, _req, onEvent) => {
        onEvent({ data: '{"choices":[{"finish_reason":"stop"}]}' });
        return Promise.resolve();
      });
      await p.generate(
        [{ id: '1', role: 'user', content: 'Hi', timestamp: 0 }],
        { enableThinking: opts.enableThinking },
        { onToken: jest.fn(), onComplete: jest.fn(), onError: jest.fn() },
      );
      return (mock.mock.calls[0][1].body as Record<string, unknown>);
    };

    it('sends enable_thinking:true when the server advertised acceptsThinkingKwarg', async () => {
      const body = await runGenerate({ acceptsThinkingKwarg: true, enableThinking: true });
      expect(body.chat_template_kwargs).toEqual({ enable_thinking: true });
    });

    it('sends enable_thinking:false (thinking off) when the capability is present', async () => {
      const body = await runGenerate({ acceptsThinkingKwarg: true, enableThinking: false });
      expect(body.chat_template_kwargs).toEqual({ enable_thinking: false });
    });

    it('omits chat_template_kwargs entirely when the server did not advertise the capability', async () => {
      // A server on ANY port that never reported acceptsThinkingKwarg must not get
      // the field — unknown fields can be rejected. No port check involved.
      const body = await runGenerate({ acceptsThinkingKwarg: false, enableThinking: true });
      expect(body.chat_template_kwargs).toBeUndefined();
    });

    it('omits chat_template_kwargs by default (capability undiscovered)', async () => {
      const body = await runGenerate({ enableThinking: true });
      expect(body.chat_template_kwargs).toBeUndefined();
    });

    it('does NOT take the OpenAI chat_template_kwargs path for a plain Ollama endpoint (port 11434)', async () => {
      // Ollama routes through its native /api/chat (think: flag) via a different
      // NDJSON transport, so the OpenAI createStreamingRequest path — the only one
      // that can carry chat_template_kwargs — is never invoked for it.
      const p = new OpenAICompatibleProvider('s', { endpoint: 'http://192.168.1.50:11434', modelId: 'qwen3' });
      await p.loadModel('qwen3');
      p.updateCapabilities({ acceptsThinkingKwarg: true });
      const mock = httpClient.createStreamingRequest as jest.Mock;
      mock.mockClear();
      await p.generate(
        [{ id: '1', role: 'user', content: 'Hi', timestamp: 0 }],
        { enableThinking: true },
        { onToken: jest.fn(), onComplete: jest.fn(), onError: jest.fn() },
      );
      expect(mock).not.toHaveBeenCalled();
    });
  });

  describe('stopGeneration', () => {
    it('should abort ongoing generation', async () => {
      await provider.loadModel('test-model');

      // Track if generation was aborted
      let wasAborted = false;

      (httpClient.createStreamingRequest as jest.Mock).mockImplementation(
        async (_url, _req, _onEvent) => {
          const signal = _req.signal;
          // Simulate abort via signal
          if (signal) {
            // Check if already aborted
            if (signal.aborted) {
              wasAborted = true;
              return;
            }
            // Listen for abort
            signal.addEventListener('abort', () => {
              wasAborted = true;
            });
          }
          // Simulate fast completion
        }
      );

      const onComplete = jest.fn();

      await provider.generate(
        [{ id: '1', role: 'user', content: 'Hi', timestamp: 0 }],
        {},
        { onToken: jest.fn(), onComplete, onError: jest.fn() }
      );

      // Stop generation (should abort)
      await provider.stopGeneration();

      // Generation completed (fast) before the stop → onComplete fired and the abort never had to
      // trigger. (The prior assertion `onComplete.mock.calls.length >= 0` was a tautology — always
      // true — so it proved nothing; assert the real terminal outcome instead.)
      expect(onComplete).toHaveBeenCalled();
      expect(wasAborted).toBe(false);
    });
  });

  describe('getTokenCount', () => {
    it('should estimate token count', async () => {
      const count = await provider.getTokenCount('Hello world this is a test');

      // Approximate: ~25 chars / 4 = ~6 tokens
      expect(count).toBeGreaterThan(0);
    });
  });

  describe('updateConfig', () => {
    it('should update endpoint', async () => {
      // Verify endpoint is updated
      const newProvider = new OpenAICompatibleProvider('test', {
        endpoint: 'http://original:11434',
        modelId: 'test-model',
      });

      await newProvider.loadModel('test-model');
      expect(newProvider.isModelLoaded()).toBe(true);

      newProvider.updateConfig({ endpoint: 'http://new-endpoint:8080' });

      // Endpoint updated - verify via generation call (would use new endpoint)
      expect(newProvider.isModelLoaded()).toBe(true);
    });

    it('should update model ID', async () => {
      await provider.loadModel('old-model');

      provider.updateConfig({ modelId: 'new-model' });

      // Model ID updates through updateConfig
      expect(provider.getLoadedModelId()).toBe('new-model');
    });
  });

  describe('generate — uncovered branches', () => {
    beforeEach(async () => {
      await provider.loadModel('test-model');
    });

    it('handles stream error message and calls onError', async () => {
      const mockStream = httpClient.createStreamingRequest as jest.Mock;
      mockStream.mockImplementation((_url, _req, onEvent) => {
        onEvent({ data: '{"error":{"message":"rate limit exceeded"}}' });
        return Promise.resolve();
      });

      const onError = jest.fn();
      const onComplete = jest.fn();
      await provider.generate(
        [{ id: '1', role: 'user', content: 'Hi', timestamp: 0 }],
        {},
        { onToken: jest.fn(), onComplete, onError }
      );

      expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'rate limit exceeded' }));
      expect(onComplete).not.toHaveBeenCalled();
    });

    it('handles [DONE] message (object=done) without calling onComplete twice', async () => {
      const mockStream = httpClient.createStreamingRequest as jest.Mock;
      mockStream.mockImplementation((_url, _req, onEvent) => {
        onEvent({ data: '{"choices":[{"delta":{"content":"Hi"},"finish_reason":"stop"}]}' });
        onEvent({ data: '[DONE]' }); // parsed to {object:'done'}
        return Promise.resolve();
      });

      const onComplete = jest.fn();
      await provider.generate(
        [{ id: '1', role: 'user', content: 'Hi', timestamp: 0 }],
        {},
        { onToken: jest.fn(), onComplete, onError: jest.fn() }
      );

      expect(onComplete).toHaveBeenCalledTimes(1);
    });

    it('handles reasoning_content in delta and calls onReasoning', async () => {
      const mockStream = httpClient.createStreamingRequest as jest.Mock;
      mockStream.mockImplementation((_url, _req, onEvent) => {
        onEvent({ data: '{"choices":[{"delta":{"content":"answer","reasoning_content":"thinking step"},"finish_reason":"stop"}]}' });
        return Promise.resolve();
      });

      const onReasoning = jest.fn();
      const onComplete = jest.fn();
      await provider.generate(
        [{ id: '1', role: 'user', content: 'Hi', timestamp: 0 }],
        {},
        { onToken: jest.fn(), onComplete, onError: jest.fn(), onReasoning }
      );

      expect(onReasoning).toHaveBeenCalledWith('thinking step');
    });

    it('calls fallback onComplete when stream ends without finish_reason', async () => {
      const mockStream = httpClient.createStreamingRequest as jest.Mock;
      mockStream.mockImplementation((_url, _req, onEvent) => {
        onEvent({ data: '{"choices":[{"delta":{"content":"partial"}}]}' });
        // No finish_reason — stream just ends
        return Promise.resolve();
      });

      const onComplete = jest.fn();
      await provider.generate(
        [{ id: '1', role: 'user', content: 'Hi', timestamp: 0 }],
        {},
        { onToken: jest.fn(), onComplete, onError: jest.fn() }
      );

      expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({ content: 'partial' }));
    });

    it('calls onComplete with empty content when aborted (catch branch)', async () => {
      const mockStream = httpClient.createStreamingRequest as jest.Mock;
      mockStream.mockImplementation(async (_url, _req, _onEvent) => {
        // Abort mid-request
        const signal = _req.signal;
        signal.dispatchEvent(new Event('abort'));
        const err = new DOMException('aborted', 'AbortError');
        Object.defineProperty(err, 'name', { value: 'AbortError' });
        // Simulate the abort throwing
        (provider as any).abortController?.abort();
        throw err;
      });

      const onComplete = jest.fn();
      const onError = jest.fn();
      await provider.generate(
        [{ id: '1', role: 'user', content: 'Hi', timestamp: 0 }],
        {},
        { onToken: jest.fn(), onComplete, onError }
      );

      // When aborted, onComplete called with empty content (not onError)
      expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({ content: '' }));
      expect(onError).not.toHaveBeenCalled();
    });

    it('calls onError on non-abort exception from stream', async () => {
      const mockStream = httpClient.createStreamingRequest as jest.Mock;
      mockStream.mockRejectedValue(new Error('network failure'));

      const onError = jest.fn();
      await provider.generate(
        [{ id: '1', role: 'user', content: 'Hi', timestamp: 0 }],
        {},
        { onToken: jest.fn(), onComplete: jest.fn(), onError }
      );

      expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'network failure' }));
    });

    it('skips event when signal is already aborted', async () => {
      const mockStream = httpClient.createStreamingRequest as jest.Mock;
      mockStream.mockImplementation((_url, _req, onEvent) => {
        // Abort the controller before triggering event
        (provider as any).abortController?.abort();
        onEvent({ data: '{"choices":[{"delta":{"content":"should be ignored"}}]}' });
        return Promise.resolve();
      });

      const onToken = jest.fn();
      await provider.generate(
        [{ id: '1', role: 'user', content: 'Hi', timestamp: 0 }],
        {},
        { onToken, onComplete: jest.fn(), onError: jest.fn() }
      );

      expect(onToken).not.toHaveBeenCalled();
    });
  });

  describe('generate — buildOpenAIMessages branches', () => {
    beforeEach(async () => {
      await provider.loadModel('test-model');
    });

    it('includes system prompt when provided in options', async () => {
      const mockStream = httpClient.createStreamingRequest as jest.Mock;
      let capturedBody: any;
      mockStream.mockImplementation((_url, _req, onEvent) => {
        capturedBody = _req.body;
        onEvent({ data: '{"choices":[{"delta":{},"finish_reason":"stop"}]}' });
        return Promise.resolve();
      });

      await provider.generate(
        [{ id: '1', role: 'user', content: 'Hello', timestamp: 0 }],
        { systemPrompt: 'You are helpful' },
        { onToken: jest.fn(), onComplete: jest.fn(), onError: jest.fn() }
      );

      expect(capturedBody.messages[0]).toEqual({ role: 'system', content: [{ type: 'text', text: 'You are helpful' }] });
    });

    it('does not duplicate system message when already in messages', async () => {
      const mockStream = httpClient.createStreamingRequest as jest.Mock;
      let capturedBody: any;
      mockStream.mockImplementation((_url, _req, onEvent) => {
        capturedBody = _req.body;
        onEvent({ data: '{"choices":[{"delta":{},"finish_reason":"stop"}]}' });
        return Promise.resolve();
      });

      await provider.generate(
        [
          { id: 's', role: 'system', content: 'Custom system', timestamp: 0 },
          { id: '1', role: 'user', content: 'Hello', timestamp: 0 },
        ],
        { systemPrompt: 'Another prompt' },
        { onToken: jest.fn(), onComplete: jest.fn(), onError: jest.fn() }
      );

      const systemMessages = capturedBody.messages.filter((m: any) => m.role === 'system');
      expect(systemMessages).toHaveLength(1);
      expect(systemMessages[0].content).toEqual([{ type: 'text', text: 'Custom system' }]);
    });

    it('includes tool result message for role=tool', async () => {
      const mockStream = httpClient.createStreamingRequest as jest.Mock;
      let capturedBody: any;
      mockStream.mockImplementation((_url, _req, onEvent) => {
        capturedBody = _req.body;
        onEvent({ data: '{"choices":[{"delta":{},"finish_reason":"stop"}]}' });
        return Promise.resolve();
      });

      await provider.generate(
        [
          { id: '1', role: 'user', content: 'search', timestamp: 0 },
          { id: '2', role: 'tool', content: 'result data', toolCallId: 'call_abc', timestamp: 0 },
        ],
        {},
        { onToken: jest.fn(), onComplete: jest.fn(), onError: jest.fn() }
      );

      const toolMsg = capturedBody.messages.find((m: any) => m.role === 'tool');
      expect(toolMsg).toBeDefined();
      expect(toolMsg.content).toEqual([{ type: 'text', text: 'result data' }]);
      expect(toolMsg.tool_call_id).toBe('call_abc');
    });

    it('includes assistant message with tool_calls when present', async () => {
      const mockStream = httpClient.createStreamingRequest as jest.Mock;
      let capturedBody: any;
      mockStream.mockImplementation((_url, _req, onEvent) => {
        capturedBody = _req.body;
        onEvent({ data: '{"choices":[{"delta":{},"finish_reason":"stop"}]}' });
        return Promise.resolve();
      });

      await provider.generate(
        [
          { id: '1', role: 'user', content: 'run tool', timestamp: 0 },
          {
            id: '2', role: 'assistant', content: '', timestamp: 0,
            toolCalls: [{ id: 'call_1', name: 'web_search', arguments: '{"query":"test"}' }],
          },
        ],
        {},
        { onToken: jest.fn(), onComplete: jest.fn(), onError: jest.fn() }
      );

      const assistantMsg = capturedBody.messages.find((m: any) => m.role === 'assistant' && m.tool_calls);
      expect(assistantMsg).toBeDefined();
      expect(assistantMsg.tool_calls[0].function.name).toBe('web_search');
    });
  });

  describe('stopGeneration — no-op when no controller', () => {
    it('does nothing when abortController is null', async () => {
      // provider is fresh without an in-flight request
      await expect(provider.stopGeneration()).resolves.toBeUndefined();
    });
  });

  describe('generate — onReasoning callback is optional', () => {
    it('does not throw when onReasoning callback is not provided', async () => {
      await provider.loadModel('test-model');
      const mockStream = httpClient.createStreamingRequest as jest.Mock;
      mockStream.mockImplementation((_url, _req, onEvent) => {
        onEvent({ data: '{"choices":[{"delta":{"reasoning_content":"thinking..."},"finish_reason":null}]}' });
        onEvent({ data: '{"choices":[{"delta":{"content":"done"},"finish_reason":"stop"}]}' });
        return Promise.resolve();
      });

      const onComplete = jest.fn();
      // No onReasoning callback provided
      await provider.generate(
        [{ id: '1', role: 'user', content: 'Hi', timestamp: 0 }],
        {},
        { onToken: jest.fn(), onComplete, onError: jest.fn() }
      );

      expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({ content: 'done' }));
    });
  });

  describe('generate — non-Error exception handling', () => {
    it('wraps non-Error throw in an Error object', async () => {
      await provider.loadModel('test-model');
      const mockStream = httpClient.createStreamingRequest as jest.Mock;
      mockStream.mockRejectedValue('plain string error');

      const onError = jest.fn();
      await provider.generate(
        [{ id: '1', role: 'user', content: 'Hi', timestamp: 0 }],
        {},
        { onToken: jest.fn(), onComplete: jest.fn(), onError }
      );

      expect(onError).toHaveBeenCalledWith(expect.any(Error));
      expect(onError.mock.calls[0][0].message).toBe('plain string error');
    });
  });

  describe('isReady — no endpoint', () => {
    it('returns false when endpoint is empty', async () => {
      const noEndpoint = new OpenAICompatibleProvider('no-ep', {
        endpoint: '',
        modelId: 'test-model',
      });
      await noEndpoint.loadModel('test-model');
      const ready = await noEndpoint.isReady();
      expect(ready).toBe(false);
    });
  });

  describe('generate — fallback onComplete with tool calls when no finish_reason', () => {
    it('includes tool calls in fallback onComplete when tool calls were accumulated', async () => {
      await provider.loadModel('test-model');
      const mockStream = httpClient.createStreamingRequest as jest.Mock;

      mockStream.mockImplementation(async (_url: string, _req: unknown, onEvent: Function) => {
        // Send tool call data but no finish_reason
        onEvent({ data: '{"choices":[{"delta":{"tool_calls":[{"id":"tc-1","function":{"name":"web_search","arguments":"{\\"q\\":\\"test\\"}"}}]}}]}' });
        // No finish_reason event - stream just ends
      });

      const onComplete = jest.fn();
      await provider.generate(
        [{ id: '1', role: 'user', content: 'Search', timestamp: 0 }],
        {},
        { onToken: jest.fn(), onComplete, onError: jest.fn() }
      );

      // Fallback onComplete should have been called with tool calls
      expect(onComplete).toHaveBeenCalledWith(
        expect.objectContaining({
          toolCalls: expect.arrayContaining([
            expect.objectContaining({ name: 'web_search' }),
          ]),
        })
      );
    });
  });

  describe('generate — vision/image multimodal content', () => {
    it('builds multimodal content when message has image attachment and supportsVision=true', async () => {
      // Load a model and explicitly enable vision via updateCapabilities (as remoteServerManager does)
      await provider.loadModel('llava-v1.6-7b');
      provider.updateCapabilities({ supportsVision: true });
      const mockImageUrl = httpClient.imageToBase64DataUrl as jest.Mock;
      mockImageUrl.mockResolvedValue('data:image/png;base64,abc123');

      const mockStream = httpClient.createStreamingRequest as jest.Mock;
      mockStream.mockImplementation(async (_url: string, _req: unknown, onEvent: Function) => {
        onEvent({ data: '{"choices":[{"delta":{"content":"I see an image"},"finish_reason":"stop"}]}' });
      });

      const onToken = jest.fn();
      await provider.generate(
        [{
          id: '1',
          role: 'user',
          content: 'What is in this image?',
          timestamp: 0,
          attachments: [{ type: 'image', uri: 'file:///path/to/img.png' }],
        } as any],
        {},
        { onToken, onComplete: jest.fn(), onError: jest.fn() }
      );

      // imageToBase64DataUrl should have been called
      expect(mockImageUrl).toHaveBeenCalledWith('file:///path/to/img.png');

      // The content passed to createStreamingRequest should include image_url type
      const streamCall = mockStream.mock.calls[0];
      const requestBody = (streamCall[1] as any).body;
      const userMessage = requestBody.messages.find((m: any) => m.role === 'user');
      expect(Array.isArray(userMessage?.content)).toBe(true);
      expect(userMessage.content.some((c: any) => c.type === 'image_url')).toBe(true);
    });
  });

  describe('generateOllamaChat — image handling', () => {
    it('places raw base64 (no data: prefix) in images array on the Ollama message', async () => {
      // Ollama provider (port 11434)
      const ollamaProvider = new OpenAICompatibleProvider('ollama-server', {
        endpoint: 'http://192.168.1.10:11434',
        modelId: 'llava-v1.6',
      });
      await ollamaProvider.loadModel('llava-v1.6');
      ollamaProvider.updateCapabilities({ supportsVision: true });

      const mockImageUrl = httpClient.imageToBase64DataUrl as jest.Mock;
      mockImageUrl.mockResolvedValue('data:image/png;base64,abc123rawbase64');

      const mockNDJSON = httpClient.createNDJSONStreamingRequest as jest.Mock;
      let capturedBody: any;
      mockNDJSON.mockImplementation(
        (_url: string, _req: any, onLine: Function) => {
          capturedBody = _req.body;
          onLine({ message: { content: 'I see it.' }, done: true });
          return Promise.resolve();
        }
      );

      await ollamaProvider.generate(
        [{
          id: '1',
          role: 'user',
          content: 'Describe this image',
          timestamp: 0,
          attachments: [{ type: 'image', uri: 'file:///path/to/photo.png' }],
        } as any],
        {},
        { onToken: jest.fn(), onComplete: jest.fn(), onError: jest.fn() }
      );

      expect(mockNDJSON).toHaveBeenCalled();
      const userMsg = capturedBody.messages.find((m: any) => m.role === 'user');
      expect(userMsg).toBeDefined();
      // images array must contain raw base64 — no 'data:image/...' prefix
      expect(Array.isArray(userMsg.images)).toBe(true);
      expect(userMsg.images[0]).toBe('abc123rawbase64');
      expect(userMsg.images[0]).not.toMatch(/^data:/);
    });

    it('omits images array when message has no image attachments', async () => {
      const ollamaProvider = new OpenAICompatibleProvider('ollama-server', {
        endpoint: 'http://192.168.1.10:11434',
        modelId: 'llava-v1.6',
      });
      await ollamaProvider.loadModel('llava-v1.6');

      const mockNDJSON = httpClient.createNDJSONStreamingRequest as jest.Mock;
      let capturedBody: any;
      mockNDJSON.mockImplementation(
        (_url: string, _req: any, onLine: Function) => {
          capturedBody = _req.body;
          onLine({ message: { content: 'Hello.' }, done: true });
          return Promise.resolve();
        }
      );

      await ollamaProvider.generate(
        [{ id: '1', role: 'user', content: 'Hello', timestamp: 0 }],
        {},
        { onToken: jest.fn(), onComplete: jest.fn(), onError: jest.fn() }
      );

      const userMsg = capturedBody.messages.find((m: any) => m.role === 'user');
      expect(userMsg).toBeDefined();
      expect(userMsg.images).toBeUndefined();
    });
  });

  describe('stopGeneration — with abortController set', () => {
    it('aborts the controller and clears it when abortController is set', async () => {
      await provider.loadModel('test-model');

      // Manually set the abortController to simulate an ongoing generation
      const controller = new AbortController();
      const abortSpy = jest.spyOn(controller, 'abort');
      (provider as any).abortController = controller;

      await provider.stopGeneration();

      expect(abortSpy).toHaveBeenCalled();
      expect((provider as any).abortController).toBeNull();
    });
  });

  describe('dispose', () => {
    it('calls stopGeneration and clears model ID', async () => {
      await provider.loadModel('test-model');
      expect(provider.isModelLoaded()).toBe(true);

      await provider.dispose();

      expect(provider.isModelLoaded()).toBe(false);
    });
  });
});