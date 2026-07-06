/**
 * Backend resolver — the SINGLE place the "which inference backend should we
 * default to on this device" decision lives, as a PURE function of declared
 * capabilities. Views and the boot sync depend on this, never on scattered
 * `Platform.OS`/GPU branches.
 *
 * Rules (best available compute per device, safely):
 *  - iOS always defaults to Metal (the GPU path is the right default there).
 *  - Android defaults to the NPU (HTP) ONLY on a proven flagship Qualcomm
 *    (8gen1/8gen2), where the Hexagon path is reliable. The `min` catch-all
 *    variant covers every other Snapdragon and is NOT auto-defaulted to the beta
 *    NPU (warm-up + unproven per chip) — it gets GPU. NPU stays user-selectable
 *    on any hasNPU device via the settings UI.
 *  - Otherwise Android defaults to OpenCL (GPU) when supported, else CPU.
 *
 * The static store default stays CPU on Android as a safe fallback; this
 * resolver upgrades it at boot (see backendSync) so users' GPU/NPU is actually
 * used instead of sitting idle.
 */
import { InferenceBackend, LiteRTBackend, INFERENCE_BACKENDS } from '../types';

/** Declared device capabilities the default depends on. */
export interface BackendCapabilities {
  platform: 'ios' | 'android';
  openCLSupported: boolean;
  /** NPU (Hexagon HTP) usable on this device: hasNPU AND the build/flag enables it. */
  npuSupported?: boolean;
  /** QNN tier; only flagship variants are auto-defaulted to the NPU. */
  npuVariant?: '8gen2' | '8gen1' | 'min';
}

/** Flagship Qualcomm tiers where auto-defaulting to the NPU is proven-safe. */
function isFlagshipNpu(caps: BackendCapabilities): boolean {
  return !!caps.npuSupported && (caps.npuVariant === '8gen2' || caps.npuVariant === '8gen1');
}

/** The one platform+capability -> llama inference backend mapping. */
export function resolveDefaultBackend(caps: BackendCapabilities): InferenceBackend {
  if (caps.platform === 'ios') return INFERENCE_BACKENDS.METAL;
  if (isFlagshipNpu(caps)) return INFERENCE_BACKENDS.HTP;
  return caps.openCLSupported ? INFERENCE_BACKENDS.OPENCL : INFERENCE_BACKENDS.CPU;
}

/** The one capability -> LiteRT backend mapping (GPU when OpenCL is available).
 *  LiteRT's own NPU path is not exposed/verified, so it is not auto-selected. */
export function resolveDefaultLiteRTBackend(caps: BackendCapabilities): LiteRTBackend {
  return caps.openCLSupported ? 'gpu' : 'cpu';
}
