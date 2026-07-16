/**
 * Unit tests for remoteModelCapabilities.ts
 */

jest.mock('../../../src/utils/logger', () => ({
  __esModule: true,
  default: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import {
  fetchRemoteModelInfo,
  fetchLmStudioModelInfo,
  fetchLlamaCppProps,
  fetchLlamaCppPropsCached,
  fetchModelCapabilities,
  isGenerativeModel,
} from '../../../src/stores/remoteModelCapabilities';

function mockFetch(response: Partial<Response> & { ok: boolean }) {
  globalThis.fetch = jest.fn().mockResolvedValue(response);
}

function mockFetchError(err: Error) {
  globalThis.fetch = jest.fn().mockRejectedValue(err);
}

afterEach(() => {
  jest.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// isGenerativeModel
// ---------------------------------------------------------------------------

describe('isGenerativeModel', () => {
  it('returns true for a standard chat model', () => {
    expect(isGenerativeModel('llama3.2')).toBe(true);
    expect(isGenerativeModel('mistral-7b')).toBe(true);
  });

  it('returns false for embedding models', () => {
    expect(isGenerativeModel('nomic-embed-text')).toBe(false);
    expect(isGenerativeModel('text-embedding-ada-002')).toBe(false);
    expect(isGenerativeModel('bge-small-en')).toBe(false);
    expect(isGenerativeModel('e5-large')).toBe(false);
    expect(isGenerativeModel('minilm-v2')).toBe(false);
    expect(isGenerativeModel('arctic-embed-m')).toBe(false);
  });

  it('returns false for reranker models', () => {
    expect(isGenerativeModel('rerank-multilingual')).toBe(false);
    expect(isGenerativeModel('bge-reranker-base')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// fetchRemoteModelInfo (Ollama /api/show)
// ---------------------------------------------------------------------------

describe('fetchRemoteModelInfo', () => {
  it('returns default fallback on fetch error', async () => {
    mockFetchError(new Error('network error'));
    const result = await fetchRemoteModelInfo('http://localhost:11434', 'llama3');
    expect(result).toEqual({ contextLength: 4096, supportsVision: false });
  });

  it('returns default fallback when response is not ok', async () => {
    mockFetch({ ok: false, json: async () => ({}) } as any);
    const result = await fetchRemoteModelInfo('http://localhost:11434', 'llama3');
    expect(result).toEqual({ contextLength: 4096, supportsVision: false });
  });

  it('extracts contextLength from model_info', async () => {
    mockFetch({
      ok: true,
      json: async () => ({
        model_info: { 'llama.context_length': 8192 },
      }),
    } as any);
    const result = await fetchRemoteModelInfo('http://localhost:11434', 'llama3');
    expect(result.contextLength).toBe(8192);
  });

  it('detects vision support from model_info keys', async () => {
    mockFetch({
      ok: true,
      json: async () => ({
        model_info: { 'clip.vision.block_count': 24, 'llama.context_length': 4096 },
      }),
    } as any);
    const result = await fetchRemoteModelInfo('http://localhost:11434', 'llava');
    expect(result.supportsVision).toBe(true);
  });

  it('falls back to num_ctx from parameters when model_info gives 4096', async () => {
    mockFetch({
      ok: true,
      json: async () => ({
        model_info: {},
        parameters: 'num_ctx 16384\ntemperature 0.8',
      }),
    } as any);
    const result = await fetchRemoteModelInfo('http://localhost:11434', 'llama3');
    expect(result.contextLength).toBe(16384);
  });

  it('detects thinking support from template .Think marker', async () => {
    mockFetch({
      ok: true,
      json: async () => ({
        model_info: {},
        template: '{{- if .Think }}...',
      }),
    } as any);
    const result = await fetchRemoteModelInfo('http://localhost:11434', 'qwen-thinking');
    expect(result.supportsThinking).toBe(true);
  });

  it('detects thinking support from modelfile RENDERER line', async () => {
    mockFetch({
      ok: true,
      json: async () => ({
        model_info: {},
        modelfile: 'FROM qwen3.5\nRENDERER thinking\n',
      }),
    } as any);
    const result = await fetchRemoteModelInfo('http://localhost:11434', 'qwen3.5');
    expect(result.supportsThinking).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// fetchLmStudioModelInfo
// ---------------------------------------------------------------------------

describe('fetchLmStudioModelInfo', () => {
  it('returns default fallback on fetch error', async () => {
    mockFetchError(new Error('network error'));
    const result = await fetchLmStudioModelInfo('http://localhost:1234', 'llama3');
    expect(result).toEqual({ contextLength: 4096, supportsVision: false });
  });

  it('returns default fallback when response is not ok', async () => {
    mockFetch({ ok: false, json: async () => ({}) } as any);
    const result = await fetchLmStudioModelInfo('http://localhost:1234', 'llama3');
    expect(result).toEqual({ contextLength: 4096, supportsVision: false });
  });

  it('returns default fallback when model not found in list', async () => {
    globalThis.fetch = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ models: [{ key: 'other-model', capabilities: {} }] }),
      } as any)
      .mockRejectedValueOnce(new Error('probe failed'));

    const result = await fetchLmStudioModelInfo('http://localhost:1234', 'llama3');
    expect(result).toEqual({ contextLength: 4096, supportsVision: false });
  });

  it('extracts vision and tool capabilities', async () => {
    globalThis.fetch = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          models: [{
            key: 'llava-7b',
            max_context_length: 8192,
            capabilities: { vision: true, trained_for_tool_use: true },
          }],
        }),
      } as any)
      .mockResolvedValueOnce({
        ok: false,
      } as any);

    const result = await fetchLmStudioModelInfo('http://localhost:1234', 'llava-7b');
    expect(result.supportsVision).toBe(true);
    expect(result.supportsToolCalling).toBe(true);
    expect(result.contextLength).toBe(8192);
  });
});

// ---------------------------------------------------------------------------
// fetchLlamaCppProps
// ---------------------------------------------------------------------------

describe('fetchLlamaCppProps', () => {
  it('returns null on network error', async () => {
    mockFetchError(new Error('offline'));
    expect(await fetchLlamaCppProps('http://localhost:7878')).toBeNull();
  });

  it('returns null on non-ok (not a llama.cpp server)', async () => {
    mockFetch({ ok: false, json: async () => ({}) } as any);
    expect(await fetchLlamaCppProps('http://localhost:11434')).toBeNull();
  });

  it('returns null when the payload lacks modalities and chat_template_caps', async () => {
    mockFetch({ ok: true, json: async () => ({ some_other_server: true }) } as any);
    expect(await fetchLlamaCppProps('http://localhost:1234')).toBeNull();
  });

  it('parses vision/tools/context from a real Gateway /props payload', async () => {
    mockFetch({
      ok: true,
      json: async () => ({
        modalities: { vision: true, video: true, audio: false },
        chat_template_caps: { supports_tools: true, supports_preserve_reasoning: false },
        default_generation_settings: { n_ctx: 37888, params: { reasoning_format: 'none' } },
      }),
    } as any);
    const info = await fetchLlamaCppProps('http://192.168.1.58:7878');
    expect(info).not.toBeNull();
    expect(info!.supportsVision).toBe(true);
    expect(info!.supportsToolCalling).toBe(true);
    expect(info!.supportsThinking).toBe(false);
    expect(info!.acceptsThinkingKwarg).toBe(false);
    expect(info!.contextLength).toBe(37888);
  });

  it('sets acceptsThinkingKwarg when the template exposes enable_thinking', async () => {
    mockFetch({
      ok: true,
      json: async () => ({
        modalities: { vision: false },
        chat_template_caps: { supports_tools: true },
        chat_template: "{%- if enable_thinking is defined and enable_thinking is true %}{{- '<think>' }}",
        default_generation_settings: { n_ctx: 4096, params: { reasoning_format: 'none' } },
      }),
    } as any);
    const info = await fetchLlamaCppProps('http://192.168.1.58:7878');
    expect(info!.acceptsThinkingKwarg).toBe(true);
    expect(info!.supportsThinking).toBe(true);
  });

  it('detects thinking from the chat_template even when supports_preserve_reasoning is false', async () => {
    // Real Gateway case: Qwen3.5 reports supports_preserve_reasoning=false and
    // reasoning_format=none, yet the template exposes enable_thinking — and the
    // model DOES think on demand. The template is the reliable capability signal.
    mockFetch({
      ok: true,
      json: async () => ({
        modalities: { vision: true },
        chat_template_caps: { supports_tools: true, supports_preserve_reasoning: false },
        chat_template: "{%- if enable_thinking is defined and enable_thinking is true %}\n{{- '<think>\\n' }}",
        default_generation_settings: { n_ctx: 37888, params: { reasoning_format: 'none' } },
      }),
    } as any);
    const info = await fetchLlamaCppProps('http://192.168.1.58:7878');
    expect(info!.supportsThinking).toBe(true);
  });

  it('reports thinking when supports_preserve_reasoning is true', async () => {
    mockFetch({
      ok: true,
      json: async () => ({
        modalities: { vision: false },
        chat_template_caps: { supports_tools: false, supports_preserve_reasoning: true },
        default_generation_settings: { n_ctx: 4096, params: { reasoning_format: 'none' } },
      }),
    } as any);
    const info = await fetchLlamaCppProps('http://192.168.1.58:7878');
    expect(info!.supportsThinking).toBe(true);
  });

  it('logs a warning (not silent) when /props is unavailable', async () => {
    const logger = require('../../../src/utils/logger').default;
    logger.warn.mockClear();
    mockFetchError(new Error('DNS failure'));
    const info = await fetchLlamaCppProps('http://192.168.1.58:7878');
    expect(info).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(
      '[fetchLlamaCppProps] /props unavailable:',
      'http://192.168.1.58:7878',
      'DNS failure',
    );
  });
});

// ---------------------------------------------------------------------------
// fetchLlamaCppPropsCached — de-duplication
// ---------------------------------------------------------------------------

describe('fetchLlamaCppPropsCached', () => {
  it('shares a single in-flight /props request across concurrent calls to one endpoint', async () => {
    let calls = 0;
    globalThis.fetch = jest.fn().mockImplementation(() => {
      calls += 1;
      return Promise.resolve({
        ok: true,
        json: async () => ({ modalities: { vision: true }, chat_template_caps: { supports_tools: true } }),
      } as any);
    });

    const ep = 'http://192.168.1.58:7878';
    // Fire three concurrent calls (as N models on one server would).
    const [a, b, c] = await Promise.all([
      fetchLlamaCppPropsCached(ep),
      fetchLlamaCppPropsCached(ep),
      fetchLlamaCppPropsCached(ep),
    ]);

    expect(calls).toBe(1); // one /props request, not three
    expect(a!.supportsVision).toBe(true);
    expect(b).toEqual(a);
    expect(c).toEqual(a);
  });

  it('re-probes after the in-flight request settles (no stale caching)', async () => {
    let calls = 0;
    globalThis.fetch = jest.fn().mockImplementation(() => {
      calls += 1;
      return Promise.resolve({
        ok: true,
        json: async () => ({ modalities: { vision: false }, chat_template_caps: {} }),
      } as any);
    });
    const ep = 'http://192.168.1.60:7878';
    await fetchLlamaCppPropsCached(ep);
    await fetchLlamaCppPropsCached(ep); // after settle → new request
    expect(calls).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// fetchModelCapabilities
// ---------------------------------------------------------------------------

describe('fetchModelCapabilities', () => {
  const nameDetect = {
    vision: (id: string) => id.includes('vision'),
    toolCalling: (id: string) => id.includes('tool'),
  };

  it('returns ollama info when it has real data', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        model_info: { 'llama.context_length': 8192 },
      }),
    } as any);

    const result = await fetchModelCapabilities('http://localhost:11434', 'llama3', nameDetect);
    expect(result.contextLength).toBe(8192);
  });

  it('falls back to name-based detection when neither API returns real data', async () => {
    mockFetchError(new Error('offline'));
    const result = await fetchModelCapabilities('http://localhost:11434', 'llava-vision-tool', nameDetect);
    expect(result.supportsVision).toBe(true);
    expect(result.supportsToolCalling).toBe(true);
    expect(result.contextLength).toBe(4096);
  });

  it('returns LM Studio info when Ollama returns defaults but LM Studio has real data', async () => {
    globalThis.fetch = jest.fn()
      // /props arm first — not a llama.cpp server, so 404
      .mockResolvedValueOnce({ ok: false } as any)
      .mockRejectedValueOnce(new Error('ollama offline'))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          models: [{ key: 'llava', max_context_length: 8192, capabilities: { vision: true, trained_for_tool_use: false } }],
        }),
      } as any)
      .mockResolvedValueOnce({ ok: false } as any);

    const result = await fetchModelCapabilities('http://localhost:1234', 'llava', nameDetect);
    expect(result.supportsVision).toBe(true);
    expect(result.contextLength).toBe(8192);
  });

  it('prefers llama.cpp /props (vision + tools) over name-based detection — the Gateway case', async () => {
    // Off Grid AI Gateway: /v1/models has no capability data, but /props reports
    // the real modalities. Name says "no vision" (id has no vl/vision), yet the
    // model genuinely supports it — /props must win.
    globalThis.fetch = jest.fn().mockImplementation((url: string) => {
      if (url.endsWith('/props')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            modalities: { vision: true, video: true, audio: false },
            chat_template_caps: { supports_tools: true, supports_preserve_reasoning: false },
            default_generation_settings: { n_ctx: 37888, params: { reasoning_format: 'none' } },
          }),
        } as any);
      }
      // Ollama /api/show + LM Studio /api/v1/models don't exist on the Gateway
      return Promise.resolve({ ok: false } as any);
    });

    const result = await fetchModelCapabilities('http://192.168.1.58:7878', '/Users/admin/.offgrid/models/Qwen3.5-9B-Q4_K_M.gguf', nameDetect);
    expect(result.supportsVision).toBe(true);
    expect(result.supportsToolCalling).toBe(true);
    expect(result.supportsThinking).toBe(false);
    expect(result.contextLength).toBe(37888);
  });

  it('trusts /props even when every capability is false (genuine text-only model)', async () => {
    // A vision-name model on a llama.cpp server that did NOT load a projector:
    // /props says vision=false and must override the name-based "llava → vision".
    globalThis.fetch = jest.fn().mockImplementation((url: string) => {
      if (url.endsWith('/props')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            modalities: { vision: false, video: false, audio: false },
            chat_template_caps: { supports_tools: false },
            default_generation_settings: { n_ctx: 8192, params: { reasoning_format: 'none' } },
          }),
        } as any);
      }
      return Promise.resolve({ ok: false } as any);
    });

    const result = await fetchModelCapabilities('http://192.168.1.58:7878', 'llava-vision', nameDetect);
    expect(result.supportsVision).toBe(false);
    expect(result.contextLength).toBe(8192);
  });

  it('detects thinking from /props reasoning_format when present', async () => {
    globalThis.fetch = jest.fn().mockImplementation((url: string) => {
      if (url.endsWith('/props')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            modalities: { vision: false },
            chat_template_caps: { supports_tools: false, supports_preserve_reasoning: false },
            default_generation_settings: { n_ctx: 4096, params: { reasoning_format: 'deepseek' } },
          }),
        } as any);
      }
      return Promise.resolve({ ok: false } as any);
    });

    const result = await fetchModelCapabilities('http://192.168.1.58:7878', 'some-model', nameDetect);
    expect(result.supportsThinking).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// fetchRemoteModelInfo — parseNumCtx edge cases
// ---------------------------------------------------------------------------

describe('fetchRemoteModelInfo — parseNumCtx edge cases', () => {
  it('returns 4096 when model_info empty and parameters has no num_ctx', async () => {
    mockFetch({
      ok: true,
      json: async () => ({ model_info: {}, parameters: 'temperature 0.8' }),
    } as any);
    const result = await fetchRemoteModelInfo('http://localhost:11434', 'llama3');
    expect(result.contextLength).toBe(4096);
  });

  it('returns 4096 when model_info empty and no parameters field', async () => {
    mockFetch({
      ok: true,
      json: async () => ({ model_info: {} }),
    } as any);
    const result = await fetchRemoteModelInfo('http://localhost:11434', 'llama3');
    expect(result.contextLength).toBe(4096);
  });
});

// ---------------------------------------------------------------------------
// probeLmStudioThinking / deltaHasThinking — SSE parsing branches
// ---------------------------------------------------------------------------

describe('fetchLmStudioModelInfo — probeLmStudioThinking SSE branches', () => {
  const modelResponse = (key: string) => ({
    ok: true,
    json: async () => ({
      models: [{ key, max_context_length: 4096, capabilities: {} }],
    }),
  } as any);

  it('detects thinking via <think> in content delta', async () => {
    globalThis.fetch = jest.fn()
      .mockResolvedValueOnce(modelResponse('m1'))
      .mockResolvedValueOnce({
        ok: true,
        text: async () => 'data: {"choices":[{"delta":{"content":"<think>hi</think>"}}]}\ndata: [DONE]\n',
      } as any);
    const result = await fetchLmStudioModelInfo('http://localhost:1234', 'm1');
    expect(result.supportsThinking).toBe(true);
  });

  it('detects thinking via inline Gemma <|channel>thought reasoning in content delta', async () => {
    // A remote model emitting Gemma-channel reasoning INLINE (no reasoning_content field)
    // must still be detected as thinking. The probe hardcoded a `<think>` check and missed
    // the Gemma/Qwen channel delimiters that the rest of the reasoning grammar knows.
    globalThis.fetch = jest.fn()
      .mockResolvedValueOnce(modelResponse('gemma'))
      .mockResolvedValueOnce({
        ok: true,
        text: async () => 'data: {"choices":[{"delta":{"content":"<|channel>thought\\nreasoning"}}]}\ndata: [DONE]\n',
      } as any);
    const result = await fetchLmStudioModelInfo('http://localhost:1234', 'gemma');
    expect(result.supportsThinking).toBe(true);
  });

  it('detects thinking via inline Qwen <|channel|>analysis reasoning in content delta', async () => {
    globalThis.fetch = jest.fn()
      .mockResolvedValueOnce(modelResponse('qwen'))
      .mockResolvedValueOnce({
        ok: true,
        text: async () => 'data: {"choices":[{"delta":{"content":"<|channel|>analysis<|message|>reasoning"}}]}\ndata: [DONE]\n',
      } as any);
    const result = await fetchLmStudioModelInfo('http://localhost:1234', 'qwen');
    expect(result.supportsThinking).toBe(true);
  });

  it('detects thinking via reasoning_content delta', async () => {
    globalThis.fetch = jest.fn()
      .mockResolvedValueOnce(modelResponse('m2'))
      .mockResolvedValueOnce({
        ok: true,
        text: async () => 'data: {"choices":[{"delta":{"reasoning_content":"thinking..."}}]}\ndata: [DONE]\n',
      } as any);
    const result = await fetchLmStudioModelInfo('http://localhost:1234', 'm2');
    expect(result.supportsThinking).toBe(true);
  });

  it('detects thinking via reasoning delta', async () => {
    globalThis.fetch = jest.fn()
      .mockResolvedValueOnce(modelResponse('m3'))
      .mockResolvedValueOnce({
        ok: true,
        text: async () => 'data: {"choices":[{"delta":{"reasoning":"thought"}}]}\ndata: [DONE]\n',
      } as any);
    const result = await fetchLmStudioModelInfo('http://localhost:1234', 'm3');
    expect(result.supportsThinking).toBe(true);
  });

  it('detects thinking via thinking delta', async () => {
    globalThis.fetch = jest.fn()
      .mockResolvedValueOnce(modelResponse('m4'))
      .mockResolvedValueOnce({
        ok: true,
        text: async () => 'data: {"choices":[{"delta":{"thinking":"thought"}}]}\ndata: [DONE]\n',
      } as any);
    const result = await fetchLmStudioModelInfo('http://localhost:1234', 'm4');
    expect(result.supportsThinking).toBe(true);
  });

  it('returns supportsThinking=false when SSE has plain content only', async () => {
    globalThis.fetch = jest.fn()
      .mockResolvedValueOnce(modelResponse('m5'))
      .mockResolvedValueOnce({
        ok: true,
        text: async () => 'data: {"choices":[{"delta":{"content":"hello"}}]}\ndata: [DONE]\n',
      } as any);
    const result = await fetchLmStudioModelInfo('http://localhost:1234', 'm5');
    expect(result.supportsThinking).toBe(false);
  });

  it('marks acceptsThinkingKwarg=true even for a non-thinking model (server capability, not probe)', async () => {
    // LM Studio always honors enable_thinking; the probe only tells us whether THIS
    // model reasons. A false probe (or a flaky one) must not strip the kwarg.
    globalThis.fetch = jest.fn()
      .mockResolvedValueOnce(modelResponse('m7'))
      .mockResolvedValueOnce({
        ok: true,
        text: async () => 'data: {"choices":[{"delta":{"content":"plain"}}]}\ndata: [DONE]\n',
      } as any);
    const result = await fetchLmStudioModelInfo('http://localhost:1234', 'm7');
    expect(result.supportsThinking).toBe(false);
    expect(result.acceptsThinkingKwarg).toBe(true);
  });

  it('skips malformed JSON lines in SSE and returns false', async () => {
    globalThis.fetch = jest.fn()
      .mockResolvedValueOnce(modelResponse('m6'))
      .mockResolvedValueOnce({
        ok: true,
        text: async () => 'data: {bad json}\ndata: {"choices":[{"delta":{"content":"hi"}}]}\ndata: [DONE]\n',
      } as any);
    const result = await fetchLmStudioModelInfo('http://localhost:1234', 'm6');
    expect(result.supportsThinking).toBe(false);
  });
});
