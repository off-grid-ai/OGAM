/**
 * Integration Tests: Remote Server Model Discovery
 *
 * Tests the model discovery flow in remoteServerStore, specifically:
 * - Vision detection via fetchRemoteModelInfo (POST /api/show)
 * - Vision detection via fetchLmStudioModelInfo (GET /api/v1/models)
 * - End-to-end through the store's discoverModels action
 */

// Mock logger before imports
jest.mock('../../../src/utils/logger', () => ({
  __esModule: true,
  default: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

// Mock remoteServerManager to prevent initialization side effects
jest.mock('../../../src/services/remoteServerManager', () => ({
  remoteServerManager: {
    initializeProviders: jest.fn(),
    testConnection: jest.fn(),
  },
}));

// Mock httpClient — not exercised in discovery but imported by the store
jest.mock('../../../src/services/httpClient', () => ({
  testEndpoint: jest.fn(),
  detectServerType: jest.fn(),
}));

import { useRemoteServerStore } from '../../../src/stores/remoteServerStore';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Add a server directly into the store and return its id. */
function addServer(opts: {
  id: string;
  endpoint: string;
  name?: string;
}): void {
  useRemoteServerStore.setState((state) => ({
    servers: [
      ...state.servers,
      {
        id: opts.id,
        name: opts.name ?? opts.id,
        endpoint: opts.endpoint,
        providerType: 'openai-compatible' as const,
        apiKey: undefined,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ],
  }));
}

/** Resolve a fetch call with a JSON body and a given ok/status. */
function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response;
}

/** Reject a fetch call (simulates timeout / abort). */
function rejectWith(msg: string): Promise<never> {
  return Promise.reject(new Error(msg));
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('remoteServerDiscovery integration', () => {
  let mockFetch: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch = jest.fn();
    (globalThis as unknown as { fetch: typeof mockFetch }).fetch = mockFetch;
    // Reset servers and discovered models between tests
    useRemoteServerStore.setState({ servers: [], discoveredModels: {} });
  });

  // =========================================================================
  // Ollama — vision detection via /api/show
  // =========================================================================

  describe('Ollama vision detection via /api/show', () => {
    it('detects vision model via clip key in model_info', async () => {
      addServer({ id: 'srv-ollama', endpoint: 'http://192.168.1.10:11434' }); // NOSONAR

      mockFetch.mockImplementation((url: string) => {
        if (url.endsWith('/v1/models')) {
          return Promise.resolve(
            jsonResponse({ object: 'list', data: [{ id: 'llava-v1.6' }] }),
          );
        }
        if (url.endsWith('/api/show')) {
          return Promise.resolve(
            jsonResponse({
              model_info: {
                'clip.vision.block_count': 32,
                'llava.context_length': 8192,
              },
            }),
          );
        }
        return Promise.resolve(jsonResponse({}, false, 404));
      });

      const models = await useRemoteServerStore
        .getState()
        .discoverModels('srv-ollama');

      expect(models).toHaveLength(1);
      expect(models[0].id).toBe('llava-v1.6');
      expect(models[0].capabilities.supportsVision).toBe(true);
      expect(models[0].capabilities.maxContextLength).toBe(8192);
    });

    it('detects vision model via "vision" key in model_info', async () => {
      addServer({ id: 'srv-ollama', endpoint: 'http://192.168.1.10:11434' }); // NOSONAR

      mockFetch.mockImplementation((url: string) => {
        if (url.endsWith('/v1/models')) {
          return Promise.resolve(
            jsonResponse({ object: 'list', data: [{ id: 'qwen2vl:7b' }] }),
          );
        }
        if (url.endsWith('/api/show')) {
          return Promise.resolve(
            jsonResponse({
              model_info: {
                'qwen2vl.vision_token_id': 151654,
                'qwen2.context_length': 32768,
              },
            }),
          );
        }
        return Promise.resolve(jsonResponse({}, false, 404));
      });

      const models = await useRemoteServerStore
        .getState()
        .discoverModels('srv-ollama');

      expect(models).toHaveLength(1);
      expect(models[0].capabilities.supportsVision).toBe(true);
      expect(models[0].capabilities.maxContextLength).toBe(32768);
    });

    it('marks non-vision model supportsVision=false', async () => {
      addServer({ id: 'srv-ollama', endpoint: 'http://192.168.1.10:11434' }); // NOSONAR

      mockFetch.mockImplementation((url: string) => {
        if (url.endsWith('/v1/models')) {
          return Promise.resolve(
            jsonResponse({ object: 'list', data: [{ id: 'llama3.2:8b' }] }),
          );
        }
        if (url.endsWith('/api/show')) {
          return Promise.resolve(
            jsonResponse({
              model_info: {
                'llama.context_length': 32768,
              },
            }),
          );
        }
        return Promise.resolve(jsonResponse({}, false, 404));
      });

      const models = await useRemoteServerStore
        .getState()
        .discoverModels('srv-ollama');

      expect(models).toHaveLength(1);
      expect(models[0].capabilities.supportsVision).toBe(false);
      expect(models[0].capabilities.maxContextLength).toBe(32768);
    });

    it('falls back to defaults when /api/show rejects (timeout)', async () => {
      addServer({ id: 'srv-ollama', endpoint: 'http://192.168.1.10:11434' }); // NOSONAR

      mockFetch.mockImplementation((url: string) => {
        if (url.endsWith('/v1/models')) {
          return Promise.resolve(
            jsonResponse({ object: 'list', data: [{ id: 'llama3.2:8b' }] }),
          );
        }
        if (url.endsWith('/api/show')) {
          return rejectWith('AbortError');
        }
        return Promise.resolve(jsonResponse({}, false, 404));
      });

      const models = await useRemoteServerStore
        .getState()
        .discoverModels('srv-ollama');

      // Model still appears with default fallback values
      expect(models).toHaveLength(1);
      expect(models[0].id).toBe('llama3.2:8b');
      expect(models[0].capabilities.supportsVision).toBe(false);
      expect(models[0].capabilities.maxContextLength).toBe(4096);
    });

    it('falls back to /api/tags when /v1/models returns 404, then detects vision', async () => {
      addServer({ id: 'srv-ollama', endpoint: 'http://192.168.1.10:11434' }); // NOSONAR

      mockFetch.mockImplementation((url: string) => {
        if (url.endsWith('/v1/models')) {
          return Promise.resolve(jsonResponse({}, false, 404));
        }
        if (url.endsWith('/api/tags')) {
          return Promise.resolve(
            jsonResponse({ models: [{ name: 'llava' }] }),
          );
        }
        if (url.endsWith('/api/show')) {
          return Promise.resolve(
            jsonResponse({
              model_info: {
                'clip.vision.block_count': 24,
              },
            }),
          );
        }
        return Promise.resolve(jsonResponse({}, false, 503));
      });

      const models = await useRemoteServerStore
        .getState()
        .discoverModels('srv-ollama');

      expect(models).toHaveLength(1);
      expect(models[0].id).toBe('llava');
      expect(models[0].capabilities.supportsVision).toBe(true);
    });
  });

  // =========================================================================
  // LM Studio — vision detection via /api/v1/models
  // =========================================================================

  describe('LM Studio vision detection via /api/v1/models', () => {
    it('does NOT detect vision from type === "vlm" (type field is ignored; only capabilities.vision is used)', async () => {
      addServer({ id: 'srv-lms', endpoint: 'http://192.168.1.20:1234' }); // NOSONAR

      mockFetch.mockImplementation((url: string) => {
        // /api/v1/models returns LM Studio native format: { models: [{ key, type, ... }] }
        if (url.includes('/api/v1/models')) {
          return Promise.resolve(
            jsonResponse({
              models: [
                {
                  key: 'qwen3-vl-2b-thinking-mlx',
                  type: 'vlm', // type is present but NOT used for vision detection
                  max_context_length: 32768,
                  // no capabilities.vision set → supportsVision should be false
                },
              ],
            }),
          );
        }
        if (url.endsWith('/v1/models')) {
          return Promise.resolve(
            jsonResponse({
              object: 'list',
              data: [{ id: 'qwen3-vl-2b-thinking-mlx', max_context_length: 32768 }],
            }),
          );
        }
        return Promise.resolve(jsonResponse({}, false, 404));
      });

      const models = await useRemoteServerStore
        .getState()
        .discoverModels('srv-lms');

      expect(models).toHaveLength(1);
      expect(models[0].id).toBe('qwen3-vl-2b-thinking-mlx');
      // type === "vlm" is NOT used; capabilities.vision not set → supportsVision is false
      expect(models[0].capabilities.supportsVision).toBe(false);
      expect(models[0].capabilities.maxContextLength).toBe(32768);
    });

    it('detects VLM via capabilities.vision === true', async () => {
      addServer({ id: 'srv-lms', endpoint: 'http://192.168.1.20:1234' }); // NOSONAR

      mockFetch.mockImplementation((url: string) => {
        // /api/v1/models returns LM Studio native format: { models: [{ key, capabilities, ... }] }
        if (url.includes('/api/v1/models')) {
          return Promise.resolve(
            jsonResponse({
              models: [
                {
                  key: 'some-vision-model',
                  capabilities: { vision: true },
                  max_context_length: 16384,
                },
              ],
            }),
          );
        }
        if (url.endsWith('/v1/models')) {
          return Promise.resolve(
            jsonResponse({
              object: 'list',
              data: [{ id: 'some-vision-model', max_context_length: 16384 }],
            }),
          );
        }
        return Promise.resolve(jsonResponse({}, false, 404));
      });

      const models = await useRemoteServerStore
        .getState()
        .discoverModels('srv-lms');

      expect(models).toHaveLength(1);
      expect(models[0].capabilities.supportsVision).toBe(true);
      expect(models[0].capabilities.maxContextLength).toBe(16384);
    });

    it('marks non-vision LM Studio model supportsVision=false', async () => {
      addServer({ id: 'srv-lms', endpoint: 'http://192.168.1.20:1234' }); // NOSONAR

      mockFetch.mockImplementation((url: string) => {
        // /api/v1/models returns LM Studio native format: { models: [{ key, type, ... }] }
        if (url.includes('/api/v1/models')) {
          return Promise.resolve(
            jsonResponse({
              models: [
                {
                  key: 'llama3.2',
                  type: 'llm',
                  max_context_length: 8192,
                  // no capabilities.vision → supportsVision=false
                },
              ],
            }),
          );
        }
        if (url.endsWith('/v1/models')) {
          return Promise.resolve(
            jsonResponse({
              object: 'list',
              data: [{ id: 'llama3.2', max_context_length: 8192 }],
            }),
          );
        }
        return Promise.resolve(jsonResponse({}, false, 404));
      });

      const models = await useRemoteServerStore
        .getState()
        .discoverModels('srv-lms');

      expect(models).toHaveLength(1);
      expect(models[0].capabilities.supportsVision).toBe(false);
      expect(models[0].capabilities.maxContextLength).toBe(8192);
    });

    it('falls back to /v1/models context length when /api/v1/models returns non-ok', async () => {
      addServer({ id: 'srv-lms', endpoint: 'http://192.168.1.20:1234' }); // NOSONAR

      mockFetch.mockImplementation((url: string) => {
        // Match /api/v1/models before /v1/models (the former is a suffix of the latter)
        if (url.includes('/api/v1/models')) {
          return Promise.resolve(jsonResponse({ error: 'not found' }, false, 404));
        }
        if (url.endsWith('/v1/models')) {
          return Promise.resolve(
            jsonResponse({
              object: 'list',
              data: [{ id: 'llama3.2', max_context_length: 4096 }],
            }),
          );
        }
        return Promise.resolve(jsonResponse({}, false, 503));
      });

      const models = await useRemoteServerStore
        .getState()
        .discoverModels('srv-lms');

      expect(models).toHaveLength(1);
      // fetchLmStudioModelInfo failed → falls back to { contextLength: 4096, supportsVision: false }
      expect(models[0].capabilities.maxContextLength).toBe(4096);
      expect(models[0].capabilities.supportsVision).toBe(false);
    });
  });

  // =========================================================================
  // Embedding model filtering
  // =========================================================================

  describe('embedding model filtering', () => {
    it('filters out embedding model and keeps text generation model', async () => {
      addServer({ id: 'srv-ollama', endpoint: 'http://192.168.1.10:11434' }); // NOSONAR

      mockFetch.mockImplementation((url: string) => {
        if (url.endsWith('/v1/models')) {
          return Promise.resolve(
            jsonResponse({
              object: 'list',
              data: [{ id: 'nomic-embed-text' }, { id: 'llama3.2' }],
            }),
          );
        }
        // /api/show for llama3.2
        if (url.endsWith('/api/show')) {
          return Promise.resolve(
            jsonResponse({ model_info: { 'llama.context_length': 8192 } }),
          );
        }
        return Promise.resolve(jsonResponse({}, false, 404));
      });

      const models = await useRemoteServerStore
        .getState()
        .discoverModels('srv-ollama');

      const ids = models.map((m) => m.id);
      expect(ids).toContain('llama3.2');
      expect(ids).not.toContain('nomic-embed-text');
    });
  });

  // =========================================================================
  // Multiple models from same Ollama server
  // =========================================================================

  describe('multiple models from same Ollama server', () => {
    it('assigns correct vision detection to each model independently', async () => {
      addServer({ id: 'srv-ollama', endpoint: 'http://192.168.1.10:11434' }); // NOSONAR

      const showResponses: Record<string, unknown> = {
        'llama3.2': { model_info: { 'llama.context_length': 8192 } },
        'mistral:7b': { model_info: { 'mistral.context_length': 16384 } },
        'llava-v1.6': {
          model_info: {
            'clip.vision.block_count': 32,
            'llava.context_length': 4096,
          },
        },
      };

      mockFetch.mockImplementation((url: string, init?: RequestInit) => {
        if (url.endsWith('/v1/models')) {
          return Promise.resolve(
            jsonResponse({
              object: 'list',
              data: [
                { id: 'llama3.2' },
                { id: 'mistral:7b' },
                { id: 'llava-v1.6' },
              ],
            }),
          );
        }
        if (url.endsWith('/api/show')) {
          const body = JSON.parse((init?.body as string) ?? '{}');
          const modelName: string = body.name ?? '';
          const payload = showResponses[modelName] ?? { model_info: {} };
          return Promise.resolve(jsonResponse(payload));
        }
        return Promise.resolve(jsonResponse({}, false, 404));
      });

      const models = await useRemoteServerStore
        .getState()
        .discoverModels('srv-ollama');

      expect(models).toHaveLength(3);

      const byId = Object.fromEntries(models.map((m) => [m.id, m]));

      expect(byId['llama3.2'].capabilities.supportsVision).toBe(false);
      expect(byId['llama3.2'].capabilities.maxContextLength).toBe(8192);

      expect(byId['mistral:7b'].capabilities.supportsVision).toBe(false);
      expect(byId['mistral:7b'].capabilities.maxContextLength).toBe(16384);

      expect(byId['llava-v1.6'].capabilities.supportsVision).toBe(true);
      expect(byId['llava-v1.6'].capabilities.maxContextLength).toBe(4096);
    });
  });

  // =========================================================================
  // Store state updated after discoverModels
  // =========================================================================

  describe('store state persistence', () => {
    it('updates discoveredModels in the store after discoverModels call', async () => {
      addServer({ id: 'srv-id', endpoint: 'http://192.168.1.10:11434' }); // NOSONAR

      mockFetch.mockImplementation((url: string) => {
        if (url.endsWith('/v1/models')) {
          return Promise.resolve(
            jsonResponse({
              object: 'list',
              data: [{ id: 'llava-v1.6' }],
            }),
          );
        }
        if (url.endsWith('/api/show')) {
          return Promise.resolve(
            jsonResponse({
              model_info: {
                'clip.vision.block_count': 16,
                'llava.context_length': 8192,
              },
            }),
          );
        }
        return Promise.resolve(jsonResponse({}, false, 404));
      });

      await useRemoteServerStore.getState().discoverModels('srv-id');

      const stored = useRemoteServerStore.getState().discoveredModels['srv-id'];
      expect(stored).toBeDefined();
      expect(stored).toHaveLength(1);
      expect(stored[0].id).toBe('llava-v1.6');
      expect(stored[0].capabilities.supportsVision).toBe(true);
      expect(stored[0].capabilities.maxContextLength).toBe(8192);
    });
  });

  // =========================================================================
  // Off Grid AI Desktop gateway — modality `kind` filtering
  // =========================================================================

  describe('gateway kind filtering', () => {
    it('keeps only chat/vision models and drops image, speech, and transcription', async () => {
      addServer({ id: 'srv-gw', endpoint: 'http://192.168.1.44:7878' }); // NOSONAR

      mockFetch.mockImplementation((url: string) => {
        if (url.endsWith('/v1/models')) {
          return Promise.resolve(
            jsonResponse({
              object: 'list',
              data: [
                { id: 'gemma-3', kind: 'chat' },
                { id: 'qwen3-vl', kind: 'vision' },
                { id: 'sdxl', kind: 'image' },
                { id: 'kokoro', kind: 'speech' },
                { id: 'whisper-base', kind: 'transcription' },
              ],
            }),
          );
        }
        // Capability probes (e.g. /api/show) are not available here.
        return Promise.resolve(jsonResponse({}, false, 404));
      });

      const models = await useRemoteServerStore.getState().discoverModels('srv-gw');

      const ids = models.map((m) => m.id).sort((a, b) => a.localeCompare(b));
      expect(ids).toEqual(['gemma-3', 'qwen3-vl']);
      expect(models.some((m) => m.id === 'sdxl')).toBe(false);
      expect(models.some((m) => m.id === 'kokoro')).toBe(false);
      expect(models.some((m) => m.id === 'whisper-base')).toBe(false);
    });

    it('still lists models from servers that do not send kind (Ollama/LM Studio)', async () => {
      addServer({ id: 'srv-plain', endpoint: 'http://192.168.1.20:1234' }); // NOSONAR

      mockFetch.mockImplementation((url: string) => {
        if (url.endsWith('/v1/models')) {
          return Promise.resolve(
            jsonResponse({ object: 'list', data: [{ id: 'llama-3.2' }] }),
          );
        }
        return Promise.resolve(jsonResponse({}, false, 404));
      });

      const models = await useRemoteServerStore.getState().discoverModels('srv-plain');
      expect(models.map((m) => m.id)).toEqual(['llama-3.2']);
    });
  });
});
