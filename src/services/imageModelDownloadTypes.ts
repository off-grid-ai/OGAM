import type { ONNXImageModel } from '../types';
import type { AlertState } from '../utils/alertState';

export interface ImageDownloadDeps {
  addDownloadedImageModel: (model: ONNXImageModel) => void;
  activeImageModelId: string | null;
  setActiveImageModelId: (id: string) => void;
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
  backend: 'mnn' | 'qnn' | 'coreml' | 'sd';
  variant?: string;
  huggingFaceRepo?: string;
  huggingFaceFiles?: { path: string; size: number; downloadUrl?: string; sha256?: string }[];
  coremlFiles?: { path: string; relativePath: string; size: number; downloadUrl: string }[];
  repo?: string;
  attentionVariant?: 'split_einsum' | 'original';
}
