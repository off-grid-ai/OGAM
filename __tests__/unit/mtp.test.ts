import { mtpParams } from '../../src/services/llmHelpers';
import { isDraftFile } from '../../src/screens/ModelsScreen/importHelpers';

describe('MTP files', () => {
  it('turns on drafting only when a file is attached and the switch is on', () => {
    expect(mtpParams('/m/x.mtp.gguf', true)).toEqual({ model_draft: '/m/x.mtp.gguf', speculative: { enabled: true, type: 'mtp', n_max: 3 } });
    expect(mtpParams(undefined, true)).toEqual({});
    expect(mtpParams(undefined, true, true)).toEqual({ speculative: { enabled: true, type: 'mtp', n_max: 3 } });
    expect(mtpParams('/m/x.mtp.gguf', true, true)).toEqual({ model_draft: '/m/x.mtp.gguf', speculative: { enabled: true, type: 'mtp', n_max: 3 } });
    expect(mtpParams(undefined, false, true)).toEqual({});
    expect(mtpParams('/m/x.mtp.gguf', false)).toEqual({});
  });
  it('recognises MTP and draft files by name, but not ordinary models', () => {
    for (const n of ['Qwen3-MTP.gguf', 'model-mtp-Q4_0.gguf', 'llama_draft.gguf', 'nextn-layer.gguf']) expect(isDraftFile(n)).toBe(true);
    for (const n of ['Qwen3-8B-Q4_K_M.gguf', 'mmproj-F16.gguf', 'Attempt-7B.gguf']) expect(isDraftFile(n)).toBe(false);
  });
});

import { buildModelParams, effectiveCacheType, modelForcesF16Cache } from '../../src/services/llmHelpers';

describe('models that need an f16 cache', () => {
  const GEMMA = '/models/Gemma4-12B-QAT-Uncensored-HauhauCS-Balanced-Q4_K_M.gguf';
  it('recognises Gemma 4 and Gemma 3n files, and not other models', () => {
    expect(modelForcesF16Cache(GEMMA)).toBe(true);
    expect(modelForcesF16Cache('/m/gemma-3n-E4B-it-Q4_K_M.gguf')).toBe(true);
    expect(modelForcesF16Cache('/m/gemma-4-E2B-it-Q8_0.gguf')).toBe(true);
    expect(modelForcesF16Cache('/m/Qwen3-8B-Q4_K_M.gguf')).toBe(false);
    expect(modelForcesF16Cache('/m/gemma-2-9b-it-Q4_K_M.gguf')).toBe(false);
  });
  it('loads such a model with an f16 cache whatever the setting says, and others with the setting', () => {
    expect(effectiveCacheType('cpu', 'q8_0', GEMMA)).toBe('f16');
    expect(effectiveCacheType('cpu', 'q8_0', '/m/Qwen3-8B-Q4_K_M.gguf')).toBe('q8_0');
    const gemma = buildModelParams(GEMMA, { cacheType: 'q8_0', inferenceBackend: 'cpu', flashAttn: true });
    expect(gemma.baseParams).toMatchObject({ cache_type_k: 'f16', cache_type_v: 'f16' });
    expect(gemma.usesF16Cache).toBe(true);
    const qwen = buildModelParams('/m/Qwen3-8B-Q4_K_M.gguf', { cacheType: 'q8_0', inferenceBackend: 'cpu', flashAttn: true });
    expect(qwen.baseParams).toMatchObject({ cache_type_k: 'q8_0' });
  });
});
