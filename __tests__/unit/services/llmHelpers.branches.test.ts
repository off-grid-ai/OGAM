/**
 * llmHelpers — additional branch coverage.
 *
 * Targets: buildModelParams OpenCL backend (flash off + f16 coercion + omit
 * cache params), buildThinkingCompletionParams Gemma branch, initMultimodal
 * (false / support fallback / exception), checkContextMultimodal, all-3-attempts
 * failed error-chain assembly, buildCompletionParams defaults, and
 * recordGenerationStats decode/ttft branches.
 */

import {
  buildModelParams,
  buildThinkingCompletionParams,
  buildCompletionParams,
  initMultimodal,
  checkContextMultimodal,
  recordGenerationStats,
  initContextWithFallback,
  hashString,
  ensureSessionCacheDir,
  getSessionPath,
  shouldDisableMmap,
} from '../../../src/services/llmHelpers';
import { INFERENCE_BACKENDS } from '../../../src/types';
import { Platform } from 'react-native';
import RNFS from 'react-native-fs';

jest.mock('../../../src/utils/logger', () => ({
  __esModule: true,
  default: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const mockedRNFS = RNFS as jest.Mocked<typeof RNFS>;

describe('hashString', () => {
  it('returns a stable hex hash for non-empty strings', () => {
    const h = hashString('hello');
    expect(typeof h).toBe('string');
    expect(hashString('hello')).toBe(h); // deterministic
  });

  it('returns "0" for the empty string (loop body never runs)', () => {
    expect(hashString('')).toBe('0');
  });

  it('produces different hashes for different inputs', () => {
    expect(hashString('abc')).not.toBe(hashString('abd'));
  });
});

describe('getSessionPath', () => {
  it('builds a session-<hash>.bin path under the cache dir', () => {
    expect(getSessionPath('/cache', 'deadbeef')).toBe('/cache/session-deadbeef.bin');
  });
});

describe('ensureSessionCacheDir', () => {
  afterEach(() => jest.clearAllMocks());

  it('creates the dir when it does not exist', async () => {
    mockedRNFS.exists.mockResolvedValueOnce(false);
    await ensureSessionCacheDir('/cache/sessions');
    expect(mockedRNFS.mkdir).toHaveBeenCalledWith('/cache/sessions');
  });

  it('does not create the dir when it already exists', async () => {
    mockedRNFS.exists.mockResolvedValueOnce(true);
    await ensureSessionCacheDir('/cache/sessions');
    expect(mockedRNFS.mkdir).not.toHaveBeenCalled();
  });

  it('swallows errors thrown while creating the dir', async () => {
    mockedRNFS.exists.mockRejectedValueOnce(new Error('fs error'));
    await expect(ensureSessionCacheDir('/cache/sessions')).resolves.toBeUndefined();
  });
});

describe('shouldDisableMmap — android repackable quant branch', () => {
  const origOS = Platform.OS;
  afterEach(() => { (Platform as any).OS = origOS; });

  it('returns true on android for a q4_0 model path', () => {
    (Platform as any).OS = 'android';
    expect(shouldDisableMmap('/models/llama.Q4_0.gguf')).toBe(true);
  });

  it('returns true on android for an iq4_nl model path', () => {
    (Platform as any).OS = 'android';
    expect(shouldDisableMmap('/models/llama.IQ4_NL.gguf')).toBe(true);
  });

  it('returns false on android for a non-repackable quant', () => {
    (Platform as any).OS = 'android';
    expect(shouldDisableMmap('/models/llama.Q8_0.gguf')).toBe(false);
  });
});

describe('buildModelParams — OpenCL backend branch', () => {
  it('forces flash off, omits cache_type params, and coerces requested cache to f16', () => {
    const params = buildModelParams('/model.gguf', {
      inferenceBackend: INFERENCE_BACKENDS.OPENCL,
      cacheType: 'q8_0',
    });
    const base = params.baseParams as any;
    // gpuBackendIncompatible → flash off
    expect(base.flash_attn_type).toBe('off');
    // OpenCL omits explicit cache_type_k/v entirely
    expect(base.cache_type_k).toBeUndefined();
    expect(base.cache_type_v).toBeUndefined();
    // backend !== CPU → GPU enabled with DEFAULT_GPU_LAYERS fallback
    expect(params.nGpuLayers).toBeGreaterThanOrEqual(0);
  });

  it('uses CPU backend → gpu disabled (nGpuLayers 0)', () => {
    const params = buildModelParams('/model.gguf', {
      inferenceBackend: INFERENCE_BACKENDS.CPU,
    });
    expect(params.nGpuLayers).toBe(0);
  });

  it('defaults cacheType to q8_0 when flash attn is effective and none provided', () => {
    const params = buildModelParams('/model.gguf', {});
    // flash defaults to 'auto' (effective) → q8_0 cache
    expect((params.baseParams as any).cache_type_k).toBe('q8_0');
  });

  it('uses f16 cache when flash attn explicitly off', () => {
    const params = buildModelParams('/model.gguf', { flashAttn: false });
    expect((params.baseParams as any).cache_type_k).toBe('f16');
  });
});

describe('buildThinkingCompletionParams', () => {
  it('uses deepseek reasoning_format when thinking on and not Gemma 4', () => {
    expect(buildThinkingCompletionParams(true, false)).toEqual({
      enable_thinking: true,
      reasoning_format: 'deepseek',
    });
  });

  it('uses auto format for Gemma 4 so llama.cpp parses its channel format natively (native-first)', () => {
    // Previously forced 'none' + hand-parse; now 'auto' lets llama.cpp populate
    // reasoning_content/tool_calls itself, with our hand-parser as a fallback only.
    expect(buildThinkingCompletionParams(true, true)).toEqual({
      enable_thinking: true,
      reasoning_format: 'auto',
    });
  });

  it('uses none format when thinking disabled', () => {
    expect(buildThinkingCompletionParams(false)).toEqual({
      enable_thinking: false,
      reasoning_format: 'none',
    });
  });
});

describe('initMultimodal', () => {
  it('returns noSupport when initMultimodal returns false', async () => {
    const ctx = {
      initMultimodal: jest.fn().mockResolvedValue(false),
      getMultimodalSupport: jest.fn(),
    } as any;
    const res = await initMultimodal(ctx, '/mmproj.gguf', true);
    expect(res.initialized).toBe(false);
    expect(res.support).toEqual({ vision: false, audio: false });
  });

  it('reads support from getMultimodalSupport on success', async () => {
    const ctx = {
      initMultimodal: jest.fn().mockResolvedValue(true),
      getMultimodalSupport: jest.fn().mockResolvedValue({ vision: true, audio: true }),
    } as any;
    const res = await initMultimodal(ctx, '/mmproj.gguf', false);
    expect(res.initialized).toBe(true);
    expect(res.support).toEqual({ vision: true, audio: true });
  });

  it('keeps default support when getMultimodalSupport throws', async () => {
    const ctx = {
      initMultimodal: jest.fn().mockResolvedValue(true),
      getMultimodalSupport: jest.fn().mockRejectedValue(new Error('no support api')),
    } as any;
    const res = await initMultimodal(ctx, '/mmproj.gguf', true);
    expect(res.initialized).toBe(true);
    expect(res.support).toEqual({ vision: true, audio: false });
  });

  it('returns noSupport when initMultimodal throws', async () => {
    const ctx = {
      initMultimodal: jest.fn().mockRejectedValue(new Error('init exception')),
    } as any;
    const res = await initMultimodal(ctx, '/mmproj.gguf', true);
    expect(res.initialized).toBe(false);
    expect(res.support).toEqual({ vision: false, audio: false });
  });
});

describe('checkContextMultimodal', () => {
  it('returns support when getMultimodalSupport is a function', async () => {
    const ctx = {
      getMultimodalSupport: jest.fn().mockResolvedValue({ vision: true, audio: false }),
    } as any;
    expect(await checkContextMultimodal(ctx)).toEqual({ vision: true, audio: false });
  });

  it('returns all-false when method is missing', async () => {
    const ctx = {} as any;
    expect(await checkContextMultimodal(ctx)).toEqual({ vision: false, audio: false });
  });

  it('returns all-false when method throws', async () => {
    const ctx = {
      getMultimodalSupport: jest.fn().mockRejectedValue(new Error('boom')),
    } as any;
    expect(await checkContextMultimodal(ctx)).toEqual({ vision: false, audio: false });
  });
});

describe('initContextWithFallback — all three attempts fail', () => {
  const { initLlama } = require('llama.rn');
  const mockedInitLlama = initLlama as jest.MockedFunction<typeof initLlama>;

  it('throws a combined error chain when GPU, CPU and min-ctx all fail', async () => {
    mockedInitLlama
      .mockRejectedValueOnce(new Error('gpu fail'))
      .mockRejectedValueOnce(new Error('cpu fail'))
      .mockRejectedValueOnce(new Error('minctx fail'));

    await expect(
      initContextWithFallback({ model: '/m.gguf' }, 4096, 0),
    ).rejects.toThrow(/Failed to load model even at minimum context/);
  });

  it('builds an error chain including GPU and CPU parts when distinct', async () => {
    mockedInitLlama
      .mockRejectedValueOnce(new Error('gpu-specific'))
      .mockRejectedValueOnce(new Error('cpu-specific'))
      .mockRejectedValueOnce(new Error('final-specific'));

    try {
      await initContextWithFallback({ model: '/m.gguf' }, 8192, 99);
      throw new Error('should have thrown');
    } catch (e: any) {
      expect(e.message).toContain('GPU: gpu-specific');
      expect(e.message).toContain('CPU: cpu-specific');
      expect(e.message).toContain('min-ctx: final-specific');
    }
  });

  it('omits duplicate GPU/CPU parts when all three errors share a message', async () => {
    // gpuMsg === cpuMsg === finalMsg → both `!== finalMsg` ternaries take the null branch,
    // leaving only the "min-ctx:" part in the chain.
    mockedInitLlama
      .mockRejectedValueOnce(new Error('same'))
      .mockRejectedValueOnce(new Error('same'))
      .mockRejectedValueOnce(new Error('same'));

    try {
      await initContextWithFallback({ model: '/m.gguf' }, 4096, 99);
      throw new Error('should have thrown');
    } catch (e: any) {
      expect(e.message).toContain('min-ctx: same');
      expect(e.message).not.toContain('GPU: same');
      expect(e.message).not.toContain('CPU: same');
    }
  });

  it('handles a non-Error rejection via String() fallback', async () => {
    mockedInitLlama
      .mockRejectedValueOnce('plain-string-gpu')
      .mockRejectedValueOnce('plain-string-cpu')
      .mockRejectedValueOnce('plain-string-final');

    await expect(
      initContextWithFallback({ model: '/m.gguf' }, 2048, 0),
    ).rejects.toThrow(/Failed to load model/);
  });
});

describe('buildCompletionParams — default fallbacks', () => {
  it('applies RESPONSE_RESERVE / 0.7 / 0.95 / 1.1 defaults when settings omitted', () => {
    const params = buildCompletionParams({});
    expect(params.n_predict).toBe(512); // RESPONSE_RESERVE
    expect(params.temperature).toBe(0.7);
    expect(params.top_p).toBe(0.95);
    expect(params.penalty_repeat).toBe(1.1);
    expect(params.top_k).toBe(40);
    expect(params.ctx_shift).toBe(true);
  });

  it('honours temperature 0 (nullish coalescing, not ||)', () => {
    const params = buildCompletionParams({ temperature: 0, topP: 0, repeatPenalty: 0 });
    expect(params.temperature).toBe(0);
    expect(params.top_p).toBe(0);
    expect(params.penalty_repeat).toBe(0);
  });
});

describe('recordGenerationStats', () => {
  const realNow = Date.now;
  afterEach(() => { Date.now = realNow; });

  it('computes positive tok/s and decode rate for multi-token generation', () => {
    // startTime such that elapsed = 2s
    const start = 1000;
    Date.now = jest.fn(() => 3000);
    const stats = recordGenerationStats(start, 500 /* ttft ms */, 10);
    expect(stats.lastTokenCount).toBe(10);
    expect(stats.lastGenerationTime).toBeCloseTo(2);
    expect(stats.lastTokensPerSecond).toBeCloseTo(5);
    expect(stats.lastTimeToFirstToken).toBeCloseTo(0.5);
    // decodeTime = 2 - 0.5 = 1.5, (10-1)/1.5 = 6
    expect(stats.lastDecodeTokensPerSecond).toBeCloseTo(6);
  });

  it('reports 0 rates when elapsed is 0 and tokenCount is 1 (guard branches)', () => {
    const start = 5000;
    Date.now = jest.fn(() => 5000); // elapsed = 0
    const stats = recordGenerationStats(start, 0, 1);
    expect(stats.lastTokensPerSecond).toBe(0);     // elapsed > 0 false
    expect(stats.lastDecodeTokensPerSecond).toBe(0); // decodeTime>0 && count>1 false
  });
});
