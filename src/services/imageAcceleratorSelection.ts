/**
 * Image inference uses distinct native runtimes. Never route a checkpoint into a
 * different model format's runtime. Imported (sd.cpp) checkpoints can run on the
 * Vulkan or the OpenCL diffusion engine; CPU requires explicit selection. The
 * plan carries supported GPU backends for retry, never a silent CPU downgrade.
 */
export type ImageComputeMode = 'auto' | 'gpu' | 'cpu' | 'vulkan' | 'opencl';
export type ImageBackend = 'sdcpp' | 'mnn' | 'qnn' | 'coreml' | string;
type SdBackend = 'vulkan' | 'opencl' | 'cpu';
export type ImageComputeDecision = {
  useOpenCL: boolean;
  selected: 'vulkan' | 'opencl' | 'npu' | 'cpu' | 'coreml';
  note: string;
  /** sd.cpp engine for this attempt. */
  computeBackend?: SdBackend;
  /** sd.cpp: what to try, in order, if this attempt fails. */
  fallbacks?: ImageComputeDecision[];
};
type GpuProbe = () => Promise<{ enumerated: boolean; detail: string }>;
type Probes = {
  vulkan: GpuProbe;
  /** The OpenCL diffusion engine's device probe (absent in older APKs). */
  sdOpencl?: GpuProbe;
  opencl: () => Promise<{ supported: boolean; reason?: string }>;
  npu: () => Promise<boolean>;
};

/** Defaults to Auto; legacy explicit CPU setting remains respected by migration. */
export function imageComputeMode(settings: {
  imageBackendMode?: ImageComputeMode; imageUseOpenCL?: boolean;
}): ImageComputeMode {
  return settings.imageBackendMode ??
    (settings.imageUseOpenCL === false ? 'cpu' : 'auto');
}

const SD_LABEL: Record<SdBackend, string> = { vulkan: 'Vulkan', opencl: 'OpenCL', cpu: 'CPU' };
const sdAttempt = (backend: SdBackend, note: string): ImageComputeDecision => ({
  useOpenCL: backend !== 'cpu', selected: backend, computeBackend: backend, note,
});

/** Auto: Vulkan, then OpenCL, then CPU. A chosen GPU engine is tried first, then CPU. */
async function planSdcpp(mode: ImageComputeMode, probe: Probes, allowCpuFallback: boolean): Promise<ImageComputeDecision> {
  const gpus: Array<'vulkan' | 'opencl'> = mode === 'opencl' ? ['opencl']
    : mode === 'vulkan' || mode === 'gpu' ? ['vulkan'] : ['vulkan', 'opencl'];
  const plan: ImageComputeDecision[] = [];
  const skipped: string[] = [];
  for (const api of gpus) {
    const run = api === 'opencl' ? probe.sdOpencl : probe.vulkan;
    let found: { enumerated: boolean; detail: string } | null = null;
    try { found = run ? await run() : null; } catch (e: any) { found = { enumerated: false, detail: e?.message || String(e) }; }
    if (found?.enumerated) plan.push(sdAttempt(api, `${SD_LABEL[api]  } device detected; diffusion shaders still need to execute`));
    else skipped.push(`${SD_LABEL[api]  } unavailable (${  found?.detail || 'not in this build'  })`);
  }
  if (allowCpuFallback) plan.push(sdAttempt('cpu', 'CPU fallback explicitly allowed in image settings'));
  if (!plan.length) {
    throw new Error(`This phone's GPU cannot run this image model (${skipped.join('; ')}). To make images on the CPU instead (slower), open Settings > Model Settings and set the image engine to CPU, or turn on Allow slow CPU fallback.`);
  }
  const [first, ...rest] = plan;
  return { ...first, note: skipped.length && first.computeBackend !== 'cpu' ? `${first.note  }. ${  skipped.join('; ')}` : first.note, fallbacks: rest };
}

export async function selectImageAccelerator(
  backend: ImageBackend,
  mode: ImageComputeMode,
  probe: Probes,
  options: { allowCpuFallback?: boolean } = {},
): Promise<ImageComputeDecision> {
  const { allowCpuFallback = false } = options;
  if (backend === 'coreml') {
    if (mode === 'cpu')
      throw new Error('Core ML CPU-only execution is not selectable in this image runtime.');
    return { useOpenCL: false, selected: 'coreml', note: 'Core ML backend selected' };
  }
  if (mode === 'cpu') {
    if (backend === 'sdcpp') return sdAttempt('cpu', 'CPU explicitly selected');
    if (backend === 'qnn') {
      throw new Error('This image package contains NPU weights, not CPU weights. Import a CPU/MNN version to select CPU.');
    }
    return { useOpenCL: false, selected: 'cpu', note: 'CPU explicitly selected' };
  }
  if (backend === 'sdcpp') return planSdcpp(mode, probe, allowCpuFallback && mode === 'auto');
  if (mode === 'vulkan' || mode === 'opencl') mode = 'gpu'; // other runtimes have one accelerator
  if (backend === 'mnn') {
    const gpu = await probe.opencl().catch(() => ({ supported: false, reason: 'probe failed' }));
    if (!gpu?.supported) {
      if (mode === 'auto' && allowCpuFallback) return { useOpenCL: false, selected: 'cpu', note: 'CPU fallback explicitly allowed in image settings' };
      throw new Error(`OpenCL not detected for this image model (${  gpu.reason ?? 'unknown reason'  }). CPU was not chosen automatically; select CPU explicitly.`);
    }
    return { useOpenCL: true, selected: 'opencl',
      note: 'OpenCL requested; MNN compute support must be confirmed by rendering' };
  }
  if (backend === 'qnn') {
    if (!await probe.npu())
      throw new Error('This image package requires an NPU, but no supported NPU was found. CPU was not chosen automatically.');
    return { useOpenCL: false, selected: 'npu',
      note: 'QNN NPU package selected; no CPU fallback permitted' };
  }
  throw new Error(`Unknown image model backend: ${  backend}`);
}
