/**
 * The text-model RAM overhead multiplier is GPU-aware (device 2026-07-14): a GPU/NPU backend keeps
 * working buffers in system RAM on top of the weights, which the flat CPU 1.5× undercounts — so
 * Aggressive co-resided text + image on an estimate that ignored them, then OOM'd. The fit check now
 * bumps the multiplier when a GPU backend is selected. Pure function → unit tested for every branch.
 */
import {
  textOverheadMultiplier,
  TEXT_MODEL_OVERHEAD_MULTIPLIER,
  TEXT_MODEL_GPU_OVERHEAD_MULTIPLIER,
} from '../../../src/services/activeModelService/types';
import { INFERENCE_BACKENDS } from '../../../src/types';

describe('textOverheadMultiplier — GPU-aware text RAM estimate', () => {
  it('uses the higher GPU multiplier for GPU/NPU backends', () => {
    for (const backend of [INFERENCE_BACKENDS.OPENCL, INFERENCE_BACKENDS.METAL, INFERENCE_BACKENDS.HTP]) {
      expect(textOverheadMultiplier(backend)).toBe(TEXT_MODEL_GPU_OVERHEAD_MULTIPLIER);
    }
    expect(TEXT_MODEL_GPU_OVERHEAD_MULTIPLIER).toBeGreaterThan(TEXT_MODEL_OVERHEAD_MULTIPLIER);
  });

  it('uses the flat CPU multiplier for CPU / unset backend', () => {
    expect(textOverheadMultiplier(INFERENCE_BACKENDS.CPU)).toBe(TEXT_MODEL_OVERHEAD_MULTIPLIER);
    expect(textOverheadMultiplier(undefined)).toBe(TEXT_MODEL_OVERHEAD_MULTIPLIER);
  });
});
