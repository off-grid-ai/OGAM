import { INFERENCE_BACKENDS, type InferenceBackend } from '../types';

/** Hardware candidates, ordered before the CPU fallback appended by LLMService in Auto mode. */
export type TextAccelerator = 'htp' | 'vulkan' | 'opencl';

export type AcceleratorAvailability = {
  npu: boolean;
  vulkan: boolean;
  opencl: boolean;
};

/**
 * Prioritize NPU when the model filename identifies an eligible quantization,
 * then attempt Vulkan and OpenCL. Native loading remains the definitive test.
 * Vulkan text currently has no projector/multimodal support.
 */
export function acceleratorCandidates(
  availability: AcceleratorAvailability,
  modelPath: string,
  vision: boolean,
): TextAccelerator[] {
  const result: TextAccelerator[] = [];
  const eligibleHtpQuant = /(?:^|[-_.])(q4_0|q8_0)(?:[-_.]|$)/i.test(
    modelPath.split('/').pop() ?? modelPath,
  );
  // NPU first (fastest for Q4_0/Q8_0 text), then OpenCL: the mature llama.rn GPU path on
  // Adreno that keeps tools and vision. Vulkan (no tools/vision yet) is next, so Mali and
  // other GPUs without OpenCL still get the GPU: for a model with a picture file it loads
  // text only (a GPU text chat beats CPU with pictures). CPU is appended last by LLMService.
  if (availability.npu && eligibleHtpQuant && !vision) result.push('htp');
  if (availability.opencl) result.push('opencl');
  if (availability.vulkan) result.push('vulkan');
  return result;
}

export function isExplicitAndroidAccelerator(backend: InferenceBackend): boolean {
  return backend === INFERENCE_BACKENDS.HTP ||
    backend === INFERENCE_BACKENDS.VULKAN ||
    backend === INFERENCE_BACKENDS.OPENCL;
}

/** Prevent loading a context with n_gpu_layers=0 under an accelerated label. */
export function requireGpuLayers(backend: TextAccelerator, layers: number): void {
  if (!Number.isFinite(layers) || layers <= 0) {
    throw new Error(
      `No GPU/NPU layers can be allocated for ${backend}. Reduce model/context size or select CPU explicitly.`,
    );
  }
}
