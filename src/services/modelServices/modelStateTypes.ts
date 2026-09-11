import { DownloadedModel, ONNXImageModel, INFERENCE_BACKENDS } from '../../types';
import {
  TEXT_ACCELERATED_MEMORY_MULTIPLIER,
  TEXT_CPU_MEMORY_MULTIPLIER,
  textRuntimeMemoryMultiplier,
} from '@offgrid/models';

export type ModelType = 'text' | 'image';

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

// Shared owns the memory estimate multipliers and residency budget policy.
// Mobile keeps these aliases only for native-adapter compatibility.
export const TEXT_MODEL_OVERHEAD_MULTIPLIER = TEXT_CPU_MEMORY_MULTIPLIER;
export const TEXT_MODEL_GPU_OVERHEAD_MULTIPLIER =
  TEXT_ACCELERATED_MEMORY_MULTIPLIER;
export function textOverheadMultiplier(inferenceBackend?: string): number {
  return textRuntimeMemoryMultiplier(
    !!inferenceBackend && inferenceBackend !== INFERENCE_BACKENDS.CPU,
  );
}
