import { Platform } from 'react-native';
import { DownloadedModel, ONNXImageModel, INFERENCE_BACKENDS } from '../../types';

export type ModelType = 'text' | 'image';

export type MemoryCheckSeverity = 'safe' | 'warning' | 'critical' | 'blocked';

export interface MemoryCheckResult {
  canLoad: boolean;
  severity: MemoryCheckSeverity;
  availableMemoryGB: number;
  requiredMemoryGB: number;
  currentlyLoadedMemoryGB: number;
  totalRequiredMemoryGB: number;
  remainingAfterLoadGB: number;
  message: string;
}

export interface ActiveModelInfo {
  text: {
    model: DownloadedModel | null;
    isLoaded: boolean;
    isLoading: boolean;
  };
  image: {
    model: ONNXImageModel | null;
    isLoaded: boolean;
    isLoading: boolean;
  };
}

export interface ResourceUsage {
  memoryUsed: number;
  memoryTotal: number;
  memoryAvailable: number;
  memoryUsagePercent: number;
  /** Estimated memory used by loaded models (from file sizes) */
  estimatedModelMemory: number;
}

export type ModelChangeListener = (info: ActiveModelInfo) => void;

// The safe RAM fraction per device tier now lives in the single memory-budget
// owner (src/services/memoryBudget.ts): modelBudgetFraction / modelMemoryBudgetMB,
// so residency, the pre-load check, and the model lists all agree. The old flat
// getMemoryBudgetPercent/getMemoryWarningPercent (60% for every device >4GB) were
// removed — they wrongly treated a 12GB iPhone like a 6GB one.
export const TEXT_MODEL_OVERHEAD_MULTIPLIER = 1.5; // CPU: KV cache, activations, etc.
// GPU/NPU offload keeps working buffers in SYSTEM RAM on top of the weights, which the flat CPU 1.5×
// undercounts — so Aggressive co-resided text + image on an estimate that ignored the GPU buffers, then
// OOM'd with them on top (device 2026-07-14, footprint 8.2GB est → 11.4GB real). Mirror the image
// estimator's ANE(1.8)→GPU(2.5) bump so the fit check reserves GPU headroom.
export const TEXT_MODEL_GPU_OVERHEAD_MULTIPLIER = 2.2;
/** The text-model RAM overhead multiplier for the SELECTED backend — GPU-aware (single source). */
export function textOverheadMultiplier(inferenceBackend?: string): number {
  return inferenceBackend && inferenceBackend !== INFERENCE_BACKENDS.CPU
    ? TEXT_MODEL_GPU_OVERHEAD_MULTIPLIER
    : TEXT_MODEL_OVERHEAD_MULTIPLIER;
}
// Core ML is more efficient than ONNX runtime
export const IMAGE_MODEL_OVERHEAD_MULTIPLIER = Platform.OS === 'ios' ? 1.5 : 1.8;
