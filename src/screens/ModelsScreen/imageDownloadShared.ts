import RNFS from 'react-native-fs';
import { showAlert } from '../../components/CustomAlert';
import { modelManager } from '../../services';
import { ONNXImageModel } from '../../types';
import { isActiveStatus, useDownloadStore } from '../../stores/downloadStore';
import { makeImageModelKey } from '../../utils/modelKey';
import { ImageDownloadDeps, ImageModelDescriptor } from './types';

export interface ImageDownloadMetadata {
  imageDownloadType: 'zip' | 'multifile';
  imageModelName: string;
  imageModelDescription: string;
  imageModelSize: number;
  imageModelStyle?: string;
  imageModelBackend?: 'mnn' | 'qnn' | 'coreml';
  imageModelRepo?: string;
  imageModelAttentionVariant?: string;
  imageModelDownloadUrl?: string;
  imageModelHuggingFaceFiles?: { path: string; size: number }[];
  imageModelCoremlFiles?: {
    path: string;
    relativePath: string;
    size: number;
    downloadUrl: string;
  }[];
}

export function isCancelledDownloadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.message === 'user_cancelled' ||
    (error as Error & { cancelled?: boolean }).cancelled === true
  );
}

export async function cleanupImageModelDir(modelId: string): Promise<void> {
  try {
    const dir = `${modelManager.getImageModelsDirectory()}/${modelId}`;
    if (await RNFS.exists(dir)) await RNFS.unlink(dir);
  } catch {
    /* ignore cleanup errors */
  }
}

export function removeImageDownloadEntry(modelId: string): void {
  useDownloadStore.getState().remove(makeImageModelKey(modelId));
}

export function buildDownloadedImageModel(
  modelInfo: ImageModelDescriptor,
  modelPath: string,
): ONNXImageModel {
  return {
    id: modelInfo.id,
    name: modelInfo.name,
    description: modelInfo.description,
    modelPath,
    downloadedAt: new Date().toISOString(),
    size: modelInfo.size,
    style: modelInfo.style,
    backend: modelInfo.backend,
    attentionVariant: modelInfo.attentionVariant,
  };
}

export async function registerAndNotify(
  deps: ImageDownloadDeps,
  opts: { imageModel: ONNXImageModel; modelName: string },
): Promise<void> {
  const { imageModel, modelName } = opts;
  await modelManager.addDownloadedImageModel(imageModel);
  deps.addDownloadedImageModel(imageModel);
  if (!deps.activeImageModelId && deps.triedImageGen) {
    deps.setActiveImageModelId(imageModel.id);
  }
  removeImageDownloadEntry(imageModel.id);
  deps.setAlertState(
    showAlert('Success', `${modelName} downloaded successfully!`),
  );
}

export function addImageDownloadEntry(opts: {
  modelId: string;
  downloadId: string;
  fileName: string;
  totalBytes: number;
  metadata: ImageDownloadMetadata;
}): boolean {
  const { modelId, downloadId, fileName, totalBytes, metadata } = opts;
  const modelKey = makeImageModelKey(modelId);
  const existing = useDownloadStore.getState().downloads[modelKey];
  if (existing && isActiveStatus(existing.status)) return false;
  if (existing) {
    useDownloadStore.getState().retryEntry(modelKey, downloadId);
    return true;
  }
  useDownloadStore.getState().add({
    modelKey,
    downloadId,
    modelId: `image:${modelId}`,
    fileName,
    quantization: '',
    modelType: 'image',
    status: 'pending',
    bytesDownloaded: 0,
    totalBytes,
    combinedTotalBytes: totalBytes,
    progress: 0,
    createdAt: Date.now(),
    metadataJson: JSON.stringify(metadata),
  });
  return true;
}
