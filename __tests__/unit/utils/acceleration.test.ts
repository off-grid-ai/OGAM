import {
  isAccelerableQuant,
  modelSupportsNpuGpu,
  isDownloadedModelAccelerable,
  findAccelerableModel,
  recommendedAccelerator,
  planAcceleration,
  acceleratedBackendFor,
  acceleratedSearchQuery,
} from '../../../src/utils/acceleration';
import { INFERENCE_BACKENDS } from '../../../src/types';

const file = (name: string, quantization: string) => ({ name, size: 1, quantization, downloadUrl: '' });

describe('isAccelerableQuant', () => {
  it('accepts the NPU/GPU-accelerable GGUF quants (case-insensitive)', () => {
    expect(isAccelerableQuant('Q4_0')).toBe(true);
    expect(isAccelerableQuant('q4_0')).toBe(true);
    expect(isAccelerableQuant('Q8_0')).toBe(true);
  });

  it('rejects K-quants and unknowns (they silently fall back to CPU)', () => {
    expect(isAccelerableQuant('Q4_K_M')).toBe(false);
    expect(isAccelerableQuant('Q6_K')).toBe(false);
    expect(isAccelerableQuant('Unknown')).toBe(false);
    expect(isAccelerableQuant(undefined)).toBe(false);
    expect(isAccelerableQuant('')).toBe(false);
  });
});

describe('modelSupportsNpuGpu', () => {
  it('true when the model offers a Q4_0 or Q8_0 GGUF file', () => {
    expect(modelSupportsNpuGpu({ files: [file('m-Q4_K_M.gguf', 'Q4_K_M'), file('m-Q4_0.gguf', 'Q4_0')] })).toBe(true);
    expect(modelSupportsNpuGpu({ files: [file('m-Q8_0.gguf', 'Q8_0')] })).toBe(true);
  });

  it('true for a LiteRT model (runs on GPU regardless of quant)', () => {
    expect(modelSupportsNpuGpu({ files: [file('gemma-4-E2B-it.litertlm', 'LiteRT')] })).toBe(true);
    expect(modelSupportsNpuGpu({ files: [file('x.litertlm', 'Unknown')] })).toBe(true);
  });

  it('false when the model only offers K-quants (no acceleration)', () => {
    expect(modelSupportsNpuGpu({ files: [file('m-Q4_K_M.gguf', 'Q4_K_M'), file('m-Q6_K.gguf', 'Q6_K')] })).toBe(false);
  });

  it('false when there are no files', () => {
    expect(modelSupportsNpuGpu({ files: [] })).toBe(false);
    expect(modelSupportsNpuGpu({ files: undefined as never })).toBe(false);
  });
});

describe('isDownloadedModelAccelerable / findAccelerableModel', () => {
  const m = (id: string, name: string, engine: string, quantization: string) => ({ id, name, engine, quantization });

  it('true only for llama models in an accelerable quant', () => {
    expect(isDownloadedModelAccelerable({ engine: 'llama', quantization: 'Q4_0' })).toBe(true);
    expect(isDownloadedModelAccelerable({ engine: 'llama', quantization: 'Q4_K_M' })).toBe(false);
    expect(isDownloadedModelAccelerable({ engine: 'litert', quantization: 'Q4_0' })).toBe(false);
  });

  it('finds an accelerable build of the SAME base model (same display name), not a different one', () => {
    const models = [
      m('e4b/Q4_K_M', 'gemma-4-E4B-it-GGUF', 'llama', 'Q4_K_M'),
      m('e2b/Q4_0', 'gemma-4-E2B-it-GGUF', 'llama', 'Q4_0'),   // different model — must NOT match
      m('e4b/Q4_0', 'gemma-4-E4B-it-GGUF', 'llama', 'Q4_0'),   // same model, accelerable — the match
    ];
    const active = { id: 'e4b/Q4_K_M', name: 'gemma-4-E4B-it-GGUF' };
    expect(findAccelerableModel(models, active)?.id).toBe('e4b/Q4_0');
  });

  it('returns null when only a DIFFERENT model has an accelerable build (no cross-model downgrade)', () => {
    const models = [m('e2b/Q4_0', 'gemma-4-E2B-it-GGUF', 'llama', 'Q4_0')];
    expect(findAccelerableModel(models, { id: 'e4b/Q4_K_M', name: 'gemma-4-E4B-it-GGUF' })).toBeNull();
    expect(findAccelerableModel(models, undefined)).toBeNull();
  });
});

describe('recommendedAccelerator (GPU-first; NPU only for Llama-no-GPU)', () => {
  it('recommends GPU whenever the device has one, regardless of model', () => {
    expect(recommendedAccelerator({ hasNpu: true, hasGpu: true }, 'gemma-4-E4B-it-GGUF')).toBe('gpu');
    expect(recommendedAccelerator({ hasNpu: false, hasGpu: true }, 'Llama-3-8B')).toBe('gpu');
  });

  it('recommends NPU only when there is no GPU AND the model is Llama-family', () => {
    expect(recommendedAccelerator({ hasNpu: true, hasGpu: false }, 'Llama-3-8B-Instruct')).toBe('npu');
    expect(recommendedAccelerator({ hasNpu: true, hasGpu: false }, 'gemma-4-E4B-it-GGUF')).toBeNull();
    expect(recommendedAccelerator({ hasNpu: false, hasGpu: false }, 'Llama-3-8B')).toBeNull();
  });
});

describe('planAcceleration', () => {
  // Default test device: GPU (Adreno) — so the recommended accelerator is GPU.
  const base = {
    engine: 'llama', isRemote: false, inferenceBackend: INFERENCE_BACKENDS.CPU,
    capability: { hasNpu: false, hasGpu: true }, activeQuant: 'Q4_K_M',
    modelName: 'gemma-4-E4B-it-GGUF', downloadedAccelerable: null,
  };

  it('enable (GPU): the active model is already an accelerable quant', () => {
    const plan = planAcceleration({ ...base, activeQuant: 'Q4_0' });
    expect(plan.action).toBe('enable');
    expect(plan.backend).toBe('gpu');
  });

  it('switch: K-quant active but an accelerable build is downloaded → recommends GPU', () => {
    const plan = planAcceleration({ ...base, downloadedAccelerable: { id: 'x/E4B-Q4_0', name: 'gemma-4-E4B-it-GGUF' } });
    expect(plan.action).toBe('switch');
    expect(plan.backend).toBe('gpu');
    expect(plan.targetModelId).toBe('x/E4B-Q4_0');
  });

  it('download: K-quant active and nothing accelerable downloaded', () => {
    expect(planAcceleration(base).action).toBe('download');
  });

  it('fallback: GPU-capable device but an accelerator was selected and the K-quant runs on CPU', () => {
    const plan = planAcceleration({ ...base, inferenceBackend: INFERENCE_BACKENDS.OPENCL });
    expect(plan.action).toBe('download');
    expect(plan.fellBack).toBe(true);
  });

  it('NEVER recommends NPU for Gemma even on an NPU device with no GPU (hidden)', () => {
    expect(planAcceleration({ ...base, capability: { hasNpu: true, hasGpu: false } }).action).toBe('hidden');
  });

  it('recommends NPU for a Llama model on an NPU-only device', () => {
    const plan = planAcceleration({
      ...base, capability: { hasNpu: true, hasGpu: false }, modelName: 'Llama-3-8B-Instruct', activeQuant: 'Q4_0',
    });
    expect(plan.action).toBe('enable');
    expect(plan.backend).toBe('npu');
  });

  it('hidden when genuinely accelerated (accelerated backend + accelerable model)', () => {
    expect(planAcceleration({ ...base, inferenceBackend: INFERENCE_BACKENDS.OPENCL, activeQuant: 'Q4_0' }).action).toBe('hidden');
  });

  it('hidden when the device has neither NPU nor GPU', () => {
    expect(planAcceleration({ ...base, capability: { hasNpu: false, hasGpu: false } }).action).toBe('hidden');
  });

  it('hidden for LiteRT and remote models', () => {
    expect(planAcceleration({ ...base, engine: 'litert' }).action).toBe('hidden');
    expect(planAcceleration({ ...base, isRemote: true }).action).toBe('hidden');
    expect(planAcceleration({ ...base, engine: undefined }).action).toBe('hidden');
  });
});

describe('acceleratedBackendFor', () => {
  it('maps GPU→OpenCL and NPU→HTP per the recommended accelerator', () => {
    expect(acceleratedBackendFor({ hasNpu: true, hasGpu: true }, 'gemma')).toBe(INFERENCE_BACKENDS.OPENCL); // GPU-first
    expect(acceleratedBackendFor({ hasNpu: true, hasGpu: false }, 'Llama-3-8B')).toBe(INFERENCE_BACKENDS.HTP);
    expect(acceleratedBackendFor({ hasNpu: false, hasGpu: true }, 'anything')).toBe(INFERENCE_BACKENDS.OPENCL);
  });
});

describe('acceleratedSearchQuery', () => {
  it('strips the author prefix and quant suffix, then appends Q4_0', () => {
    expect(acceleratedSearchQuery('unsloth/Qwen3-4B-Instruct-Q4_K_M')).toBe('Qwen3-4B-Instruct Q4_0');
    expect(acceleratedSearchQuery('org/gemma-3-4b-it')).toBe('gemma-3-4b-it Q4_0');
  });

  it('falls back to a bare Q4_0 search when the id is missing', () => {
    expect(acceleratedSearchQuery(undefined)).toBe('Q4_0');
    expect(acceleratedSearchQuery(null)).toBe('Q4_0');
  });
});
