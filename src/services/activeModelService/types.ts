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
export const TEXT_MODEL_OVERHEAD_MULTIPLIER = 1.5; // KV cache, activations, etc.
// Core ML is more efficient than ONNX runtime
export const IMAGE_MODEL_OVERHEAD_MULTIPLIER = Platform.OS === 'ios' ? 1.5 : 1.8;
