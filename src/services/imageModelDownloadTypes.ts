import type { ONNXImageModel } from '../types';
import type { AlertState } from '../utils/alertState';

export interface ImageDownloadDeps {
  addDownloadedImageModel: (model: ONNXImageModel) => void;
  activeImageModelId: string | null;
  /** User-selection intent. The shared LLM service owns the persisted projection. */
  selectActiveImageModel: (model: ONNXImageModel) => Promise<void>;
  setAlertState: (state: AlertState) => void;
  triedImageGen: boolean;
}

export interface ImageModelDescriptor {
  id: string;
  name: string;
  description: string;
  downloadUrl: string;
  size: number;
  style: string;
  backend: 'mnn' | 'qnn' | 'coreml';
  variant?: string;
  huggingFaceRepo?: string;
  huggingFaceFiles?: { path: string; size: number }[];
  coremlFiles?: { path: string; relativePath: string; size: number; downloadUrl: string }[];
  repo?: string;
  attentionVariant?: 'split_einsum' | 'original';
}
