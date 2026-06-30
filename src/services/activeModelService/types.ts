import { Platform } from 'react-native';
import { DownloadedModel, ONNXImageModel } from '../../types';

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
  /**
   * True when a critical block is caused by OTHER models already being loaded,
   * i.e. unloading them would free enough room for this one. When false on a
   * critical result, the model is too large for the device even on its own and
   * unloading cannot help. The UI uses this to decide whether to offer an
   * "unload others & load" recovery action instead of a dead-end alert.
   */
  resolvableByUnload: boolean;
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

// Memory safety thresholds — dynamic budget based on device total RAM.
// iOS enforces per-process jetsam limits that are stricter than total RAM would suggest:
//   ≤4 GB devices (iPhone XS/XR/11/SE2/SE3): ~2 GB limit → use 40% of RAM
//   >4 GB devices: ~60% of RAM is safe
export const getMemoryBudgetPercent = (totalMemoryGB: number): number =>
  totalMemoryGB <= 4 ? 0.40 : 0.60;
export const getMemoryWarningPercent = (totalMemoryGB: number): number =>
  totalMemoryGB <= 4 ? 0.30 : 0.50;
export const TEXT_MODEL_OVERHEAD_MULTIPLIER = 1.5; // KV cache, activations, etc.
// Core ML is more efficient than ONNX runtime
export const IMAGE_MODEL_OVERHEAD_MULTIPLIER = Platform.OS === 'ios' ? 1.5 : 1.8;
