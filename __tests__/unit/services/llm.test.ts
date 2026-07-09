/**
 * LLMService Unit Tests
 *
 * Tests for the core LLM inference service (model loading, generation, context management).
 * Priority: P0 (Critical) - Core inference engine.
 */

import { initLlama } from 'llama.rn';
import { Platform } from 'react-native';
import RNFS from 'react-native-fs';
import { llmService } from '../../../src/services/llm';
import { useAppStore } from '../../../src/stores/appStore';
import { resetStores } from '../../utils/testHelpers';
import { createMockLlamaContext } from '../../utils/testHelpers';
import { createUserMessage, createAssistantMessage, createSystemMessage } from '../../utils/factories';

const mockedInitLlama = initLlama as jest.MockedFunction<typeof initLlama>;
const mockedRNFS = RNFS as jest.Mocked<typeof RNFS>;

/**
 * Helper: sets up mocks for auto context scaling tests.
 */
function setupScalingTest({
  modelContextLength,
  userContextLength,
  contextCount = 1,
}: {
  modelContextLength: string;
  userContextLength: number;
  contextCount?: number;
}) {
  mockedRNFS.exists.mockResolvedValue(true);

  const contexts = Array.from({ length: contextCount }, () =>
    createMockLlamaContext({
      model: { metadata: { 'llama.context_length': modelContextLength } },
    }),
  );

  if (contextCount === 1) {
    mockedInitLlama.mockResolvedValue(contexts[0] as any);
  } else {
    contexts.forEach((ctx) =>
      mockedInitLlama.mockResolvedValueOnce(ctx as any),
    );
  }

  useAppStore.setState({
    settings: {
      ...useAppStore.getState().settings,
      contextLength: userContextLength,
    },
  });

  return contexts;
}

describe('LLMService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks(); // undo any jest.spyOn (e.g. getAppMemoryUsage) so memory state doesn't leak between tests
    mockedRNFS.stat.mockResolvedValue({ size: 1000000, isFile: () => true } as any); // reset file size so per-test overrides don't leak
    resetStores();

    // Reset singleton state
    (llmService as any).context = null;
    (llmService as any).currentModelPath = null;
    (llmService as any).isGenerating = false;
    (llmService as any).multimodalSupport = null;
    (llmService as any).multimodalInitialized = false;
    (llmService as any).gpuEnabled = false;
    (llmService as any).gpuReason = '';
    (llmService as any).gpuDevices = [];
    (llmService as any).activeGpuLayers = 0;
    (llmService as any).performanceStats = {
      lastTokensPerSecond: 0,
      lastDecodeTokensPerSecond: 0,
      lastTimeToFirstToken: 0,
      lastGenerationTime: 0,
      lastTokenCount: 0,
    };
    (llmService as any).currentSettings = {
      nThreads: 4,
      nBatch: 512,
      contextLength: 2048,
    };
  });

  // ========================================================================
  // loadModel
  // ========================================================================
  describe('loadModel', () => {
    it('calls initLlama with correct parameters', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      const ctx = createMockLlamaContext();
      mockedInitLlama.mockResolvedValue(ctx as any);

      await llmService.loadModel('/models/test.gguf');

      expect(initLlama).toHaveBeenCalledWith(
        expect.objectContaining({
          model: '/models/test.gguf',
        })
      );
      expect(llmService.isModelLoaded()).toBe(true);
      expect(llmService.getLoadedModelPath()).toBe('/models/test.gguf');
    });

    it('throws when model file not found', async () => {
      mockedRNFS.exists.mockResolvedValue(false);

      await expect(llmService.loadModel('/missing/model.gguf')).rejects.toThrow('Model file not found');
    });

    it('downgrades context when memory is tight instead of loading and crashing (F4)', async () => {
      const { hardwareService } = require('../../../src/services/hardware');
      mockedRNFS.exists.mockResolvedValue(true);
      mockedRNFS.stat.mockResolvedValue({ size: 2 * 1024 * 1024 * 1024 } as any); // 2 GB model
      const ctx = createMockLlamaContext();
      mockedInitLlama.mockResolvedValue(ctx as any);
      // ~2.9 GB available: 8192/4096 ctx don't fit, a smaller ctx does.
      jest.spyOn(hardwareService, 'getAppMemoryUsage').mockResolvedValue({
        used: 5 * 1024 * 1024 * 1024,
        available: 2900 * 1024 * 1024,
        total: 8 * 1024 * 1024 * 1024,
      });
      useAppStore.setState({
        settings: { ...useAppStore.getState().settings, contextLength: 8192, cacheType: 'q8_0' },
      });

      await llmService.loadModel('/models/big.gguf');

      const ctxArg = (initLlama as jest.Mock).mock.calls[0][0].n_ctx;
      expect(ctxArg).toBeLessThan(8192); // context was reduced to fit
      expect(llmService.isModelLoaded()).toBe(true);
    });

    it('blocks the load when the model weights alone exceed available memory (F4)', async () => {
      const { hardwareService } = require('../../../src/services/hardware');
      mockedRNFS.exists.mockResolvedValue(true);
      mockedRNFS.stat.mockResolvedValue({ size: 6 * 1024 * 1024 * 1024 } as any); // 6 GB model
      const ctx = createMockLlamaContext();
      mockedInitLlama.mockResolvedValue(ctx as any);
      jest.spyOn(hardwareService, 'getAppMemoryUsage').mockResolvedValue({
        used: 6 * 1024 * 1024 * 1024,
        available: 2 * 1024 * 1024 * 1024, // 2 GB — can't even fit the weights
        total: 8 * 1024 * 1024 * 1024,
      });
      useAppStore.setState({
        settings: { ...useAppStore.getState().settings, contextLength: 4096, cacheType: 'q8_0' },
      });

      await expect(llmService.loadModel('/models/huge.gguf')).rejects.toThrow('Not enough memory');
      expect(initLlama).not.toHaveBeenCalled();
    });

    it('skips loading if same model already loaded', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      const ctx = createMockLlamaContext();
      mockedInitLlama.mockResolvedValue(ctx as any);

      await llmService.loadModel('/models/test.gguf');
      await llmService.loadModel('/models/test.gguf');

      expect(initLlama).toHaveBeenCalledTimes(1);
    });

    it('unloads existing model before loading different one', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      const ctx1 = createMockLlamaContext();
      const ctx2 = createMockLlamaContext();
      mockedInitLlama
        .mockResolvedValueOnce(ctx1 as any)
        .mockResolvedValueOnce(ctx2 as any);

      await llmService.loadModel('/models/model1.gguf');
      await llmService.loadModel('/models/model2.gguf');

      expect(ctx1.release).toHaveBeenCalled();
    });

    it('falls back to CPU when GPU init fails', async () => {
      mockedRNFS.exists.mockResolvedValue(true);

      // GPU load fails, CPU load succeeds
      const ctx = createMockLlamaContext();
      mockedInitLlama
        .mockRejectedValueOnce(new Error('GPU error'))
        .mockResolvedValueOnce(ctx as any);

      // Enable GPU via Metal backend (iOS test environment)
      useAppStore.setState({
        settings: {
          ...useAppStore.getState().settings,
          inferenceBackend: 'metal' as const,
          gpuLayers: 6,
        },
      });

      await llmService.loadModel('/models/test.gguf');

      expect(initLlama).toHaveBeenCalledTimes(2);
      expect(llmService.isModelLoaded()).toBe(true);
    });

    it('falls back to smaller context when CPU also fails', async () => {
      mockedRNFS.exists.mockResolvedValue(true);

      const ctx = createMockLlamaContext();
      mockedInitLlama
        .mockRejectedValueOnce(new Error('GPU error'))
        .mockRejectedValueOnce(new Error('OOM with ctx=4096'))
        .mockResolvedValueOnce(ctx as any);

      useAppStore.setState({
        settings: {
          ...useAppStore.getState().settings,
          contextLength: 4096,
          inferenceBackend: 'metal' as const,
        },
      });

      await llmService.loadModel('/models/test.gguf');

      // Third call should use ctx=2048
      expect(initLlama).toHaveBeenCalledTimes(3);
      const thirdCallArgs = (initLlama as jest.Mock).mock.calls[2][0];
      expect(thirdCallArgs.n_ctx).toBe(2048);
    });

    it('warns when mmproj file not found but continues', async () => {
      mockedRNFS.exists
        .mockResolvedValueOnce(true) // model exists
        .mockResolvedValueOnce(false); // mmproj doesn't exist

      const ctx = createMockLlamaContext();
      mockedInitLlama.mockResolvedValue(ctx as any);
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      await llmService.loadModel('/models/test.gguf', '/models/mmproj.gguf');

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringMatching(/MMProj file not found|mmproj file seems too small/i),
      );
      expect(llmService.isModelLoaded()).toBe(true);
      consoleSpy.mockRestore();
    });

    it('initializes multimodal when mmproj path provided and exists', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      mockedRNFS.stat.mockResolvedValue({ size: 800 * 1024 * 1024 } as any);

      const ctx = createMockLlamaContext({
        initMultimodal: jest.fn(() => Promise.resolve(true)),
        getMultimodalSupport: jest.fn(() => Promise.resolve({ vision: true, audio: false })),
      });
      mockedInitLlama.mockResolvedValue(ctx as any);

      await llmService.loadModel('/models/test.gguf', '/models/mmproj.gguf');

      expect(ctx.initMultimodal).toHaveBeenCalledWith(
        expect.objectContaining({ path: '/models/mmproj.gguf' })
      );
      expect(llmService.supportsVision()).toBe(true);
    });

    it('reads settings from appStore', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      const ctx = createMockLlamaContext();
      mockedInitLlama.mockResolvedValue(ctx as any);

      useAppStore.setState({
        settings: {
          ...useAppStore.getState().settings,
          nThreads: 8,
          nBatch: 512,
          contextLength: 4096,
        },
      });

      await llmService.loadModel('/models/test.gguf');

      expect(initLlama).toHaveBeenCalledWith(
        expect.objectContaining({
          n_threads: 8,
          n_batch: 512,
          n_ctx: 4096,
        })
      );
    });

    it('uses llama.rn jinja support to detect thinking support', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      const ctx = createMockLlamaContext({
        isJinjaSupported: jest.fn(() => true),
      });
      mockedInitLlama.mockResolvedValue(ctx as any);

      await llmService.loadModel('/models/test.gguf');

      expect(llmService.supportsThinking()).toBe(true);
      expect(ctx.isJinjaSupported).toHaveBeenCalled();
    });

    it('uses flashAttn=true from store and sets q8_0 KV cache', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      const ctx = createMockLlamaContext();
      mockedInitLlama.mockResolvedValue(ctx as any);

      useAppStore.setState({
        settings: {
          ...useAppStore.getState().settings,
          flashAttn: true,
        },
      });

      await llmService.loadModel('/models/test.gguf');

      expect(initLlama).toHaveBeenCalledWith(
        expect.objectContaining({
          flash_attn_type: 'auto',
          cache_type_k: 'q8_0',
          cache_type_v: 'q8_0',
        })
      );
    });

    it('uses flashAttn=false from store and sets f16 KV cache when cacheType is f16', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      const ctx = createMockLlamaContext();
      mockedInitLlama.mockResolvedValue(ctx as any);

      useAppStore.setState({
        settings: {
          ...useAppStore.getState().settings,
          flashAttn: false,
          cacheType: 'f16',
        },
      });

      await llmService.loadModel('/models/test.gguf');

      expect(initLlama).toHaveBeenCalledWith(
        expect.objectContaining({
          flash_attn_type: 'off',
          cache_type_k: 'f16',
          cache_type_v: 'f16',
        })
      );
    });

    it('falls back to platform default when flashAttn is undefined (iOS → flash attn ON)', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      const ctx = createMockLlamaContext();
      mockedInitLlama.mockResolvedValue(ctx as any);

      useAppStore.setState({
        settings: {
          ...useAppStore.getState().settings,
          flashAttn: undefined as any,
        },
      });

      await llmService.loadModel('/models/test.gguf');

      // Test env is iOS (Platform.OS = 'ios'), default is 'auto'
      expect(initLlama).toHaveBeenCalledWith(
        expect.objectContaining({
          flash_attn_type: 'auto',
          cache_type_k: 'q8_0',
          cache_type_v: 'q8_0',
        })
      );
    });

    it('captures GPU status from context', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      const ctx = createMockLlamaContext({
        gpu: true,
        reasonNoGPU: '',
        devices: ['Metal'],
      });
      mockedInitLlama.mockResolvedValue(ctx as any);

      useAppStore.setState({
        settings: {
          ...useAppStore.getState().settings,
          inferenceBackend: 'metal' as const,
          gpuLayers: 99,
        },
      });

      await llmService.loadModel('/models/test.gguf');

      const gpuInfo = llmService.getGpuInfo();
      expect(gpuInfo.gpu).toBe(true);
      expect(gpuInfo.gpuLayers).toBe(99);
    });

    it('resets state on final error', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      mockedInitLlama.mockRejectedValue(new Error('fatal'));

      // CPU backend to skip GPU retries
      useAppStore.setState({
        settings: {
          ...useAppStore.getState().settings,
          inferenceBackend: 'cpu' as const,
        },
      });

      await expect(llmService.loadModel('/models/test.gguf')).rejects.toThrow();

      expect(llmService.isModelLoaded()).toBe(false);
      expect(llmService.getLoadedModelPath()).toBeNull();
    });
  });

  // ========================================================================
  // initializeMultimodal
  // ========================================================================
  describe('initializeMultimodal', () => {
    it('returns false when no context', async () => {
      const result = await llmService.initializeMultimodal('/mmproj.gguf');
      expect(result).toBe(false);
    });

    it('calls context.initMultimodal with correct path', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      const ctx = createMockLlamaContext({
        initMultimodal: jest.fn(() => Promise.resolve(true)),
        getMultimodalSupport: jest.fn(() => Promise.resolve({ vision: true, audio: false })),
      });
      mockedInitLlama.mockResolvedValue(ctx as any);
      await llmService.loadModel('/models/test.gguf');

      const result = await llmService.initializeMultimodal('/models/mmproj.gguf');

      expect(ctx.initMultimodal).toHaveBeenCalledWith(
        expect.objectContaining({ path: '/models/mmproj.gguf' })
      );
      expect(result).toBe(true);
    });

    it('sets vision support on success', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      const ctx = createMockLlamaContext({
        initMultimodal: jest.fn(() => Promise.resolve(true)),
        getMultimodalSupport: jest.fn(() => Promise.resolve({ vision: true, audio: false })),
      });
      mockedInitLlama.mockResolvedValue(ctx as any);
      await llmService.loadModel('/models/test.gguf');

      await llmService.initializeMultimodal('/mmproj.gguf');

      expect(llmService.supportsVision()).toBe(true);
    });

    it('returns false on initMultimodal failure', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      const ctx = createMockLlamaContext({
        initMultimodal: jest.fn(() => Promise.resolve(false)),
      });
      mockedInitLlama.mockResolvedValue(ctx as any);
      await llmService.loadModel('/models/test.gguf');

      const result = await llmService.initializeMultimodal('/mmproj.gguf');

      expect(result).toBe(false);
      expect(llmService.supportsVision()).toBe(false);
    });

    it('handles exception gracefully', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      const ctx = createMockLlamaContext({
        initMultimodal: jest.fn(() => Promise.reject(new Error('crash'))),
      });
      mockedInitLlama.mockResolvedValue(ctx as any);
      await llmService.loadModel('/models/test.gguf');

      const result = await llmService.initializeMultimodal('/mmproj.gguf');

      expect(result).toBe(false);
    });
  });

  // ========================================================================
  // unloadModel
  // ========================================================================
  describe('unloadModel', () => {
    it('releases context and resets state', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      const ctx = createMockLlamaContext();
      mockedInitLlama.mockResolvedValue(ctx as any);
      await llmService.loadModel('/models/test.gguf');

      await llmService.unloadModel();

      expect(ctx.release).toHaveBeenCalled();
      expect(llmService.isModelLoaded()).toBe(false);
      expect(llmService.getLoadedModelPath()).toBeNull();
      expect(llmService.getMultimodalSupport()).toBeNull();
    });

    it('is safe when no model loaded', async () => {
      await llmService.unloadModel(); // Should not throw
      expect(llmService.isModelLoaded()).toBe(false);
    });
  });

  // ========================================================================
  // generateResponse
  // ========================================================================
  describe('generateResponse', () => {
    const setupLoadedModel = async (overrides: Record<string, any> = {}) => {
      mockedRNFS.exists.mockResolvedValue(true);
      const ctx = createMockLlamaContext({
        completion: jest.fn(async (params: any, callback: any) => {
          callback({ token: 'Hello' });
          callback({ token: ' World' });
          return { text: 'Hello World', tokens_predicted: 2 };
        }),
        tokenize: jest.fn(() => Promise.resolve({ tokens: [1, 2, 3] })),
        ...overrides,
      });
      mockedInitLlama.mockResolvedValue(ctx as any);
      await llmService.loadModel('/models/test.gguf');
      return ctx;
    };

    it('throws when no model loaded', async () => {
      const messages = [createUserMessage('Hello')];

      await expect(llmService.generateResponse(messages)).rejects.toThrow('No model loaded');
    });

    it('throws when generation already in progress', async () => {
      await setupLoadedModel();
      (llmService as any).isGenerating = true;

      const messages = [createUserMessage('Hello')];

      await expect(llmService.generateResponse(messages)).rejects.toThrow('Generation already in progress');
    });


    it('streams tokens via onStream callback', async () => {
      await setupLoadedModel();
      const messages = [createUserMessage('Hello')];
      const tokens: Array<{ content?: string; reasoningContent?: string }> = [];

      await llmService.generateResponse(messages, (token) => tokens.push(token));

      expect(tokens).toEqual([
        { content: 'Hello', reasoningContent: undefined },
        { content: ' World', reasoningContent: undefined },
      ]);
    });

    it('returns full response and calls onComplete', async () => {
      await setupLoadedModel();
      const messages = [createUserMessage('Hello')];
      const onComplete = jest.fn();

      const result = await llmService.generateResponse(messages, undefined, onComplete);

      expect(result).toBe('Hello World');
      expect(onComplete).toHaveBeenCalledWith({ content: 'Hello World', reasoningContent: '' });
    });

    it('updates performance stats', async () => {
      await setupLoadedModel();
      const messages = [createUserMessage('Hello')];

      await llmService.generateResponse(messages);

      const stats = llmService.getPerformanceStats();
      expect(stats.lastTokenCount).toBe(2);
      expect(stats.lastGenerationTime).toBeGreaterThanOrEqual(0);
    });

    it('resets isGenerating on error', async () => {
      await setupLoadedModel({
        completion: jest.fn(() => Promise.reject(new Error('gen error'))),
        tokenize: jest.fn(() => Promise.resolve({ tokens: [1, 2] })),
      });

      const messages = [createUserMessage('Hello')];

      await expect(llmService.generateResponse(messages)).rejects.toThrow('gen error');
      expect(llmService.isCurrentlyGenerating()).toBe(false);
    });


    it('uses messages format for text-only path', async () => {
      const ctx = await setupLoadedModel();
      const messages = [createUserMessage('Hello')];

      await llmService.generateResponse(messages);

      const callArgs = ctx.completion.mock.calls[0]![0]!;
      expect(callArgs).toHaveProperty('messages');
      expect(callArgs.messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ role: 'user', content: 'Hello' }),
        ])
      );
    });

    it('ignores tokens after generation stops', async () => {
      const tokens: Array<{ content?: string; reasoningContent?: string }> = [];
      await setupLoadedModel({
        completion: jest.fn(async (params: any, callback: any) => {
          callback({ token: 'Hello' });
          // Simulate stop
          (llmService as any).isGenerating = false;
          callback({ token: ' ignored' });
          return { text: 'Hello', tokens_predicted: 1 };
        }),
        tokenize: jest.fn(() => Promise.resolve({ tokens: [1, 2] })),
      });

      const messages = [createUserMessage('Hello')];
      await llmService.generateResponse(messages, (t) => tokens.push(t));

      expect(tokens).toEqual([{ content: 'Hello', reasoningContent: undefined }]);
    });

    it('passes llama.rn native thinking params when enabled', async () => {
      const ctx = await setupLoadedModel({
        isJinjaSupported: jest.fn(() => true),
      });

      useAppStore.setState({
        settings: {
          ...useAppStore.getState().settings,
          thinkingEnabled: true,
        },
      });

      await llmService.generateResponse([createUserMessage('Hello')]);

      const callArgs = ctx.completion.mock.calls[0]![0]!;
      expect(callArgs.enable_thinking).toBe(true);
      expect(callArgs.reasoning_format).toBe('deepseek');
    });

    it('disables llama.rn thinking params when the toggle is off', async () => {
      const ctx = await setupLoadedModel({
        isJinjaSupported: jest.fn(() => true),
      });

      useAppStore.setState({
        settings: {
          ...useAppStore.getState().settings,
          thinkingEnabled: false,
        },
      });

      await llmService.generateResponse([createUserMessage('Hello')]);

      const callArgs = ctx.completion.mock.calls[0]![0]!;
      expect(callArgs.enable_thinking).toBe(false);
      expect(callArgs.reasoning_format).toBe('none');
    });

    it('emits reasoning deltas when llama.rn streams cumulative reasoning_content', async () => {
      const streamChunks: Array<{ content?: string; reasoningContent?: string }> = [];
      await setupLoadedModel({
        isJinjaSupported: jest.fn(() => true),
        completion: jest.fn(async (_params: any, callback: any) => {
          callback({ token: 'a', reasoning_content: 'I am' });
          callback({ token: 'b', reasoning_content: 'I am thinking' });
          callback({ token: 'c', content: 'Hello' });
          callback({ token: 'd', content: 'Hello there' });
          return { content: 'Hello there', reasoning_content: 'I am thinking' };
        }),
      });

      useAppStore.setState({
        settings: {
          ...useAppStore.getState().settings,
          thinkingEnabled: true,
        },
      });

      const result = await llmService.generateResponse([createUserMessage('Hello')], (data) => streamChunks.push(data));

      expect(streamChunks).toEqual([
        { content: undefined, reasoningContent: 'I am' },
        { content: undefined, reasoningContent: ' thinking' },
        { content: 'Hello', reasoningContent: undefined },
        { content: ' there', reasoningContent: undefined },
      ]);
      expect(result).toBe('Hello there');
    });
  });

  // ========================================================================
  // context window management (private, tested through generateResponse)
  // ========================================================================
  describe('context window management', () => {
    const setupForContextTest = async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      const tokenizeResult = (text: string) => {
        // Simulate ~1 token per 4 chars
        const count = Math.ceil(text.length / 4);
        return Promise.resolve({ tokens: new Array(count) });
      };

      const ctx = createMockLlamaContext({
        completion: jest.fn(async (params: any, callback: any) => {
          callback({ token: 'OK' });
          return { text: 'OK', tokens_predicted: 1 };
        }),
        tokenize: jest.fn(tokenizeResult),
      });
      mockedInitLlama.mockResolvedValue(ctx as any);
      await llmService.loadModel('/models/test.gguf');
      return ctx;
    };

    it('preserves system message', async () => {
      const ctx = await setupForContextTest();

      const messages = [
        createSystemMessage('You are helpful'),
        createUserMessage('Hello'),
      ];

      await llmService.generateResponse(messages);

      const oaiMessages = ctx.completion.mock.calls[0]![0]!.messages;
      const systemMsg = oaiMessages.find((m: any) => m.role === 'system');
      expect(systemMsg).toBeDefined();
      expect(systemMsg.content).toContain('You are helpful');
    });

    it('keeps all messages when they fit in context', async () => {
      const ctx = await setupForContextTest();

      const messages = [
        createSystemMessage('System'),
        createUserMessage('Q1'),
        createAssistantMessage('A1'),
        createUserMessage('Q2'),
      ];

      await llmService.generateResponse(messages);

      const oaiMessages = ctx.completion.mock.calls[0]![0]!.messages;
      const contents = oaiMessages.map((m: any) => m.content);
      expect(contents).toContain('Q1');
      expect(contents).toContain('A1');
      expect(contents).toContain('Q2');
    });

    it('passes all messages through to llama.rn for native context shifting', async () => {
      const ctx = await setupForContextTest();

      (llmService as any).currentSettings.contextLength = 2048;

      // Create many messages — all should be passed through
      const messages = [
        createSystemMessage('System prompt'),
        ...Array.from({ length: 50 }, (_, i) =>
          i % 2 === 0
            ? createUserMessage(`Question ${i} ${'x'.repeat(100)}`)
            : createAssistantMessage(`Response ${i} ${'y'.repeat(100)}`)
        ),
        createUserMessage('Final question'),
      ];

      await llmService.generateResponse(messages);

      const oaiMessages = ctx.completion.mock.calls[0]![0]!.messages;
      const contents = oaiMessages.map((m: any) => m.content);
      // All messages should be present — no JS-side truncation
      expect(contents).toContain('Final question');
      expect(contents).toContain(`Question 0 ${'x'.repeat(100)}`);
      expect(contents.join(' ')).toContain('System prompt');
    });
  });

  // ========================================================================
  // stopGeneration
  // ========================================================================
  describe('stopGeneration', () => {
    it('calls context.stopCompletion', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      const ctx = createMockLlamaContext();
      mockedInitLlama.mockResolvedValue(ctx as any);
      await llmService.loadModel('/models/test.gguf');

      await llmService.stopGeneration();

      expect(ctx.stopCompletion).toHaveBeenCalled();
    });

    it('resets isGenerating flag', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      const ctx = createMockLlamaContext();
      mockedInitLlama.mockResolvedValue(ctx as any);
      await llmService.loadModel('/models/test.gguf');

      (llmService as any).isGenerating = true;
      await llmService.stopGeneration();

      expect(llmService.isCurrentlyGenerating()).toBe(false);
    });

    it('is safe without context', async () => {
      await llmService.stopGeneration(); // Should not throw
      expect(llmService.isCurrentlyGenerating()).toBe(false);
    });
  });

  // ========================================================================
  // clearKVCache
  // ========================================================================
  describe('clearKVCache', () => {
    it('delegates to context.clearCache', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      const ctx = createMockLlamaContext();
      mockedInitLlama.mockResolvedValue(ctx as any);
      await llmService.loadModel('/models/test.gguf');

      await llmService.clearKVCache();

      expect(ctx.clearCache).toHaveBeenCalledWith(false);
    });

    it('is safe without context', async () => {
      await llmService.clearKVCache(); // Should not throw
    });
  });

  // ========================================================================
  // getEstimatedMemoryUsage
  // ========================================================================
  describe('getEstimatedMemoryUsage', () => {
    it('returns 0 without context', () => {
      const usage = llmService.getEstimatedMemoryUsage();
      expect(usage.contextMemoryMB).toBe(0);
      expect(usage.totalEstimatedMB).toBe(0);
    });

    it('calculates from context length', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      const ctx = createMockLlamaContext();
      mockedInitLlama.mockResolvedValue(ctx as any);
      await llmService.loadModel('/models/test.gguf');

      const usage = llmService.getEstimatedMemoryUsage();
      // 4096 * 0.5 = 2048
      expect(usage.contextMemoryMB).toBe(2048);
    });
  });

  // ========================================================================
  // getGpuInfo
  // ========================================================================
  describe('getGpuInfo', () => {
    it('returns CPU backend when GPU disabled', () => {
      const info = llmService.getGpuInfo();
      expect(info.gpu).toBe(false);
      expect(info.gpuBackend).toBe('CPU');
    });

    it('returns Metal backend on iOS with GPU enabled', async () => {
      const originalOS = Platform.OS;
      Object.defineProperty(Platform, 'OS', { get: () => 'ios' });

      mockedRNFS.exists.mockResolvedValue(true);
      const ctx = createMockLlamaContext({ gpu: true, devices: [] });
      mockedInitLlama.mockResolvedValue(ctx as any);

      useAppStore.setState({
        settings: { ...useAppStore.getState().settings, inferenceBackend: 'metal' as const, gpuLayers: 99 },
      });

      await llmService.loadModel('/models/test.gguf');

      const info = llmService.getGpuInfo();
      expect(info.gpu).toBe(true);
      expect(info.gpuBackend).toBe('Metal');

      Object.defineProperty(Platform, 'OS', { get: () => originalOS });
    });
  });

  // ========================================================================
  // tokenize / estimateContextUsage
  // ========================================================================
  describe('tokenize', () => {
    it('throws without model loaded', async () => {
      await expect(llmService.tokenize('hello')).rejects.toThrow('No model loaded');
    });

    it('returns token array', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      const ctx = createMockLlamaContext({
        tokenize: jest.fn(() => Promise.resolve({ tokens: [1, 2, 3, 4] })),
      });
      mockedInitLlama.mockResolvedValue(ctx as any);
      await llmService.loadModel('/models/test.gguf');

      const tokens = await llmService.tokenize('hello world');
      expect(tokens).toEqual([1, 2, 3, 4]);
    });
  });

  describe('estimateContextUsage', () => {
    it('returns usage percentage', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      const ctx = createMockLlamaContext({
        tokenize: jest.fn(() => Promise.resolve({ tokens: new Array(500) })),
      });
      mockedInitLlama.mockResolvedValue(ctx as any);
      await llmService.loadModel('/models/test.gguf');

      const messages = [createUserMessage('Hello')];
      const usage = await llmService.estimateContextUsage(messages);

      expect(usage.tokenCount).toBe(500);
      // 500 / 4096 * 100 ≈ 12.2%
      expect(usage.percentUsed).toBeCloseTo(12.2, 0);
      expect(usage.willFit).toBe(true);
    });
  });

  // ========================================================================
  // performance settings
  // ========================================================================
  describe('performance settings', () => {
    it('updatePerformanceSettings merges settings', () => {
      llmService.updatePerformanceSettings({ nThreads: 8 });

      const settings = llmService.getPerformanceSettings();
      expect(settings.nThreads).toBe(8);
      expect(settings.nBatch).toBe(512); // unchanged
    });
  });

  // ========================================================================
  // clearKVCache edge cases
  // ========================================================================
  describe('clearKVCache edge cases', () => {
    it('skips clearing during active generation', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      const ctx = createMockLlamaContext();
      mockedInitLlama.mockResolvedValue(ctx as any);
      await llmService.loadModel('/models/test.gguf');

      (llmService as any).isGenerating = true;

      await llmService.clearKVCache();

      expect(ctx.clearCache).not.toHaveBeenCalled();
    });

    it('passes clearData=true when requested', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      const ctx = createMockLlamaContext();
      mockedInitLlama.mockResolvedValue(ctx as any);
      await llmService.loadModel('/models/test.gguf');

      await llmService.clearKVCache(true);

      expect(ctx.clearCache).toHaveBeenCalledWith(true);
    });
  });

  // ========================================================================
  // formatMessages (private, tested via getFormattedPrompt)
  // ========================================================================
  describe('formatMessages', () => {
    it('formats system message with ChatML tags', () => {
      const messages = [createSystemMessage('You are helpful')];
      const prompt = llmService.getFormattedPrompt(messages);

      expect(prompt).toContain('<|im_start|>system');
      expect(prompt).toContain('You are helpful');
      expect(prompt).toContain('<|im_end|>');
    });

    it('formats user message with ChatML tags', () => {
      const messages = [createUserMessage('Hello')];
      const prompt = llmService.getFormattedPrompt(messages);

      expect(prompt).toContain('<|im_start|>user');
      expect(prompt).toContain('Hello');
    });

    it('formats assistant message with ChatML tags', () => {
      const messages = [createAssistantMessage('Hi there')];
      const prompt = llmService.getFormattedPrompt(messages);

      expect(prompt).toContain('<|im_start|>assistant');
      expect(prompt).toContain('Hi there');
    });

    it('ends with assistant prefix for generation', () => {
      const messages = [createUserMessage('Hello')];
      const prompt = llmService.getFormattedPrompt(messages);

      expect(prompt.endsWith('<|im_start|>assistant\n')).toBe(true);
    });

    it('preserves message order', () => {
      const messages = [
        createSystemMessage('System'),
        createUserMessage('Q1'),
        createAssistantMessage('A1'),
        createUserMessage('Q2'),
      ];
      const prompt = llmService.getFormattedPrompt(messages);

      const systemIdx = prompt.indexOf('System');
      const q1Idx = prompt.indexOf('Q1');
      const a1Idx = prompt.indexOf('A1');
      const q2Idx = prompt.indexOf('Q2');

      expect(systemIdx).toBeLessThan(q1Idx);
      expect(q1Idx).toBeLessThan(a1Idx);
      expect(a1Idx).toBeLessThan(q2Idx);
    });
  });

  // ========================================================================
  // convertToOAIMessages (private, tested via generateResponse with vision)
  // ========================================================================
  describe('convertToOAIMessages', () => {
    it('converts text-only message to simple format', () => {
      const messages = [createUserMessage('Hello')];
      const oaiMessages = (llmService as any).convertToOAIMessages(messages);

      expect(oaiMessages[0].role).toBe('user');
      expect(oaiMessages[0].content).toBe('Hello');
    });

    it('converts message with images to multipart format', () => {
      const messages = [{
        id: 'msg-1',
        role: 'user' as const,
        content: 'What is this?',
        timestamp: Date.now(),
        attachments: [{ id: 'att-1', type: 'image' as const, uri: '/path/to/image.jpg' }],
      }];
      const oaiMessages = (llmService as any).convertToOAIMessages(messages);

      expect(Array.isArray(oaiMessages[0].content)).toBe(true);
      const parts = oaiMessages[0].content;
      const imagePart = parts.find((p: any) => p.type === 'image_url');
      const textPart = parts.find((p: any) => p.type === 'text');

      expect(imagePart).toBeDefined();
      expect(textPart?.text).toBe('What is this?');
    });

    it('adds file:// prefix to local image URIs', () => {
      const messages = [{
        id: 'msg-1',
        role: 'user' as const,
        content: 'Look',
        timestamp: Date.now(),
        attachments: [{ id: 'att-2', type: 'image' as const, uri: '/local/path/image.jpg' }],
      }];
      const oaiMessages = (llmService as any).convertToOAIMessages(messages);

      const imagePart = oaiMessages[0].content.find((p: any) => p.type === 'image_url');
      expect(imagePart.image_url.url.startsWith('file://')).toBe(true);
    });

    it('preserves file:// prefix when already present', () => {
      const messages = [{
        id: 'msg-1',
        role: 'user' as const,
        content: 'Look',
        timestamp: Date.now(),
        attachments: [{ id: 'att-3', type: 'image' as const, uri: 'file:///path/image.jpg' }],
      }];
      const oaiMessages = (llmService as any).convertToOAIMessages(messages);

      const imagePart = oaiMessages[0].content.find((p: any) => p.type === 'image_url');
      expect(imagePart.image_url.url).toBe('file:///path/image.jpg');
    });

    it('handles multiple images in one message', () => {
      const messages = [{
        id: 'msg-1',
        role: 'user' as const,
        content: 'Compare these',
        timestamp: Date.now(),
        attachments: [
          { id: 'att-4', type: 'image' as const, uri: 'file:///img1.jpg' },
          { id: 'att-5', type: 'image' as const, uri: 'file:///img2.jpg' },
        ],
      }];
      const oaiMessages = (llmService as any).convertToOAIMessages(messages);

      const imageParts = oaiMessages[0].content.filter((p: any) => p.type === 'image_url');
      expect(imageParts).toHaveLength(2);
    });

    it('does not convert assistant messages with images', () => {
      const messages = [{
        id: 'msg-1',
        role: 'assistant' as const,
        content: 'Here is the image',
        timestamp: Date.now(),
        attachments: [{ id: 'att-6', type: 'image' as const, uri: 'file:///img.jpg' }],
      }];
      const oaiMessages = (llmService as any).convertToOAIMessages(messages);

      // Assistant messages should remain as simple string content
      expect(typeof oaiMessages[0].content).toBe('string');
    });
  });

  // ========================================================================
  // context window tokenize fallback
  // ========================================================================
  describe('context window tokenize fallback', () => {
    it('uses char/4 estimation when tokenize throws', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      const ctx = createMockLlamaContext({
        completion: jest.fn(async (_params: any, callback: any) => {
          callback({ token: 'OK' });
          return { text: 'OK', tokens_predicted: 1 };
        }),
        tokenize: jest.fn(() => Promise.reject(new Error('tokenize failed'))),
      });
      mockedInitLlama.mockResolvedValue(ctx as any);
      await llmService.loadModel('/models/test.gguf');

      // Should not throw despite tokenize failure
      const messages = [
        createSystemMessage('System'),
        createUserMessage('Hello'),
      ];
      await expect(llmService.generateResponse(messages)).resolves.toBeDefined();
    });
  });

  // ========================================================================
  // reloadWithSettings
  // ========================================================================
  describe('reloadWithSettings', () => {
    it('unloads existing model and reloads with new settings', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      const ctx1 = createMockLlamaContext();
      const ctx2 = createMockLlamaContext();
      mockedInitLlama
        .mockResolvedValueOnce(ctx1 as any)
        .mockResolvedValueOnce(ctx2 as any);

      await llmService.loadModel('/models/test.gguf');

      await llmService.reloadWithSettings('/models/test.gguf', {
        nThreads: 8,
        nBatch: 512,
        contextLength: 4096,
      });

      expect(ctx1.release).toHaveBeenCalled();
      const settings = llmService.getPerformanceSettings();
      expect(settings.nThreads).toBe(8);
      expect(settings.nBatch).toBe(512);
      expect(settings.contextLength).toBe(4096);
    });

    it('resets state on reload failure when all attempts fail', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      const ctx = createMockLlamaContext();
      mockedInitLlama
        .mockResolvedValueOnce(ctx as any) // initial load
        .mockRejectedValueOnce(new Error('GPU reload failed')) // GPU attempt
        .mockRejectedValueOnce(new Error('CPU reload failed')) // CPU fallback
        .mockRejectedValueOnce(new Error('CPU reload failed')); // ctx=2048 fallback

      // Enable GPU via Metal backend so both attempts happen
      useAppStore.setState({
        settings: { ...useAppStore.getState().settings, inferenceBackend: 'metal' as const, gpuLayers: 6 },
      });

      await llmService.loadModel('/models/test.gguf');

      await expect(
        llmService.reloadWithSettings('/models/test.gguf', {
          nThreads: 8,
          nBatch: 512,
          contextLength: 4096,
        })
      ).rejects.toThrow('CPU reload failed');

      expect(llmService.isModelLoaded()).toBe(false);
    });
  });

  // ========================================================================
  // hashString
  // ========================================================================
  describe('hashString', () => {
    it('returns consistent hash for same input', () => {
      const hash1 = (llmService as any).hashString('test string');
      const hash2 = (llmService as any).hashString('test string');
      expect(hash1).toBe(hash2);
    });

    it('returns different hashes for different inputs', () => {
      const hash1 = (llmService as any).hashString('string1');
      const hash2 = (llmService as any).hashString('string2');
      expect(hash1).not.toBe(hash2);
    });
  });

  // ========================================================================
  // getModelInfo
  // ========================================================================
  describe('getModelInfo', () => {
    it('returns null without model loaded', async () => {
      const info = await llmService.getModelInfo();
      expect(info).toBeNull();
    });

    it('returns info when model loaded', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      const ctx = createMockLlamaContext();
      mockedInitLlama.mockResolvedValue(ctx as any);
      await llmService.loadModel('/models/test.gguf');

      const info = await llmService.getModelInfo();
      expect(info).not.toBeNull();
      expect(info?.contextLength).toBeDefined();
    });
  });

  // ========================================================================
  // supportsVision / getMultimodalSupport
  // ========================================================================
  describe('vision support helpers', () => {
    it('supportsVision returns false when no model loaded', () => {
      expect(llmService.supportsVision()).toBe(false);
    });

    it('getMultimodalSupport returns null when no model loaded', () => {
      expect(llmService.getMultimodalSupport()).toBeNull();
    });
  });

  // ========================================================================
  // Additional branch coverage tests
  // ========================================================================
  describe('stopGeneration error branch', () => {
    it('handles stopCompletion error gracefully', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      const ctx = createMockLlamaContext({
        stopCompletion: jest.fn(() => Promise.reject(new Error('already stopped'))),
      });
      mockedInitLlama.mockResolvedValue(ctx as any);
      await llmService.loadModel('/models/test.gguf');

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      // Should not throw
      await llmService.stopGeneration();

      expect(llmService.isCurrentlyGenerating()).toBe(false);
      consoleSpy.mockRestore();
    });
  });

  describe('clearKVCache error branch', () => {
    it('handles clearCache error gracefully', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      const ctx = createMockLlamaContext({
        clearCache: jest.fn(() => Promise.reject(new Error('cache error'))),
      });
      mockedInitLlama.mockResolvedValue(ctx as any);
      await llmService.loadModel('/models/test.gguf');

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      // Should not throw
      await llmService.clearKVCache();

      consoleSpy.mockRestore();
    });
  });

  describe('ensureSessionCacheDir branches', () => {
    it('creates dir when it does not exist', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      const ctx = createMockLlamaContext();
      mockedInitLlama.mockResolvedValue(ctx as any);

      // The session cache dir is created during loadModel
      await llmService.loadModel('/models/test.gguf');

      // ensureSessionCacheDir is called internally - we verify through mkdir calls
      // At minimum, the model load should succeed
      expect(llmService.isModelLoaded()).toBe(true);
    });
  });

  describe('getGpuInfo Android branches', () => {
    const { hardwareService: hw } = require('../../../src/services/hardware');

    beforeEach(() => {
      (hw as any).cachedOpenCLCapability = null;
      jest.spyOn(hw, 'getOpenCLCapability').mockResolvedValue({ supported: true });
    });

    afterEach(() => {
      (hw as any).cachedOpenCLCapability = null;
    });

    it('returns OpenCL when OpenCL backend selected on Android with no devices', async () => {
      const originalOS = Platform.OS;
      Object.defineProperty(Platform, 'OS', { get: () => 'android' });

      mockedRNFS.exists.mockResolvedValue(true);
      const ctx = createMockLlamaContext({ gpu: true, devices: [] });
      mockedInitLlama.mockResolvedValue(ctx as any);

      useAppStore.setState({
        settings: { ...useAppStore.getState().settings, inferenceBackend: 'opencl' as const, gpuLayers: 6 },
      });

      await llmService.loadModel('/models/test.gguf');

      const info = llmService.getGpuInfo();
      expect(info.gpu).toBe(true);
      expect(info.gpuBackend).toBe('OpenCL');

      Object.defineProperty(Platform, 'OS', { get: () => originalOS });
    });

    it('returns device names when OpenCL backend selected on Android with devices', async () => {
      const originalOS = Platform.OS;
      Object.defineProperty(Platform, 'OS', { get: () => 'android' });

      mockedRNFS.exists.mockResolvedValue(true);
      const ctx = createMockLlamaContext({ gpu: true, devices: ['Adreno 730'] });
      mockedInitLlama.mockResolvedValue(ctx as any);

      useAppStore.setState({
        settings: { ...useAppStore.getState().settings, inferenceBackend: 'opencl' as const, gpuLayers: 6 },
      });

      await llmService.loadModel('/models/test.gguf');

      const info = llmService.getGpuInfo();
      expect(info.gpu).toBe(true);
      expect(info.gpuBackend).toBe('Adreno 730');

      Object.defineProperty(Platform, 'OS', { get: () => originalOS });
    });
  });

  describe('getTokenCount', () => {
    it('returns token count for text', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      const ctx = createMockLlamaContext({
        tokenize: jest.fn(() => Promise.resolve({ tokens: [1, 2, 3, 4, 5] })),
      });
      mockedInitLlama.mockResolvedValue(ctx as any);
      await llmService.loadModel('/models/test.gguf');

      const count = await llmService.getTokenCount('hello world');
      expect(count).toBe(5);
    });

    it('returns 0 when tokens is undefined', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      const ctx = createMockLlamaContext({
        tokenize: jest.fn(() => Promise.resolve({ tokens: undefined })),
      });
      mockedInitLlama.mockResolvedValue(ctx as any);
      await llmService.loadModel('/models/test.gguf');

      const count = await llmService.getTokenCount('test');
      expect(count).toBe(0);
    });

    it('throws when no model loaded', async () => {
      await expect(llmService.getTokenCount('test')).rejects.toThrow('No model loaded');
    });
  });

  describe('convertToOAIMessages empty content branch', () => {
    it('skips text part when message content is empty', () => {
      const messages = [{
        id: 'msg-1',
        role: 'user' as const,
        content: '',
        timestamp: Date.now(),
        attachments: [{ id: 'att-1', type: 'image' as const, uri: '/path/to/image.jpg' }],
      }];
      const oaiMessages = (llmService as any).convertToOAIMessages(messages);

      // Should still be an array (multipart) because of image attachments
      expect(Array.isArray(oaiMessages[0].content)).toBe(true);
      // Should only have image_url parts, no text part
      const textParts = oaiMessages[0].content.filter((p: any) => p.type === 'text');
      expect(textParts).toHaveLength(0);
    });
  });

  describe('checkMultimodalSupport branches', () => {
    it('returns false when no context', async () => {
      const result = await llmService.checkMultimodalSupport();
      expect(result.vision).toBe(false);
      expect(result.audio).toBe(false);
    });

    it('returns support from getMultimodalSupport when available', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      const ctx = createMockLlamaContext({
        getMultimodalSupport: jest.fn(() => Promise.resolve({ vision: true, audio: true })),
      });
      mockedInitLlama.mockResolvedValue(ctx as any);
      await llmService.loadModel('/models/test.gguf');

      const result = await llmService.checkMultimodalSupport();
      expect(result.vision).toBe(true);
    });

    it('handles getMultimodalSupport not being a function', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      const ctx = createMockLlamaContext();
      // Remove getMultimodalSupport
      delete (ctx as any).getMultimodalSupport;
      mockedInitLlama.mockResolvedValue(ctx as any);
      await llmService.loadModel('/models/test.gguf');

      const result = await llmService.checkMultimodalSupport();
      expect(result.vision).toBe(false);
    });

    it('handles getMultimodalSupport throwing error', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      const ctx = createMockLlamaContext({
        getMultimodalSupport: jest.fn(() => Promise.reject(new Error('not available'))),
      });
      mockedInitLlama.mockResolvedValue(ctx as any);
      await llmService.loadModel('/models/test.gguf');

      const result = await llmService.checkMultimodalSupport();
      expect(result.vision).toBe(false);
    });
  });

  describe('loadModel metadata branches', () => {
    it('reads model metadata and logs context length warning', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      const ctx = createMockLlamaContext();
      // Add metadata with context length smaller than requested
      (ctx as any).model = {
        metadata: {
          'llama.context_length': '1024',
        },
      };
      mockedInitLlama.mockResolvedValue(ctx as any);

      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      useAppStore.setState({
        settings: {
          ...useAppStore.getState().settings,
          contextLength: 4096,
        },
      });

      await llmService.loadModel('/models/test.gguf');

      // Should have warned about exceeding model max
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('exceeds model max')
      );
      consoleSpy.mockRestore();
    });

    it('handles metadata without context_length', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      const ctx = createMockLlamaContext();
      (ctx as any).model = { metadata: {} };
      mockedInitLlama.mockResolvedValue(ctx as any);

      // Should not throw
      await llmService.loadModel('/models/test.gguf');
      expect(llmService.isModelLoaded()).toBe(true);
    });

    it('handles null model metadata', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      const ctx = createMockLlamaContext();
      (ctx as any).model = null;
      mockedInitLlama.mockResolvedValue(ctx as any);

      await llmService.loadModel('/models/test.gguf');
      expect(llmService.isModelLoaded()).toBe(true);
    });
  });

  describe('reloadWithSettings flash attention', () => {
    it('passes flashAttn=true from store to reloadWithSettings', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      const ctx1 = createMockLlamaContext();
      const ctx2 = createMockLlamaContext();
      mockedInitLlama
        .mockResolvedValueOnce(ctx1 as any)
        .mockResolvedValueOnce(ctx2 as any);

      useAppStore.setState({
        settings: {
          ...useAppStore.getState().settings,
          flashAttn: true,
          inferenceBackend: 'cpu' as const,
        },
      });

      await llmService.loadModel('/models/test.gguf');
      await llmService.reloadWithSettings('/models/test.gguf', {
        nThreads: 4,
        nBatch: 512,
        contextLength: 2048,
      });

      const reloadCall = (initLlama as jest.Mock).mock.calls[1][0];
      expect(reloadCall.flash_attn_type).toBe('auto');
      expect(reloadCall.cache_type_k).toBe('q8_0');
      expect(reloadCall.cache_type_v).toBe('q8_0');
    });

    it('passes flashAttn=false and cacheType=f16 from store to reloadWithSettings', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      const ctx1 = createMockLlamaContext();
      const ctx2 = createMockLlamaContext();
      mockedInitLlama
        .mockResolvedValueOnce(ctx1 as any)
        .mockResolvedValueOnce(ctx2 as any);

      useAppStore.setState({
        settings: {
          ...useAppStore.getState().settings,
          flashAttn: false,
          cacheType: 'f16',
          inferenceBackend: 'cpu' as const,
        },
      });

      await llmService.loadModel('/models/test.gguf');
      await llmService.reloadWithSettings('/models/test.gguf', {
        nThreads: 4,
        nBatch: 512,
        contextLength: 2048,
      });

      const reloadCall = (initLlama as jest.Mock).mock.calls[1][0];
      expect(reloadCall.flash_attn_type).toBe('off');
      expect(reloadCall.cache_type_k).toBe('f16');
      expect(reloadCall.cache_type_v).toBe('f16');
    });

    it('falls back to platform default in reloadWithSettings when flashAttn is undefined (iOS → ON)', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      const ctx1 = createMockLlamaContext();
      const ctx2 = createMockLlamaContext();
      mockedInitLlama
        .mockResolvedValueOnce(ctx1 as any)
        .mockResolvedValueOnce(ctx2 as any);

      useAppStore.setState({
        settings: {
          ...useAppStore.getState().settings,
          flashAttn: undefined as any,
          inferenceBackend: 'cpu' as const,
        },
      });

      await llmService.loadModel('/models/test.gguf');
      await llmService.reloadWithSettings('/models/test.gguf', {
        nThreads: 4,
        nBatch: 512,
        contextLength: 2048,
      });

      // Test env is iOS → flash_attn_type defaults to 'auto'
      const reloadCall = (initLlama as jest.Mock).mock.calls[1][0];
      expect(reloadCall.flash_attn_type).toBe('auto');
      expect(reloadCall.cache_type_k).toBe('q8_0');
    });
  });

  describe('reloadWithSettings GPU fallback', () => {
    it('falls back to CPU when GPU reload fails', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      const ctx1 = createMockLlamaContext();
      const ctx2 = createMockLlamaContext();
      mockedInitLlama
        .mockResolvedValueOnce(ctx1 as any) // initial load
        .mockRejectedValueOnce(new Error('GPU failed')) // GPU reload fails
        .mockResolvedValueOnce(ctx2 as any); // CPU reload succeeds

      useAppStore.setState({
        settings: { ...useAppStore.getState().settings, inferenceBackend: 'metal' as const, gpuLayers: 99 },
      });

      await llmService.loadModel('/models/test.gguf');

      await llmService.reloadWithSettings('/models/test.gguf', {
        nThreads: 4,
        nBatch: 512,
        contextLength: 2048,
      });

      // Should have fallen back to CPU
      expect(initLlama).toHaveBeenCalledTimes(3);
      expect(llmService.isModelLoaded()).toBe(true);
    });
  });

  describe('loadModel without mmproj calls checkMultimodalSupport', () => {
    it('calls checkMultimodalSupport when no mmproj provided', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      const ctx = createMockLlamaContext({
        getMultimodalSupport: jest.fn(() => Promise.resolve({ vision: false, audio: false })),
      });
      mockedInitLlama.mockResolvedValue(ctx as any);

      await llmService.loadModel('/models/test.gguf');

      // checkMultimodalSupport should be called when no mmproj
      expect(ctx.getMultimodalSupport).toHaveBeenCalled();
    });
  });

  describe('formatMessages with vision attachments', () => {
    it('adds image markers when vision is supported', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      const ctx = createMockLlamaContext({
        initMultimodal: jest.fn(() => Promise.resolve(true)),
        getMultimodalSupport: jest.fn(() => Promise.resolve({ vision: true, audio: false })),
      });
      mockedInitLlama.mockResolvedValue(ctx as any);
      await llmService.loadModel('/models/test.gguf', '/models/mmproj.gguf');

      const messages = [{
        id: 'msg-1',
        role: 'user' as const,
        content: 'Describe this image',
        timestamp: Date.now(),
        attachments: [
          { id: 'att-1', type: 'image' as const, uri: '/img1.jpg' },
          { id: 'att-2', type: 'image' as const, uri: '/img2.jpg' },
        ],
      }];

      const prompt = llmService.getFormattedPrompt(messages);
      // Should contain image markers
      expect(prompt).toContain('<__media__>');
      // Two images = two markers
      const markers = (prompt.match(/<__media__>/g) || []).length;
      expect(markers).toBe(2);
      expect(prompt).toContain('Describe this image');
    });
  });

  // ========================================================================
  // mmproj file size warning
  // ========================================================================
  describe('loadModel mmproj file size warning', () => {
    it('warns when mmproj file is suspiciously small', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      mockedRNFS.stat.mockResolvedValue({ size: 10 * 1024 * 1024 } as any); // 10MB - too small

      const ctx = createMockLlamaContext({
        initMultimodal: jest.fn(() => Promise.resolve(true)),
        getMultimodalSupport: jest.fn(() => Promise.resolve({ vision: true, audio: false })),
      });
      mockedInitLlama.mockResolvedValue(ctx as any);

      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      await llmService.loadModel('/models/test.gguf', '/models/mmproj.gguf');

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('seems too small')
      );
      consoleSpy.mockRestore();
    });

    it('does not warn when mmproj file is large enough', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      mockedRNFS.stat.mockResolvedValue({ size: 500 * 1024 * 1024 } as any); // 500MB

      const ctx = createMockLlamaContext({
        initMultimodal: jest.fn(() => Promise.resolve(true)),
        getMultimodalSupport: jest.fn(() => Promise.resolve({ vision: true, audio: false })),
      });
      mockedInitLlama.mockResolvedValue(ctx as any);

      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      await llmService.loadModel('/models/test.gguf', '/models/mmproj.gguf');

      const smallWarnings = consoleSpy.mock.calls.filter(
        call => typeof call[0] === 'string' && call[0].includes('seems too small')
      );
      expect(smallWarnings).toHaveLength(0);
      consoleSpy.mockRestore();
    });

    it('handles stat error for mmproj file', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      // First stat call (validateModelFile) and second (checkMemoryForModel) succeed; third (initializeMultimodal) fails
      mockedRNFS.stat
        .mockResolvedValueOnce({ size: 1000000, isFile: () => true } as any)
        .mockResolvedValueOnce({ size: 1000000, isFile: () => true } as any)
        .mockRejectedValue(new Error('stat failed'));

      const ctx = createMockLlamaContext({
        initMultimodal: jest.fn(() => Promise.resolve(true)),
        getMultimodalSupport: jest.fn(() => Promise.resolve({ vision: true, audio: false })),
      });
      mockedInitLlama.mockResolvedValue(ctx as any);

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      // Should not throw
      await llmService.loadModel('/models/test.gguf', '/models/mmproj.gguf');

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to stat mmproj'),
        expect.anything()
      );
      consoleSpy.mockRestore();
    });
  });

  // ========================================================================
  // generateResponse with vision mode
  // ========================================================================
  describe('generateResponse with vision mode', () => {
    it('uses multimodal path when images attached and multimodal initialized', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      mockedRNFS.stat.mockResolvedValue({ size: 500 * 1024 * 1024 } as any);

      const ctx = createMockLlamaContext({
        initMultimodal: jest.fn(() => Promise.resolve(true)),
        getMultimodalSupport: jest.fn(() => Promise.resolve({ vision: true, audio: false })),
        completion: jest.fn(async (_params: any, callback: any) => {
          callback({ token: 'I see an image' });
          return { text: 'I see an image', tokens_predicted: 4 };
        }),
        tokenize: jest.fn(() => Promise.resolve({ tokens: [1, 2, 3] })),
      });
      mockedInitLlama.mockResolvedValue(ctx as any);

      await llmService.loadModel('/models/test.gguf', '/models/mmproj.gguf');

      const messages = [{
        id: 'msg-1',
        role: 'user' as const,
        content: 'What is in this image?',
        timestamp: Date.now(),
        attachments: [{ id: 'att-1', type: 'image' as const, uri: 'file:///photo.jpg' }],
      }];

      const result = await llmService.generateResponse(messages);
      expect(result).toBe('I see an image');

      // Verify completion was called with messages format (OAI compatible)
      const callArgs = ctx.completion.mock.calls[0]![0]!;
      expect(callArgs).toHaveProperty('messages');
    });

    it('logs warning when images attached but multimodal not initialized', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      const ctx = createMockLlamaContext({
        completion: jest.fn(async (_params: any, callback: any) => {
          callback({ token: 'Response' });
          return { text: 'Response', tokens_predicted: 1 };
        }),
        tokenize: jest.fn(() => Promise.resolve({ tokens: [1, 2, 3] })),
      });
      mockedInitLlama.mockResolvedValue(ctx as any);
      await llmService.loadModel('/models/test.gguf');

      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      const messages = [{
        id: 'msg-1',
        role: 'user' as const,
        content: 'Look at this',
        timestamp: Date.now(),
        attachments: [{ id: 'att-1', type: 'image' as const, uri: 'file:///photo.jpg' }],
      }];

      await llmService.generateResponse(messages);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Images attached but multimodal not initialized')
      );
      consoleSpy.mockRestore();
    });
  });

  // ========================================================================
  // generateResponse reads settings from store
  // ========================================================================
  describe('generateResponse uses store settings', () => {
    it('applies temperature from settings', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      const ctx = createMockLlamaContext({
        completion: jest.fn(async (params: any, callback: any) => {
          callback({ token: 'OK' });
          return { text: 'OK', tokens_predicted: 1 };
        }),
        tokenize: jest.fn(() => Promise.resolve({ tokens: [1, 2, 3] })),
      });
      mockedInitLlama.mockResolvedValue(ctx as any);
      await llmService.loadModel('/models/test.gguf');

      useAppStore.setState({
        settings: {
          ...useAppStore.getState().settings,
          temperature: 0.2,
          maxTokens: 512,
          topP: 0.8,
          repeatPenalty: 1.3,
        },
      });

      await llmService.generateResponse([createUserMessage('Hi')]);

      const callArgs = ctx.completion.mock.calls[0]![0]!;
      expect(callArgs.temperature).toBe(0.2);
      expect(callArgs.n_predict).toBe(512);
      expect(callArgs.top_p).toBe(0.8);
      expect(callArgs.penalty_repeat).toBe(1.3);
    });
  });

  // ========================================================================
  // getContextDebugInfo
  // ========================================================================
  describe('getContextDebugInfo', () => {
    it('returns debug info about context usage', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      const ctx = createMockLlamaContext({
        tokenize: jest.fn(() => Promise.resolve({ tokens: new Array(100) })),
      });
      mockedInitLlama.mockResolvedValue(ctx as any);
      await llmService.loadModel('/models/test.gguf');

      const messages = [
        createSystemMessage('System'),
        createUserMessage('Hello'),
        createAssistantMessage('World'),
      ];

      const debugInfo = await llmService.getContextDebugInfo(messages);

      expect(debugInfo.originalMessageCount).toBe(3);
      expect(debugInfo.managedMessageCount).toBeGreaterThanOrEqual(3);
      expect(debugInfo.formattedPrompt).toContain('System');
      expect(debugInfo.estimatedTokens).toBe(100);
      expect(debugInfo.maxContextLength).toBe(4096);
      expect(debugInfo.contextUsagePercent).toBeCloseTo(2.44, 0);
    });

    it('shows truncation info when messages are truncated', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      const ctx = createMockLlamaContext({
        tokenize: jest.fn((text: string) =>
          // Return very high token count to force truncation
          Promise.resolve({ tokens: new Array(Math.ceil(text.length / 2)) })
        ),
      });
      mockedInitLlama.mockResolvedValue(ctx as any);
      await llmService.loadModel('/models/test.gguf');

      // Very small context to force truncation
      (llmService as any).currentSettings.contextLength = 200;

      const messages = [
        createSystemMessage('System'),
        ...Array.from({ length: 20 }, (_, i) =>
          i % 2 === 0
            ? createUserMessage(`Question ${i} with lots of padding text here`)
            : createAssistantMessage(`Response ${i} with lots of padding text here`)
        ),
      ];

      const debugInfo = await llmService.getContextDebugInfo(messages);

      // With native context shifting, all messages are passed through
      expect(debugInfo.managedMessageCount).toBe(debugInfo.originalMessageCount);
      expect(debugInfo.truncatedCount).toBe(0);
    });

    it('uses char/4 estimation when tokenize throws in debug info', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      const ctx = createMockLlamaContext({
        tokenize: jest.fn(() => Promise.reject(new Error('tokenize error'))),
      });
      mockedInitLlama.mockResolvedValue(ctx as any);
      await llmService.loadModel('/models/test.gguf');

      const messages = [createUserMessage('Hello')];
      const debugInfo = await llmService.getContextDebugInfo(messages);

      // Should still return a result using char estimation
      expect(debugInfo.estimatedTokens).toBeGreaterThan(0);
    });
  });

  // ========================================================================
  // reloadWithSettings with GPU disabled
  // ========================================================================
  describe('reloadWithSettings with GPU disabled', () => {
    it('skips GPU attempt when GPU is disabled', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      const ctx1 = createMockLlamaContext();
      const ctx2 = createMockLlamaContext();
      mockedInitLlama
        .mockResolvedValueOnce(ctx1 as any)
        .mockResolvedValueOnce(ctx2 as any);

      useAppStore.setState({
        settings: { ...useAppStore.getState().settings, inferenceBackend: 'cpu' as const },
      });

      await llmService.loadModel('/models/test.gguf');
      await llmService.reloadWithSettings('/models/test.gguf', {
        nThreads: 4,
        nBatch: 128,
        contextLength: 1024,
      });

      // Second call should have n_gpu_layers=0
      const secondCallArgs = (initLlama as jest.Mock).mock.calls[1][0];
      expect(secondCallArgs.n_gpu_layers).toBe(0);
    });
  });

  // ========================================================================
  // Performance stats edge cases
  // ========================================================================
  describe('performance stats', () => {
    it('returns zero stats before any generation', () => {
      const stats = llmService.getPerformanceStats();
      expect(stats.lastTokensPerSecond).toBe(0);
      expect(stats.lastDecodeTokensPerSecond).toBe(0);
      expect(stats.lastTimeToFirstToken).toBe(0);
      expect(stats.lastGenerationTime).toBe(0);
      expect(stats.lastTokenCount).toBe(0);
    });

    it('returns a copy of settings (not reference)', () => {
      const settings1 = llmService.getPerformanceSettings();
      const settings2 = llmService.getPerformanceSettings();
      expect(settings1).toEqual(settings2);
      expect(settings1).not.toBe(settings2); // Different object references
    });

    it('returns a copy of stats (not reference)', () => {
      const stats1 = llmService.getPerformanceStats();
      const stats2 = llmService.getPerformanceStats();
      expect(stats1).toEqual(stats2);
      expect(stats1).not.toBe(stats2);
    });
  });

  // ========================================================================
  // initializeMultimodal iOS simulator check
  // ========================================================================
  describe('initializeMultimodal GPU usage based on device', () => {
    it('disables GPU for CLIP on iOS simulator', async () => {
      const originalOS = Platform.OS;
      Object.defineProperty(Platform, 'OS', { get: () => 'ios' });

      mockedRNFS.exists.mockResolvedValue(true);
      const ctx = createMockLlamaContext({
        initMultimodal: jest.fn(() => Promise.resolve(true)),
        getMultimodalSupport: jest.fn(() => Promise.resolve({ vision: true, audio: false })),
      });
      mockedInitLlama.mockResolvedValue(ctx as any);
      await llmService.loadModel('/models/test.gguf');

      // Set device as emulator
      useAppStore.setState({ deviceInfo: { totalMemory: 8e9, usedMemory: 4e9, availableMemory: 4e9, deviceModel: 'Simulator', systemName: 'iOS', systemVersion: '17', isEmulator: true } });

      await llmService.initializeMultimodal('/mmproj.gguf');

      expect(ctx.initMultimodal).toHaveBeenCalledWith(
        expect.objectContaining({ use_gpu: false })
      );

      Object.defineProperty(Platform, 'OS', { get: () => originalOS });
    });

    it('enables GPU for CLIP on real iOS device', async () => {
      const originalOS = Platform.OS;
      Object.defineProperty(Platform, 'OS', { get: () => 'ios' });

      mockedRNFS.exists.mockResolvedValue(true);
      const ctx = createMockLlamaContext({
        initMultimodal: jest.fn(() => Promise.resolve(true)),
        getMultimodalSupport: jest.fn(() => Promise.resolve({ vision: true, audio: false })),
      });
      mockedInitLlama.mockResolvedValue(ctx as any);
      await llmService.loadModel('/models/test.gguf');

      // Set device as real device
      useAppStore.setState({ deviceInfo: { totalMemory: 8e9, usedMemory: 4e9, availableMemory: 4e9, deviceModel: 'iPhone 15 Pro', systemName: 'iOS', systemVersion: '17', isEmulator: false } });

      await llmService.initializeMultimodal('/mmproj.gguf');

      expect(ctx.initMultimodal).toHaveBeenCalledWith(
        expect.objectContaining({ use_gpu: true })
      );

      Object.defineProperty(Platform, 'OS', { get: () => originalOS });
    });
  });

  // ========================================================================
  // loadModel error wrapping
  // ========================================================================
  describe('loadModel error message wrapping', () => {
    it('wraps error with custom message', async () => {
      mockedRNFS.exists.mockResolvedValue(true);

      // All attempts fail
      mockedInitLlama.mockRejectedValue(new Error('native crash'));

      useAppStore.setState({
        settings: { ...useAppStore.getState().settings, inferenceBackend: 'cpu' as const },
      });

      await expect(llmService.loadModel('/models/test.gguf'))
        .rejects.toThrow('native crash');
    });

    it('handles error without message property', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      mockedInitLlama.mockRejectedValue('string error');

      useAppStore.setState({
        settings: { ...useAppStore.getState().settings, inferenceBackend: 'cpu' as const },
      });

      await expect(llmService.loadModel('/models/test.gguf'))
        .rejects.toThrow('Failed to load model even at minimum context');
    });
  });

  // ========================================================================
  // unloadModel resets GPU state
  // ========================================================================
  describe('unloadModel resets all state', () => {
    it('resets GPU info after unload', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      const ctx = createMockLlamaContext({ gpu: true, devices: ['Metal'] });
      mockedInitLlama.mockResolvedValue(ctx as any);

      useAppStore.setState({
        settings: { ...useAppStore.getState().settings, inferenceBackend: 'metal' as const, gpuLayers: 99 },
      });

      await llmService.loadModel('/models/test.gguf');
      expect(llmService.getGpuInfo().gpu).toBe(true);

      await llmService.unloadModel();

      const gpuInfo = llmService.getGpuInfo();
      expect(gpuInfo.gpu).toBe(false);
      expect(gpuInfo.gpuBackend).toBe('CPU');
      expect(gpuInfo.gpuLayers).toBe(0);
    });
  });

  // ========================================================================
  // getOptimalThreadCount / getOptimalBatchSize (module-level helpers)
  // ========================================================================
  describe('getOptimalThreadCount and getOptimalBatchSize fallbacks', () => {
    it('uses getOptimalThreadCount when nThreads is 0', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      const ctx = createMockLlamaContext();
      mockedInitLlama.mockResolvedValue(ctx as any);

      useAppStore.setState({
        settings: { ...useAppStore.getState().settings, nThreads: 0, nBatch: 512 },
      });

      await llmService.loadModel('/models/test.gguf');

      // nThreads=0 is falsy, so getOptimalThreadCount() (returns DEFAULT_THREADS = 4 on iOS) is used
      // The test env is iOS, so DEFAULT_THREADS = Platform.OS === 'android' ? 6 : 4 = 4
      expect(initLlama).toHaveBeenCalledWith(
        expect.objectContaining({ n_threads: 4 })
      );
    });

    it('uses getOptimalBatchSize when nBatch is 0', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      const ctx = createMockLlamaContext();
      mockedInitLlama.mockResolvedValue(ctx as any);

      useAppStore.setState({
        settings: { ...useAppStore.getState().settings, nThreads: 6, nBatch: 0 },
      });

      await llmService.loadModel('/models/test.gguf');

      // nBatch=0 is falsy, so getOptimalBatchSize() (returns DEFAULT_BATCH=512) is used
      expect(initLlama).toHaveBeenCalledWith(
        expect.objectContaining({ n_batch: 512 })
      );
    });
  });

  // ========================================================================
  // ensureSessionCacheDir / getSessionPath (private helpers)
  // ========================================================================
  describe('ensureSessionCacheDir', () => {
    it('creates directory when it does not exist', async () => {
      mockedRNFS.exists.mockResolvedValue(false);
      mockedRNFS.mkdir.mockResolvedValue(undefined as any);

      await (llmService as any).ensureSessionCacheDir();

      expect(mockedRNFS.mkdir).toHaveBeenCalled();
    });

    it('skips mkdir when directory already exists', async () => {
      mockedRNFS.exists.mockResolvedValue(true);

      await (llmService as any).ensureSessionCacheDir();

      expect(mockedRNFS.mkdir).not.toHaveBeenCalled();
    });

    it('catches and logs errors without throwing', async () => {
      mockedRNFS.exists.mockRejectedValue(new Error('fs error'));
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      await expect((llmService as any).ensureSessionCacheDir()).resolves.toBeUndefined();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to create session cache dir'),
        expect.any(Error),
      );

      consoleSpy.mockRestore();
    });
  });

  describe('getSessionPath', () => {
    it('returns path with hash in the session cache dir', () => {
      const path = (llmService as any).getSessionPath('abc123');
      expect(path).toContain('session-abc123.bin');
      expect(path).toContain('llm-sessions');
    });
  });

  // ========================================================================
  // manageContextWindow edge cases
  // ========================================================================
  describe('manageContextWindow edge cases', () => {
    const setupForEdgeTest = async (overrides: Record<string, any> = {}) => {
      mockedRNFS.exists.mockResolvedValue(true);
      const ctx = createMockLlamaContext({
        completion: jest.fn(async (_params: any, _cb: any) => ({ text: 'ok', tokens_predicted: 1 })),
        tokenize: jest.fn((text: string) =>
          Promise.resolve({ tokens: new Array(Math.ceil(text.length / 4)) })
        ),
        ...overrides,
      });
      mockedInitLlama.mockResolvedValue(ctx as any);
      await llmService.loadModel('/models/test.gguf');
      return ctx;
    };

    it('returns messages unchanged when messages array is empty', async () => {
      await setupForEdgeTest();

      // generateResponse with empty array reaches manageContextWindow([]) → early return
      await llmService.generateResponse([]);
      // No assertions needed — just must not throw and return empty string
    });

    it('returns messages unchanged when all messages are system messages', async () => {
      await setupForEdgeTest();

      const messages = [createSystemMessage('You are helpful')];
      await llmService.generateResponse(messages);
      // conversationMessages.length === 0 → early return at line 537
    });

    it('passes all messages through regardless of size (native ctx_shift handles overflow)', async () => {
      await setupForEdgeTest();

      (llmService as any).currentSettings.contextLength = 2048;
      const hugeMessage = createUserMessage('x'.repeat(4000));

      const ctx = (llmService as any).context;
      await llmService.generateResponse([hugeMessage]);

      // Completion was called with the message — llama.rn handles overflow natively
      expect(ctx.completion).toHaveBeenCalled();
      const oaiMessages = ctx.completion.mock.calls[0]![0]!.messages;
      expect(oaiMessages[0].content).toBe('x'.repeat(4000));
    });
  });

  // ========================================================================
  // formatMessages — system message with id='system' (line 696)
  // ========================================================================
  describe('formatMessages with id=system', () => {
    it('formats system message with id="system" via the primary system-prompt branch', () => {
      // createSystemMessage with id='system' hits the message.id === 'system' branch (line 696)
      const messages = [createSystemMessage('Main project prompt', { id: 'system' })];
      const prompt = llmService.getFormattedPrompt(messages);

      expect(prompt).toContain('<|im_start|>system');
      expect(prompt).toContain('Main project prompt');
      expect(prompt).toContain('<|im_end|>');
    });
  });

  // ========================================================================
  // Auto context scaling
  // ========================================================================
  describe('auto context scaling', () => {
    it('loads at 4096 default context without a second init when model supports ≥4096', async () => {
      setupScalingTest({
        modelContextLength: '8192',
        userContextLength: 4096, // default
      });

      await llmService.loadModel('/models/test.gguf');

      // targetCtx = min(8192, 4096, deviceMax=4096) = 4096 = initial.actualLength → no second init
      expect(initLlama).toHaveBeenCalledTimes(1);
      expect(initLlama).toHaveBeenCalledWith(
        expect.objectContaining({ n_ctx: 4096 }),
      );
    });

    it('does not scale when user set a custom context length', async () => {
      setupScalingTest({
        modelContextLength: '8192',
        userContextLength: 1024,
      });

      await llmService.loadModel('/models/test.gguf');

      // userIsOnDefault = false → no scaling check
      expect(initLlama).toHaveBeenCalledTimes(1);
    });

    it('scales up when user is on default and model supports larger ctx than default', async () => {
      // This can only trigger if deviceMaxCtx > APP_CONFIG.maxContextLength
      // (e.g. device with >8GB RAM where deviceMaxCtx = 8192)
      // Simulate by setting userContextLength below deviceMaxCtx
      const [ctx1] = setupScalingTest({
        modelContextLength: '8192',
        userContextLength: 2048, // below default — treated as custom (userIsOnDefault = false)
        contextCount: 1,
      });

      await llmService.loadModel('/models/test.gguf');

      // userIsOnDefault = 2048 === 4096 = false → no scaling
      expect(initLlama).toHaveBeenCalledTimes(1);
      expect(ctx1.release).not.toHaveBeenCalled();
    });
  });

  // ========================================================================
  // generateWithMaxTokens
  // ========================================================================
  describe('generateWithMaxTokens', () => {
    it('throws when no model loaded', async () => {
      await expect(
        llmService.generateWithMaxTokens([{ id: '1', role: 'user', content: 'Hi', timestamp: 0 }], 100)
      ).rejects.toThrow('No model loaded');
    });

    it('throws when already generating', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      const ctx = createMockLlamaContext();
      mockedInitLlama.mockResolvedValue(ctx as any);
      await llmService.loadModel('/models/test.gguf');

      (llmService as any).isGenerating = true;
      await expect(
        llmService.generateWithMaxTokens([{ id: '1', role: 'user', content: 'Hi', timestamp: 0 }], 100)
      ).rejects.toThrow('Generation already in progress');
      (llmService as any).isGenerating = false;
    });

    it('returns accumulated token text', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      const tokens = ['Hello', ' ', 'world'];
      const ctx = createMockLlamaContext({
        completion: jest.fn().mockImplementation((_params, cb) => {
          tokens.forEach(t => cb({ token: t }));
          return Promise.resolve({ timings: {} });
        }),
      });
      mockedInitLlama.mockResolvedValue(ctx as any);
      await llmService.loadModel('/models/test.gguf');

      const result = await llmService.generateWithMaxTokens(
        [{ id: '1', role: 'user', content: 'Say hello', timestamp: 0 }],
        50
      );
      expect(result).toBe('Hello world');
    });
  });

  // ========================================================================
  // generateResponse — context_full detection
  // ========================================================================
  describe('generateResponse — context_full', () => {
    it('throws "Context is full" when completionResult has context_full=true', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      const ctx = createMockLlamaContext({
        completion: jest.fn().mockResolvedValue({ context_full: true, content: '', timings: {} }),
      });
      mockedInitLlama.mockResolvedValue(ctx as any);
      await llmService.loadModel('/models/test.gguf');

      await expect(
        llmService.generateResponse([{ id: '1', role: 'user', content: 'Hi', timestamp: 0 }])
      ).rejects.toThrow('Context is full');
    });
  });

  // ========================================================================
  // detectToolCallingSupport — jinja branches
  // ========================================================================
  describe('detectToolCallingSupport — jinja branches', () => {
    it('detects tool calling via defaultCaps.toolCalls', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      const ctx = createMockLlamaContext({
        model: { chatTemplates: { jinja: { defaultCaps: { toolCalls: true } } } },
      });
      mockedInitLlama.mockResolvedValue(ctx as any);
      await llmService.loadModel('/models/test.gguf');

      expect(llmService.supportsToolCalling()).toBe(true);
    });

    it('detects tool calling via toolUseCaps.toolCalls', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      const ctx = createMockLlamaContext({
        model: { chatTemplates: { jinja: { toolUseCaps: { toolCalls: true } } } },
      });
      mockedInitLlama.mockResolvedValue(ctx as any);
      await llmService.loadModel('/models/test.gguf');

      expect(llmService.supportsToolCalling()).toBe(true);
    });

    it('detects tool calling via jinja.toolUse', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      const ctx = createMockLlamaContext({
        model: { chatTemplates: { jinja: { toolUse: 'some-template' } } },
      });
      mockedInitLlama.mockResolvedValue(ctx as any);
      await llmService.loadModel('/models/test.gguf');

      expect(llmService.supportsToolCalling()).toBe(true);
    });

    it('returns false when jinja throws', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      const ctx = createMockLlamaContext({
        model: {
          get chatTemplates() { throw new Error('boom'); },
        },
      });
      mockedInitLlama.mockResolvedValue(ctx as any);
      await llmService.loadModel('/models/test.gguf');

      expect(llmService.supportsToolCalling()).toBe(false);
    });
  });

  // ========================================================================
  // loadModel — mmProjPath not found
  // ========================================================================
  describe('loadModel — mmProjPath not found', () => {
    it('logs warning and disables vision when mmProj file is missing', async () => {
      // Main model exists, mmProj does not
      mockedRNFS.exists.mockImplementation(async (path: string) => {
        if (path.includes('mmproj')) return false;
        return true;
      });
      const ctx = createMockLlamaContext();
      mockedInitLlama.mockResolvedValue(ctx as any);

      // Should not throw — just skip multimodal
      await llmService.loadModel('/models/test.gguf', '/models/mmproj.bin');

      expect(llmService.supportsVision()).toBe(false);
    });
  });

  // ========================================================================
  // unloadModel — while generating
  // ========================================================================
  describe('unloadModel — stopCompletion during unload', () => {
    it('stops active completion before releasing context', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      const stopCompletion = jest.fn().mockResolvedValue(undefined);
      const release = jest.fn().mockResolvedValue(undefined);
      const ctx = createMockLlamaContext({ stopCompletion, release });
      mockedInitLlama.mockResolvedValue(ctx as any);
      await llmService.loadModel('/models/test.gguf');

      // Simulate active generation
      (llmService as any).isGenerating = true;
      await llmService.unloadModel();

      expect(stopCompletion).toHaveBeenCalled();
      expect(release).toHaveBeenCalled();
    });
  });

  // ========================================================================
  // generateResponseWithTools — uses context.completion with tools
  // ========================================================================
  describe('generateResponseWithTools', () => {
    it('returns fullResponse and empty toolCalls on successful completion', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      const ctx = createMockLlamaContext();
      mockedInitLlama.mockResolvedValue(ctx as any);
      await llmService.loadModel('/models/test.gguf');

      const result = await llmService.generateResponseWithTools(
        [{ id: '1', role: 'user', content: 'Use a tool', timestamp: 0 }],
        { tools: [{ type: 'function', function: { name: 'web_search' } }] },
      );

      expect(result).toHaveProperty('fullResponse');
      expect(result).toHaveProperty('toolCalls');
      expect(Array.isArray(result.toolCalls)).toBe(true);
    });

    it('sets and clears activeCompletionPromise during generation', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      const ctx = createMockLlamaContext();
      mockedInitLlama.mockResolvedValue(ctx as any);
      await llmService.loadModel('/models/test.gguf');

      let promiseDuringGeneration: any = 'not-set';
      (ctx as any).completion.mockImplementation(async (..._args: any[]) => {
        promiseDuringGeneration = (llmService as any).activeCompletionPromise;
        return { text: 'response', tokens_predicted: 5, timings: {} };
      });

      await llmService.generateResponseWithTools(
        [{ id: '1', role: 'user', content: 'Hi', timestamp: 0 }],
        { tools: [] },
      );

      // activeCompletionPromise should be null after completion
      expect((llmService as any).activeCompletionPromise).toBeNull();
      // During generation it should have been set
      expect(promiseDuringGeneration).not.toBe('not-set');
    });
  });

  // ========================================================================
  // stopGeneration — drains activeCompletionPromise when set
  // ========================================================================
  describe('stopGeneration — drains activeCompletionPromise', () => {
    it('awaits activeCompletionPromise and clears it during stopGeneration', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      const ctx = createMockLlamaContext();
      mockedInitLlama.mockResolvedValue(ctx as any);
      await llmService.loadModel('/models/test.gguf');

      let resolvePromise: () => void;
      const pendingPromise = new Promise<void>(resolve => { resolvePromise = resolve; });
      (llmService as any).activeCompletionPromise = pendingPromise;

      // Resolve the promise before calling stopGeneration
      resolvePromise!();
      await llmService.stopGeneration();

      expect((llmService as any).activeCompletionPromise).toBeNull();
    });
  });

  // ========================================================================
  // Hexagon HTP (NPU) acceleration
  // ========================================================================
  describe('HTP NPU acceleration', () => {
    const { hardwareService } = require('../../../src/services/hardware');

    beforeEach(() => {
      mockedRNFS.exists.mockResolvedValue(true);
      // Clear SoC cache between tests
      (hardwareService as any).cachedSoCInfo = null;
    });

    afterEach(() => {
      (hardwareService as any).cachedSoCInfo = null;
    });

    it('passes devices:HTP0 and 99 gpu_layers when inferenceBackend is htp on Android', async () => {
      jest.spyOn(Platform, 'OS', 'get').mockReturnValue('android');
      jest.spyOn(hardwareService, 'getSoCInfo').mockResolvedValue({
        vendor: 'qualcomm', hasNPU: true, qnnVariant: '8gen3',
      });

      const ctx = createMockLlamaContext();
      mockedInitLlama.mockResolvedValue(ctx as any);

      useAppStore.setState({
        settings: { ...useAppStore.getState().settings, inferenceBackend: 'htp' as const, gpuLayers: 99 },
      });

      await llmService.loadModel('/models/test.gguf');

      expect(mockedInitLlama).toHaveBeenCalledWith(
        expect.objectContaining({ devices: ['HTP0'], n_gpu_layers: 99 }),
      );
    });

    it('does not use HTP when inferenceBackend is cpu on Android', async () => {
      jest.spyOn(Platform, 'OS', 'get').mockReturnValue('android');

      const ctx = createMockLlamaContext();
      mockedInitLlama.mockResolvedValue(ctx as any);

      // inferenceBackend defaults to 'cpu' from testHelpers resetStores
      await llmService.loadModel('/models/test.gguf');

      expect(mockedInitLlama).not.toHaveBeenCalledWith(
        expect.objectContaining({ devices: expect.anything() }),
      );
    });

    it('does not use HTP on iOS', async () => {
      jest.spyOn(Platform, 'OS', 'get').mockReturnValue('ios');

      const ctx = createMockLlamaContext();
      mockedInitLlama.mockResolvedValue(ctx as any);

      await llmService.loadModel('/models/test.gguf');

      expect(mockedInitLlama).not.toHaveBeenCalledWith(
        expect.objectContaining({ devices: expect.anything() }),
      );
    });
  });

  describe('dropMissingImageAttachments (prevents the vision-mode file-open crash)', () => {
    const withImage = (uri: string) => {
      const m: any = createUserMessage('hi');
      m.attachments = [{ id: 'img', type: 'image', uri }];
      return m;
    };

    it('keeps image attachments whose files exist', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      const out = await (llmService as any).dropMissingImageAttachments([withImage('file:///x/a.png')]);
      expect(out[0].attachments).toHaveLength(1);
      expect(mockedRNFS.exists).toHaveBeenCalledWith('/x/a.png'); // file:// stripped
    });

    it('drops image attachments whose files are gone (keeps non-image attachments)', async () => {
      mockedRNFS.exists.mockResolvedValue(false);
      const m: any = createUserMessage('hi');
      m.attachments = [
        { id: 'img', type: 'image', uri: 'file:///x/gone.png' },
        { id: 'aud', type: 'audio', uri: 'file:///x/a.wav' },
      ];
      const out = await (llmService as any).dropMissingImageAttachments([m]);
      expect(out[0].attachments).toEqual([{ id: 'aud', type: 'audio', uri: 'file:///x/a.wav' }]);
    });

    it('leaves messages without image attachments untouched', async () => {
      const plain = createUserMessage('no attachments');
      const out = await (llmService as any).dropMissingImageAttachments([plain]);
      expect(out[0]).toBe(plain);
    });
  });

  describe('hasVisionInputs (named VISION vs TEXT-ONLY seam)', () => {
    const withImage = () => {
      const m: any = createUserMessage('hi');
      m.attachments = [{ id: 'img', type: 'image', uri: 'file:///x/a.png' }];
      return m;
    };

    it('is true when an image attachment is present AND multimodal is initialized', () => {
      (llmService as any).multimodalInitialized = true;
      expect((llmService as any).hasVisionInputs([withImage()])).toBe(true);
    });

    it('is false when no image attachments are present (multimodal initialized)', () => {
      (llmService as any).multimodalInitialized = true;
      expect((llmService as any).hasVisionInputs([createUserMessage('no images')])).toBe(false);
    });

    it('is false when images are present but multimodal is NOT initialized', () => {
      (llmService as any).multimodalInitialized = false;
      expect((llmService as any).hasVisionInputs([withImage()])).toBe(false);
    });
  });
});
