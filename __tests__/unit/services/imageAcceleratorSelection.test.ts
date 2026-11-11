import { imageComputeMode, selectImageAccelerator } from '../../../src/services/imageAcceleratorSelection';

const probes = () => ({
  vulkan: jest.fn(async () => ({ enumerated: true, detail: 'vulkan0' })),
  opencl: jest.fn(async () => ({ supported: true })),
  npu: jest.fn(async () => true),
});
describe('image runtime accelerator selection', () => {
  it('defaults to Auto and respects a migrated manual CPU setting', () => {
    expect(imageComputeMode({ imageUseOpenCL: true })).toBe('auto');
    expect(imageComputeMode({ imageUseOpenCL: false })).toBe('cpu');
    expect(imageComputeMode({ imageBackendMode: 'gpu', imageUseOpenCL: false })).toBe('gpu');
  });
  it('selects Vulkan only for native imported checkpoints', async () => {
    const probe = probes();
    expect((await selectImageAccelerator('sdcpp', { mode: 'auto' }, probe)).selected).toBe('vulkan');
    expect(probe.opencl).not.toHaveBeenCalled();
  });
  // Auto falls back to CPU with a visible note (audit G13).
  it('Auto falls back to CPU (with a note) when no diffusion GPU is found', async () => {
    const probe = probes();
    probe.vulkan.mockResolvedValue({ enumerated: false, detail: 'no supported GPU' });
    const auto = await selectImageAccelerator('sdcpp', { mode: 'auto', allowCpuFallback: true }, probe);
    expect(auto.selected).toBe('cpu');
    expect(auto.note).toMatch(/CPU fallback/);
    expect(probe.opencl).not.toHaveBeenCalled();
  });
  it('plans Vulkan, then OpenCL, then CPU for imported checkpoints in Auto', async () => {
    const probe = { ...probes(), sdOpencl: jest.fn(async () => ({ enumerated: true, detail: 'GPUOpenCL' })) };
    const plan = await selectImageAccelerator('sdcpp', { mode: 'auto', allowCpuFallback: true }, probe);
    expect([plan.computeBackend, ...(plan.fallbacks ?? []).map(f => f.computeBackend)]).toEqual(['vulkan', 'opencl', 'cpu']);
    probe.vulkan.mockResolvedValue({ enumerated: false, detail: 'no device' });
    const noVulkan = await selectImageAccelerator('sdcpp', { mode: 'auto', allowCpuFallback: true }, probe);
    expect([noVulkan.computeBackend, ...(noVulkan.fallbacks ?? []).map(f => f.computeBackend)]).toEqual(['opencl', 'cpu']);
  });
  it('a chosen OpenCL or Vulkan engine is tried first, then the CPU', async () => {
    const probe = { ...probes(), sdOpencl: jest.fn(async () => ({ enumerated: true, detail: 'GPUOpenCL' })) };
    const opencl = await selectImageAccelerator('sdcpp', { mode: 'opencl' }, probe);
    expect([opencl.computeBackend, ...(opencl.fallbacks ?? []).map(f => f.computeBackend)]).toEqual(['opencl']);
    expect(probe.vulkan).not.toHaveBeenCalled();
    const vulkan = await selectImageAccelerator('sdcpp', { mode: 'vulkan' }, probe);
    expect([vulkan.computeBackend, ...(vulkan.fallbacks ?? []).map(f => f.computeBackend)]).toEqual(['vulkan']);
  });
  it('uses OpenCL for MNN in Auto when present, else CPU; GPU mode requires it', async () => {
    const probe = probes();
    expect((await selectImageAccelerator('mnn', { mode: 'auto' }, probe)).selected).toBe('opencl');
    probe.opencl.mockResolvedValue({ supported: false });
    expect((await selectImageAccelerator('mnn', { mode: 'auto', allowCpuFallback: true }, probe)).selected).toBe('cpu');
    await expect(selectImageAccelerator('mnn', { mode: 'gpu' }, probe)).rejects.toThrow('OpenCL not detected');
  });
  it('does not silently choose CPU when fallback permission is absent', async () => {
    const probe = probes();
    probe.vulkan.mockResolvedValue({ enumerated: false, detail: 'not detected' });
    await expect(selectImageAccelerator('sdcpp', { mode: 'auto' }, probe)).rejects.toThrow('set the image engine to CPU');
    probe.opencl.mockResolvedValue({ supported: false });
    await expect(selectImageAccelerator('mnn', { mode: 'auto' }, probe)).rejects.toThrow('CPU was not chosen automatically');
  });
  it('honors manual CPU only with an eligible image runtime', async () => {
    const probe = probes();
    expect((await selectImageAccelerator('sdcpp', { mode: 'cpu' }, probe)).selected).toBe('cpu');
    expect(probe.vulkan).not.toHaveBeenCalled();
    await expect(selectImageAccelerator('qnn', { mode: 'cpu' }, probe)).rejects.toThrow('NPU weights');
  });
  it('does not fall back from QNN NPU to MNN/CPU', async () => {
    const probe = probes();
    probe.npu.mockResolvedValue(false);
    await expect(selectImageAccelerator('qnn', { mode: 'auto' }, probe)).rejects.toThrow('requires an NPU');
  });
});
