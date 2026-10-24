import { createOpenAIProvider } from '../../../../src/services/providers/openAICompatibleProvider';
import { MINIMAX_DEFAULT_MODEL, MINIMAX_ENDPOINTS, MINIMAX_MODELS, isMiniMaxEndpoint } from '../../../../src/services/providers/minimax';
import type { Message } from '../../../../src/types';

jest.mock('../../../../src/utils/logger', () => ({
  __esModule: true,
  default: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock('../../../../src/stores/appStore', () => ({
  useAppStore: { getState: () => ({ settings: {} }) },
}));

// Exercise the real provider, message builder, JSON serialization and SSE reader.
// Only the native network boundary is replaced; no request reaches an API.
class RecordingXHR {
  static requests: Array<{ url: string; body: Record<string, any> }> = [];
  readyState = 0;
  status = 200;
  responseText = 'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\n';
  responseURL = '';
  onreadystatechange?: () => void;
  open(_method: string, url: string) { this.responseURL = url; }
  setRequestHeader() {}
  abort() {}
  send(body: string) {
    RecordingXHR.requests.push({ url: this.responseURL, body: JSON.parse(body) });
    this.readyState = 4;
    this.onreadystatechange?.();
  }
}

describe('MiniMax serialized remote requests', () => {
  const originalXHR = global.XMLHttpRequest;
  beforeEach(() => {
    RecordingXHR.requests = [];
    global.XMLHttpRequest = RecordingXHR as unknown as typeof XMLHttpRequest;
  });
  afterEach(() => { global.XMLHttpRequest = originalXHR; });

  it('offers Flash first and M3 without treating other protocols as this transport', () => {
    expect(MINIMAX_MODELS.map(model => model.id)).toEqual(['MiniMax-M3.1-Flash', 'MiniMax-M3']);
    expect(isMiniMaxEndpoint(MINIMAX_ENDPOINTS.global.anthropic)).toBe(false);
    expect(isMiniMaxEndpoint('https://api.minimax.io.example/v1')).toBe(false);
    expect(isMiniMaxEndpoint('invalid')).toBe(false);
  });

  it.each(Object.values(MINIMAX_ENDPOINTS).map(region => region.openai))(
    'serializes default, saved and custom models at %s without losing tool/image history',
    async endpoint => {
      const messages = [
        { role: 'user', content: 'Describe', attachments: [{ type: 'image', uri: 'data:image/png;base64,AAAA' }] },
        { role: 'assistant', content: '', reasoningDetails: [{ type: 'reasoning.text', text: 'kept' }], toolCalls: [{ id: 'call-1', name: 'lookup', arguments: '{}' }] },
        { role: 'tool', content: 'result', toolCallId: 'call-1' },
      ] as Message[];
      for (const modelId of [MINIMAX_DEFAULT_MODEL, 'MiniMax-M3', 'MiniMax-M2.7', 'custom-model']) {
        const provider = createOpenAIProvider('test', endpoint, { modelId });
        provider.updateCapabilities({ supportsVision: true, supportsThinking: true });
        const callbacks = { onToken: jest.fn(), onComplete: jest.fn(), onError: jest.fn() };
        await provider.generate(messages, { enableThinking: false }, callbacks);
        expect(callbacks.onError).not.toHaveBeenCalled();
        expect(callbacks.onComplete).toHaveBeenCalledWith(expect.objectContaining({ content: 'ok' }));
        const request = RecordingXHR.requests[RecordingXHR.requests.length - 1];
        expect(request.url).toBe(`${endpoint}/chat/completions`);
        expect(request.body.model).toBe(modelId);
        expect(request.body.messages[0].content[1].image_url.url).toBe('data:image/png;base64,AAAA');
        expect(request.body.messages[1].tool_calls[0].id).toBe('call-1');
        expect(request.body.messages[1].reasoning_details).toEqual(messages[1].reasoningDetails);
        expect(request.body.messages[2].tool_call_id).toBe('call-1');
        expect(request.body.thinking).toEqual(modelId === 'MiniMax-M3' ? { type: 'disabled' } : undefined);
        expect(request.body).not.toHaveProperty('reasoning_effort');
        expect(request.body).not.toHaveProperty('service_tier');
        expect(request.body).not.toHaveProperty('reasoning_split');
        expect(request.body).not.toHaveProperty('chat_template_kwargs');
      }
    },
  );

  it('uses adaptive M3 thinking by default and preserves non-MiniMax requests', async () => {
    for (const endpoint of ['https://api.minimax.io/v1', 'https://custom.example/v1']) {
      const provider = createOpenAIProvider('test', endpoint, { modelId: 'MiniMax-M3' });
      const onError = jest.fn();
      await provider.generate([], {}, { onToken: jest.fn(), onComplete: jest.fn(), onError });
      expect(onError).not.toHaveBeenCalled();
      expect(RecordingXHR.requests[RecordingXHR.requests.length - 1].body.thinking)
        .toEqual(endpoint.includes('minimax.io') ? { type: 'adaptive' } : undefined);
    }
  });
});
