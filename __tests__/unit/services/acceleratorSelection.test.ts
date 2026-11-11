import { acceleratorCandidates, isExplicitAndroidAccelerator, requireGpuLayers } from '../../../src/services/acceleratorSelection';

describe('text accelerator candidate selection', () => {
  it('prefers NPU for eligible models, then OpenCL, then Vulkan', () => {
    expect(acceleratorCandidates({ npu: true, vulkan: true, opencl: true }, '/models/qwen-Q4_0.gguf', false))
      .toEqual(['htp', 'opencl', 'vulkan']);
  });
  it('skips NPU on unsupported quantization and never adds CPU', () => {
    expect(acceleratorCandidates({ npu: true, vulkan: true, opencl: true }, '/models/qwen-Q5_K_M.gguf', false))
      .toEqual(['opencl', 'vulkan']);
    expect(acceleratorCandidates({ npu: false, vulkan: false, opencl: false }, 'x.gguf', false)).toEqual([]);
  });
  it('keeps pictures on OpenCL first, then uses Vulkan text-only before falling back to CPU', () => {
    expect(acceleratorCandidates({ npu: true, vulkan: true, opencl: true }, 'model-Q4_0.gguf', true))
      .toEqual(['opencl', 'vulkan']);
    // A Mali tablet (no OpenCL): the GPU still runs the model's text.
    expect(acceleratorCandidates({ npu: false, vulkan: true, opencl: false }, 'qwen3.5-4b-Q4_K_M.gguf', true))
      .toEqual(['vulkan']);
  });
  it('distinguishes manual accelerators from CPU and future Auto mode', () => {
    expect(isExplicitAndroidAccelerator('vulkan')).toBe(true);
    expect(isExplicitAndroidAccelerator('opencl')).toBe(true);
    expect(isExplicitAndroidAccelerator('htp')).toBe(true);
    expect(isExplicitAndroidAccelerator('cpu')).toBe(false);
    expect(isExplicitAndroidAccelerator('auto')).toBe(false);
  });
  it('rejects an accelerator if memory caps leave zero offloaded layers', () => {
    expect(() => requireGpuLayers('opencl', 0)).toThrow('select CPU explicitly');
    expect(() => requireGpuLayers('htp', -1)).toThrow();
    expect(() => requireGpuLayers('vulkan', 8)).not.toThrow();
  });
});
