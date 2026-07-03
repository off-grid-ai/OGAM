import {
  getMaxContextForDevice,
  getGpuLayersForDevice,
  BYTES_PER_GB,
  supportsNativeThinking,
  getModelMaxContext,
  estimateTokens,
  fitMessagesInBudget,
  getStreamingDelta,
  buildModelParams,
  buildCompletionParams,
  shouldDisableMmap,
  captureGpuInfo,
  logContextMetadata,
  initContextWithFallback,
} from '../../../src/services/llmHelpers';
import { Platform } from 'react-native';
import { INFERENCE_BACKENDS } from '../../../src/types';

jest.mock('../../../src/utils/logger', () => ({
  __esModule: true,
  default: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const GB = BYTES_PER_GB;

describe('getMaxContextForDevice', () => {
  it('caps at 2048 for 3GB RAM', () => {
    expect(getMaxContextForDevice(3 * GB)).toBe(2048);
  });

  it('caps at 2048 for 4GB RAM (iPhone XS)', () => {
    expect(getMaxContextForDevice(4 * GB)).toBe(2048);
  });

  it('caps at 2048 for 6GB RAM', () => {
    expect(getMaxContextForDevice(6 * GB)).toBe(2048);
  });

  it('caps at 4096 for 8GB RAM', () => {
    expect(getMaxContextForDevice(8 * GB)).toBe(4096);
  });

  it('caps at 4096 for 7GB RAM', () => {
    expect(getMaxContextForDevice(7 * GB)).toBe(4096);
  });

  it('caps at 8192 for 12GB RAM', () => {
    expect(getMaxContextForDevice(12 * GB)).toBe(8192);
  });

  it('caps at 8192 for 16GB RAM', () => {
    expect(getMaxContextForDevice(16 * GB)).toBe(8192);
  });
});

describe('getGpuLayersForDevice', () => {
  it('disables GPU on 3GB RAM device', () => {
    expect(getGpuLayersForDevice(3 * GB, 99)).toBe(0);
  });

  it('disables GPU on 4GB RAM device (iPhone XS)', () => {
    expect(getGpuLayersForDevice(4 * GB, 99)).toBe(0);
  });

  it('keeps requested GPU layers on 6GB iOS device', () => {
    expect(getGpuLayersForDevice(6 * GB, 99)).toBe(99);
  });

  it('keeps requested GPU layers on 8GB iOS device', () => {
    expect(getGpuLayersForDevice(8 * GB, 99)).toBe(99);
  });

  it('passes through 0 GPU layers unchanged', () => {
    expect(getGpuLayersForDevice(4 * GB, 0)).toBe(0);
    expect(getGpuLayersForDevice(8 * GB, 0)).toBe(0);
  });

  describe('Android Adreno GPU caps', () => {
    const origPlatform = Platform.OS;

    beforeEach(() => {
      (Platform as any).OS = 'android';
    });

    afterEach(() => {
      (Platform as any).OS = origPlatform;
    });

    it('disables GPU on Android with 4GB RAM', () => {
      expect(getGpuLayersForDevice(4 * GB, 99)).toBe(0);
    });

    it('disables GPU on Android with 6GB RAM', () => {
      expect(getGpuLayersForDevice(6 * GB, 99)).toBe(0);
    });

    it('caps GPU layers to 12 on Android with 8GB RAM', () => {
      expect(getGpuLayersForDevice(8 * GB, 99)).toBe(12);
    });

    it('caps GPU layers to 12 on Android with 7GB RAM', () => {
      expect(getGpuLayersForDevice(7 * GB, 99)).toBe(12);
    });

    it('caps GPU layers to 24 on Android with 12GB RAM', () => {
      expect(getGpuLayersForDevice(12 * GB, 99)).toBe(24);
    });

    it('returns requested layers when under cap on Android 12GB', () => {
      expect(getGpuLayersForDevice(12 * GB, 16)).toBe(16);
    });

    it('passes through 0 GPU layers unchanged on Android', () => {
      expect(getGpuLayersForDevice(8 * GB, 0)).toBe(0);
    });
  });

  describe('iOS Metal offload cap (model size + free RAM)', () => {
    // Platform.OS is mocked as 'ios' in the test env.
    it('offloads all layers when the model fits free RAM minus the reserve', () => {
      // 4GB free − 1.6GB reserve = 2.4GB budget; a 1GB model fits → full 99.
      expect(getGpuLayersForDevice(6 * GB, 99, { modelBytes: 1 * GB, availableBytes: 4 * GB })).toBe(99);
    });

    it('scales layers down when the model exceeds the weight budget', () => {
      // budget 2.4GB, model 3GB → floor(99 * 2.4/3) = 79.
      expect(getGpuLayersForDevice(6 * GB, 99, { modelBytes: 3 * GB, availableBytes: 4 * GB })).toBe(79);
    });

    it('falls back to CPU (0) when there is no headroom over the reserve', () => {
      expect(getGpuLayersForDevice(6 * GB, 99, { modelBytes: 2 * GB, availableBytes: 1.5 * GB })).toBe(0);
    });

    it('leaves layers unchanged on iOS when model/RAM info is absent (back-compat)', () => {
      expect(getGpuLayersForDevice(6 * GB, 99)).toBe(99);
    });
  });
});

describe('supportsNativeThinking', () => {
  it('returns false when context is null', () => {
    expect(supportsNativeThinking(null)).toBe(false);
  });

  it('returns result of isJinjaSupported() when available', () => {
    const ctx = { isJinjaSupported: jest.fn(() => true) } as any;
    expect(supportsNativeThinking(ctx)).toBe(true);
    expect(ctx.isJinjaSupported).toHaveBeenCalled();
  });

  it('reads chatTemplates.jinja when isJinjaSupported is not a function', () => {
    const ctx = { model: { chatTemplates: { jinja: { default: 'template' } } } } as any;
    expect(supportsNativeThinking(ctx)).toBe(true);
  });

  it('returns false when jinja has no default or toolUse', () => {
    const ctx = { model: { chatTemplates: { jinja: {} } } } as any;
    expect(supportsNativeThinking(ctx)).toBe(false);
  });

  it('returns false on exception', () => {
    const ctx = {
      get model() { throw new Error('boom'); }
    } as any;
    expect(supportsNativeThinking(ctx)).toBe(false);
  });
});

describe('getModelMaxContext', () => {
  it('returns null when metadata is missing', () => {
    const ctx = {} as any;
    expect(getModelMaxContext(ctx)).toBeNull();
  });

  it('returns null when trainCtx not found in metadata', () => {
    const ctx = { model: { metadata: {} } } as any;
    expect(getModelMaxContext(ctx)).toBeNull();
  });

  it('returns parsed context length', () => {
    const ctx = { model: { metadata: { 'llama.context_length': '4096' } } } as any;
    expect(getModelMaxContext(ctx)).toBe(4096);
  });

  it('returns null when parseInt gives NaN', () => {
    const ctx = { model: { metadata: { 'llama.context_length': 'not-a-number' } } } as any;
    expect(getModelMaxContext(ctx)).toBeNull();
  });

  it('returns null on exception', () => {
    const ctx = {
      get model() { throw new Error('boom'); }
    } as any;
    expect(getModelMaxContext(ctx)).toBeNull();
  });
});

describe('estimateTokens', () => {
  it('returns token count from context.tokenize', async () => {
    const ctx = { tokenize: jest.fn().mockResolvedValue({ tokens: [1, 2, 3] }) } as any;
    const count = await estimateTokens(ctx, 'hello');
    expect(count).toBe(3);
  });

  it('falls back to char/4 estimate on exception', async () => {
    const ctx = { tokenize: jest.fn().mockRejectedValue(new Error('fail')) } as any;
    const count = await estimateTokens(ctx, '1234'); // 4 chars → 1 token
    expect(count).toBe(1);
  });

  it('returns 0 when tokens array is empty', async () => {
    const ctx = { tokenize: jest.fn().mockResolvedValue({ tokens: [] }) } as any;
    expect(await estimateTokens(ctx, '')).toBe(0);
  });
});

function makeMsg(content: string): any {
  return { id: '1', role: 'user', content, timestamp: 0 };
}

describe('fitMessagesInBudget', () => {
  it('includes all messages when budget is large', async () => {
    const ctx = { tokenize: jest.fn().mockResolvedValue({ tokens: new Array(10).fill(1) }) } as any;
    const msgs = [makeMsg('short'), makeMsg('message')];
    const result = await fitMessagesInBudget(ctx, msgs, 1000);
    expect(result).toHaveLength(2);
  });

  it('drops older messages that exceed budget', async () => {
    // Each message tokenizes to 10 tokens + 10 overhead = 20
    const ctx = { tokenize: jest.fn().mockResolvedValue({ tokens: new Array(10).fill(1) }) } as any;
    const msgs = [makeMsg('old message'), makeMsg('new message')];
    // Budget of 25: can fit new message (20 tokens) but not both (40 tokens)
    const result = await fitMessagesInBudget(ctx, msgs, 25);
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe('new message');
  });

  it('always includes at least the last message even if it exceeds budget', async () => {
    const ctx = { tokenize: jest.fn().mockResolvedValue({ tokens: new Array(100).fill(1) }) } as any;
    const msgs = [makeMsg('only message')];
    // Budget of 5: 110 tokens exceeds budget, but result should still include it
    const result = await fitMessagesInBudget(ctx, msgs, 5);
    expect(result).toHaveLength(1);
  });

  it('falls back to char estimate when tokenize throws', async () => {
    const ctx = { tokenize: jest.fn().mockRejectedValue(new Error('no tokenizer')) } as any;
    const msgs = [makeMsg('hi')]; // 2 chars → ~1 token + 10 = 11
    const result = await fitMessagesInBudget(ctx, msgs, 100);
    expect(result).toHaveLength(1);
  });
});

describe('getStreamingDelta', () => {
  it('returns undefined when nextValue is falsy', () => {
    expect(getStreamingDelta(undefined, 'prev')).toBeUndefined();
    expect(getStreamingDelta('', 'prev')).toBeUndefined();
  });

  it('returns nextValue when previousValue is empty', () => {
    expect(getStreamingDelta('hello', '')).toBe('hello');
  });

  it('returns slice when nextValue starts with previousValue', () => {
    expect(getStreamingDelta('hello world', 'hello ')).toBe('world');
  });

  it('returns undefined when slice is empty (no new content)', () => {
    expect(getStreamingDelta('same', 'same')).toBeUndefined();
  });

  it('returns nextValue when it does not start with previousValue', () => {
    expect(getStreamingDelta('different', 'prev')).toBe('different');
  });
});

describe('supportsNativeThinking — toolUse branch', () => {
  it('returns true when jinja has toolUse but no default', () => {
    const ctx = { model: { chatTemplates: { jinja: { toolUse: 'some-template' } } } } as any;
    expect(supportsNativeThinking(ctx)).toBe(true);
  });
});

describe('getModelMaxContext — alternative metadata keys', () => {
  it('falls back to general.context_length when llama key absent', () => {
    const ctx = { model: { metadata: { 'general.context_length': '8192' } } } as any;
    expect(getModelMaxContext(ctx)).toBe(8192);
  });

  it('falls back to context_length key', () => {
    const ctx = { model: { metadata: { context_length: '4096' } } } as any;
    expect(getModelMaxContext(ctx)).toBe(4096);
  });

  it('returns null when context length is zero or negative', () => {
    const ctx = { model: { metadata: { 'llama.context_length': '0' } } } as any;
    expect(getModelMaxContext(ctx)).toBeNull();
  });
});

describe('shouldDisableMmap', () => {
  it('returns false on non-android', () => {
    // Platform.OS is mocked as 'ios' in test env
    expect(shouldDisableMmap('/path/to/model.q4_0.gguf')).toBe(false);
  });
});

describe('buildModelParams', () => {
  it('uses provided nThreads and nBatch over defaults', () => {
    const params = buildModelParams('/model.gguf', { nThreads: 8, nBatch: 256 });
    expect(params.nThreads).toBe(8);
    expect(params.nBatch).toBe(256);
  });

  it('uses provided contextLength', () => {
    const params = buildModelParams('/model.gguf', { contextLength: 4096 });
    expect(params.ctxLen).toBe(4096);
  });

  it('disables GPU when enableGpu=false', () => {
    const params = buildModelParams('/model.gguf', { enableGpu: false });
    expect(params.nGpuLayers).toBe(0);
  });

  it('uses flashAttn=false settings', () => {
    const params = buildModelParams('/model.gguf', { flashAttn: false });
    expect((params.baseParams as any).flash_attn_type).toBe('off');
  });

  it('uses provided cacheType', () => {
    const params = buildModelParams('/model.gguf', { cacheType: 'f16' });
    expect((params.baseParams as any).cache_type_k).toBe('f16');
  });

  it('uses provided gpuLayers', () => {
    const params = buildModelParams('/model.gguf', { gpuLayers: 16 });
    expect(params.nGpuLayers).toBe(16);
  });

  // HTP is currently disabled via HTP_ENABLED feature flag
  it.skip('forces f16 KV cache for HTP backend', () => {
    const params = buildModelParams('/model.gguf', {
      inferenceBackend: INFERENCE_BACKENDS.HTP,
      cacheType: 'q8_0',
    });
    expect((params.baseParams as any).cache_type_k).toBe('f16');
    expect((params.baseParams as any).cache_type_v).toBe('f16');
  });
});

describe('captureGpuInfo', () => {
  it('returns gpuEnabled=false when gpuAttemptFailed=true', () => {
    const ctx = { gpu: true, reasonNoGPU: '', devices: [] } as any;
    const info = captureGpuInfo(ctx, true, 32);
    expect(info.gpuEnabled).toBe(false);
    expect(info.activeGpuLayers).toBe(0);
  });

  it('returns gpuEnabled=true when gpu available and layers > 0', () => {
    const ctx = { gpu: true, reasonNoGPU: '', devices: ['Metal'] } as any;
    const info = captureGpuInfo(ctx, false, 32);
    expect(info.gpuEnabled).toBe(true);
    expect(info.activeGpuLayers).toBe(32);
    expect(info.gpuDevices).toEqual(['Metal']);
  });

  it('returns gpuEnabled=false when gpu unavailable', () => {
    const ctx = { gpu: false, reasonNoGPU: 'No GPU', devices: [] } as any;
    const info = captureGpuInfo(ctx, false, 32);
    expect(info.gpuEnabled).toBe(false);
  });
});

describe('logContextMetadata', () => {
  const logger = require('../../../src/utils/logger').default;

  beforeEach(() => jest.clearAllMocks());

  it('logs nothing when context has no metadata', () => {
    const ctx = {} as any;
    logContextMetadata(ctx, 4096);
    expect(logger.log).not.toHaveBeenCalled();
  });

  it('logs warning when requested context exceeds model max', () => {
    const ctx = { model: { metadata: { 'llama.context_length': '2048' } } } as any;
    logContextMetadata(ctx, 4096);
    expect(logger.warn).toHaveBeenCalled();
  });

  it('logs without warning when context is within model max', () => {
    const ctx = { model: { metadata: { 'llama.context_length': '8192' } } } as any;
    logContextMetadata(ctx, 4096);
    expect(logger.log).toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });
});

// ==========================================================================
// buildCompletionParams — ctx_shift disable for Android GPU (SIGSEGV fix)
// ==========================================================================
describe('buildCompletionParams', () => {
  const defaultSettings = { maxTokens: 512, temperature: 0.7, topP: 0.95, repeatPenalty: 1.1 };

  it('enables ctx_shift by default', () => {
    const params = buildCompletionParams(defaultSettings);
    expect(params.ctx_shift).toBe(true);
  });

  it('enables ctx_shift when disableCtxShift is false', () => {
    const params = buildCompletionParams(defaultSettings, { disableCtxShift: false });
    expect(params.ctx_shift).toBe(true);
  });

  it('disables ctx_shift when disableCtxShift is true (Android GPU SIGSEGV fix)', () => {
    const params = buildCompletionParams(defaultSettings, { disableCtxShift: true });
    expect(params.ctx_shift).toBe(false);
  });

  it('preserves other params when ctx_shift is disabled', () => {
    const params = buildCompletionParams(defaultSettings, { disableCtxShift: true });
    expect(params.n_predict).toBe(512);
    expect(params.temperature).toBe(0.7);
    expect(params.top_p).toBe(0.95);
    expect(params.penalty_repeat).toBe(1.1);
    expect(params.stop).toBeDefined();
  });
});

describe('initContextWithFallback — HTP device stripping and timeout', () => {
  const { initLlama } = require('llama.rn');
  const mockedInitLlama = initLlama as jest.MockedFunction<typeof initLlama>;

  const baseParams = { model: '/model.gguf', devices: ['HTP0'] };

  it('passes devices to initLlama on the first (GPU/HTP) attempt', async () => {
    const mockCtx = { gpu: true, release: jest.fn() };
    mockedInitLlama.mockResolvedValueOnce(mockCtx as any);

    await initContextWithFallback(baseParams, 2048, 99);

    expect(mockedInitLlama).toHaveBeenCalledWith(
      expect.objectContaining({ devices: ['HTP0'], n_gpu_layers: 99 }),
    );
  });

  it('strips devices from params on CPU fallback (attempt 2)', async () => {
    mockedInitLlama.mockRejectedValueOnce(new Error('HTP init failed'));
    const mockCtx = { gpu: false, release: jest.fn() };
    mockedInitLlama.mockResolvedValueOnce(mockCtx as any);

    await initContextWithFallback(baseParams, 2048, 99);

    const cpuCall = mockedInitLlama.mock.calls[1][0] as Record<string, unknown>;
    expect(cpuCall.devices).toBeUndefined();
    expect(cpuCall.n_gpu_layers).toBe(0);
  });

  it('strips devices from params on minimal CPU fallback (attempt 3)', async () => {
    mockedInitLlama.mockRejectedValueOnce(new Error('HTP init failed'));
    mockedInitLlama.mockRejectedValueOnce(new Error('CPU init failed'));
    const mockCtx = { gpu: false, release: jest.fn() };
    mockedInitLlama.mockResolvedValueOnce(mockCtx as any);

    await initContextWithFallback(baseParams, 8192, 99);

    const minCtxCall = mockedInitLlama.mock.calls[2][0] as Record<string, unknown>;
    expect(minCtxCall.devices).toBeUndefined();
    expect(minCtxCall.n_gpu_layers).toBe(0);
    expect(minCtxCall.n_ctx).toBe(2048);
  });

  // HTP is currently disabled via HTP_ENABLED feature flag
  it.skip('logs backend=HTP when devices contains HTP0', async () => {
    const mockCtx = { gpu: true, release: jest.fn() };
    mockedInitLlama.mockResolvedValueOnce(mockCtx as any);
    const logger = require('../../../src/utils/logger').default;

    await initContextWithFallback(baseParams, 2048, 99);

    expect(logger.log).toHaveBeenCalledWith(
      expect.stringContaining('backend=HTP'),
    );
  });
});

// ==========================================================================
// GPU timeout on Android — withTimeout, tryGpuInit catch, safeRelease
// ==========================================================================

describe('initContextWithFallback — GPU timeout on Android', () => {
  const { initLlama } = require('llama.rn');
  const mockedInitLlama = initLlama as jest.MockedFunction<typeof initLlama>;
  const origPlatform = Platform.OS;

  beforeEach(() => {
    (Platform as any).OS = 'android';
    jest.useFakeTimers();
  });

  afterEach(() => {
    (Platform as any).OS = origPlatform;
    jest.useRealTimers();
  });

  it('falls back to CPU when GPU init times out (withTimeout + tryGpuInit catch)', async () => {
    let resolveGpu!: (ctx: any) => void;
    const slowGpu = new Promise<any>(resolve => { resolveGpu = resolve; });
    const cpuCtx = { gpu: false, release: jest.fn() };

    mockedInitLlama
      .mockReturnValueOnce(slowGpu)
      .mockResolvedValueOnce(cpuCtx);

    const resultPromise = initContextWithFallback({ model: '/m.gguf' }, 2048, 4);
    jest.advanceTimersByTime(8001);
    const result = await resultPromise;

    expect(result.gpuAttemptFailed).toBe(true);
    expect(result.context).toBe(cpuCtx);

    // Resolve the late GPU promise after timeout — exercises safeRelease(nonNullCtx)
    const lateCtx = { release: jest.fn() };
    resolveGpu(lateCtx);
    await Promise.resolve();
    await Promise.resolve();
    expect(lateCtx.release).toHaveBeenCalled();
  });

  it('safeRelease swallows error when late GPU ctx release throws', async () => {
    let resolveGpu!: (ctx: any) => void;
    const slowGpu = new Promise<any>(resolve => { resolveGpu = resolve; });
    const cpuCtx = { gpu: false, release: jest.fn() };

    mockedInitLlama
      .mockReturnValueOnce(slowGpu)
      .mockResolvedValueOnce(cpuCtx);

    const resultPromise = initContextWithFallback({ model: '/m.gguf' }, 2048, 4);
    jest.advanceTimersByTime(8001);
    await resultPromise;

    // Late ctx whose release() throws — safeRelease must swallow the error
    const lateCtx = { release: jest.fn().mockRejectedValue(new Error('release fail')) };
    resolveGpu(lateCtx);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(lateCtx.release).toHaveBeenCalled();
  });
});
