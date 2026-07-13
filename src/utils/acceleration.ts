/**
 * Hardware-acceleration eligibility — the SINGLE source of truth for "can this
 * model actually use the GPU/NPU?".
 *
 * Grounded in what llama.rn / llama.cpp actually accelerate on-device:
 *  - HTP/Hexagon NPU repacks only Q4_0, Q8_0 (and MXFP4). A K-quant (Q4_K_M)
 *    loads but silently runs on CPU — no speedup.
 *  - The Adreno OpenCL GPU backend is optimized for Q4_0 (llama.rn restricts it to
 *    Q4_0/Q6_K).
 *  - LiteRT (.litertlm) models run on the GPU natively.
 * So the accelerable GGUF quants are Q4_0 / Q8_0; LiteRT files are always GPU.
 * See docs/plans/best-backend-per-device.md and the HTP/OpenCL research.
 */
import { ModelInfo, ModelFile, InferenceBackend, INFERENCE_BACKENDS } from '../types';

/** GGUF quantizations the NPU (HTP) / GPU (OpenCL) backends actually accelerate. */
export const ACCELERABLE_QUANTS = ['Q4_0', 'Q8_0'] as const;

/** True when a GGUF quant is one the NPU/GPU backends accelerate (not a K-quant). */
export function isAccelerableQuant(quant: string | undefined | null): boolean {
  if (!quant) return false;
  const q = quant.toUpperCase();
  return ACCELERABLE_QUANTS.some(a => a === q);
}

/** A LiteRT model file runs on the GPU regardless of GGUF quant. */
function isLiteRTFile(file: ModelFile): boolean {
  return file.name.toLowerCase().endsWith('.litertlm') || file.quantization?.toLowerCase() === 'litert';
}

/**
 * Whether a model can run on the GPU/NPU: it ships a LiteRT file, or a GGUF file in
 * an accelerable quant (Q4_0/Q8_0) the user can pick. A model that only offers
 * K-quants (Q4_K_M) returns false — enabling NPU/GPU for it would silently fall
 * back to CPU, so we neither badge nor prioritize it.
 */
export function modelSupportsNpuGpu(model: Pick<ModelInfo, 'files'>): boolean {
  return (model.files ?? []).some(f => isLiteRTFile(f) || isAccelerableQuant(f.quantization));
}

/** The device's llama.rn acceleration options (from hardwareService.getAccelerationCapability). */
export interface AccelerationCapability {
  hasNpu: boolean;
  hasGpu: boolean;
}

/** A downloaded llama model that can actually use the NPU/GPU (accelerable quant). */
export function isDownloadedModelAccelerable(m: { engine?: string; quantization?: string }): boolean {
  return m.engine === 'llama' && isAccelerableQuant(m.quantization);
}

/**
 * An accelerable (Q4_0/Q8_0) build of the SAME base model as `active`, if one is
 * downloaded. Must be the same model — suggesting a different, smaller model (E2B when
 * the user loaded E4B) is a downgrade, not "run your model on the GPU/NPU". The display
 * name is derived from the repo id, so every quant of a repo shares it (e.g. both E4B
 * quants are "gemma-4-E4B-it-GGUF"), which cleanly separates E4B from E2B.
 */
export function findAccelerableModel<T extends { id: string; name: string; engine?: string; quantization?: string }>(
  models: T[],
  active: { id: string; name: string } | undefined,
): T | null {
  if (!active) return null;
  return models.find(
    m => m.id !== active.id && m.name === active.name && isDownloadedModelAccelerable(m),
  ) ?? null;
}

/** Llama-family model (name-based) — the only family we'll suggest the experimental NPU for. */
export function isLlamaFamily(modelName: string | undefined): boolean {
  return /llama/i.test(modelName ?? '');
}

/**
 * The accelerator we're willing to RECOMMEND for this model, or null (don't nudge):
 *  - GPU (OpenCL) whenever the device has it — it's the reliable backend on Adreno/Mali.
 *  - NPU (HTP) ONLY on a device with no GPU AND only for Llama-family models — the NPU
 *    is experimental and broken for e.g. Gemma, so we never steer those to it.
 * Everything else → null (no recommendation), so we don't push a backend that won't help.
 */
export function recommendedAccelerator(
  capability: AccelerationCapability,
  modelName: string | undefined,
): 'gpu' | 'npu' | null {
  if (capability.hasGpu) return 'gpu';
  if (capability.hasNpu && isLlamaFamily(modelName)) return 'npu';
  return null;
}

/**
 * What the chat acceleration tip should offer, given the device, the active model, and
 * what's already downloaded:
 *  - `enable`   — on CPU with an already-accelerable model (Q4_0/Q8_0); flip to the
 *                 recommended backend for a real speedup.
 *  - `switch`   — the active model is a K-quant (can't use the accelerator) but an
 *                 accelerable build of the SAME model is downloaded; switch to it.
 *  - `download` — a K-quant is active and no accelerable build exists locally.
 *  - `hidden`   — remote/LiteRT model, no RECOMMENDABLE accelerator (see
 *                 recommendedAccelerator — GPU-first, NPU only for Llama), or already
 *                 genuinely accelerated.
 *
 * `fellBack` distinguishes the two ways `switch`/`download` arise: on CPU it's a "go
 * faster" nudge; when the user HAS selected an accelerator but the active K-quant can't
 * use it, it's a "we're on CPU" warning. `backend` is the recommended accelerator so the
 * copy names the right one (never NPU on a GPU device).
 */
export type AccelerationAction = 'enable' | 'switch' | 'download' | 'hidden';

export interface AccelerationPlan {
  action: AccelerationAction;
  /** The accelerator being recommended — drives the copy (GPU vs NPU). */
  backend: 'gpu' | 'npu';
  /** True when an accelerated backend is selected but the active model can't use it. */
  fellBack: boolean;
  /** For `switch`: the downloaded accelerable model to activate. */
  targetModelId?: string;
  targetModelName?: string;
}

function isAcceleratedBackend(backend: InferenceBackend | undefined): boolean {
  return backend === INFERENCE_BACKENDS.HTP || backend === INFERENCE_BACKENDS.OPENCL;
}

export function planAcceleration(params: {
  engine: string | undefined;
  isRemote: boolean;
  inferenceBackend: InferenceBackend | undefined;
  capability: AccelerationCapability;
  activeQuant: string | undefined;
  modelName: string | undefined;
  downloadedAccelerable: { id: string; name: string } | null;
}): AccelerationPlan {
  const { engine, isRemote, inferenceBackend, capability, activeQuant, modelName, downloadedAccelerable } = params;
  const rec = recommendedAccelerator(capability, modelName);
  const hidden: AccelerationPlan = { action: 'hidden', backend: rec ?? 'gpu', fellBack: false };
  if (isRemote || engine !== 'llama') return hidden;
  if (!rec) return hidden; // no accelerator worth recommending for this model

  const accelerated = isAcceleratedBackend(inferenceBackend);
  const activeAccelerable = isAccelerableQuant(activeQuant);
  // Genuinely accelerated (accelerated backend + a model that can use it) → nothing to do.
  if (accelerated && activeAccelerable) return hidden;
  // On CPU with an accelerable model → offer to turn the recommended accelerator on.
  if (!accelerated && activeAccelerable) return { action: 'enable', backend: rec, fellBack: false };

  // Remaining: the active model is a K-quant. Either on CPU (nudge) or an accelerator is
  // selected but the K-quant repacked to CPU (fallback warning). Route to an accelerable
  // build of the SAME model — switch if downloaded, else download.
  const fellBack = accelerated;
  if (downloadedAccelerable) {
    return { action: 'switch', backend: rec, fellBack, targetModelId: downloadedAccelerable.id, targetModelName: downloadedAccelerable.name };
  }
  return { action: 'download', backend: rec, fellBack };
}

/** The concrete backend to switch to for the recommended accelerator (GPU → OpenCL, NPU → HTP). */
export function acceleratedBackendFor(
  capability: AccelerationCapability,
  modelName: string | undefined,
): InferenceBackend {
  return recommendedAccelerator(capability, modelName) === 'npu'
    ? INFERENCE_BACKENDS.HTP
    : INFERENCE_BACKENDS.OPENCL;
}

/**
 * The HuggingFace search term to prefill on the Models tab so the user can grab an
 * accelerable (Q4_0) build of the model they're on. Strips a trailing quant suffix
 * (…-Q4_K_M) from the model id and its author prefix, then appends the target quant.
 */
export function acceleratedSearchQuery(modelId: string | undefined | null): string {
  if (!modelId) return 'Q4_0';
  const base = modelId.split('/').pop() ?? modelId;
  const withoutQuant = base.replace(/[-_.]?Q\d[_.].*$/i, '').replace(/[-_.]?(gguf|litertlm)$/i, '');
  return `${withoutQuant.trim()} Q4_0`.trim();
}
