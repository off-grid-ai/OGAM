// From its own module, not the `../../services` barrel: the barrel constructs ImageGenerationService
// at import and throws without the facade, which made this pure projection unloadable in isolation.
import { hardwareService } from '../../services/hardware';
import { DownloadedModel, ONNXImageModel } from '../../types';
import { DownloadItem } from './items';
import { imageBackendLabel } from '../../utils/imageBackend';
import { downloadFileRoleLabel } from '../../utils/downloadStatus';
import type { ModelsSnapshot } from '@offgrid/application';
import { mobileImageDownloadMetadata } from '../../services/modelServices/modelDownloadRequests';

/**
 * How a download store row, a queued start, or a finished model becomes one Download Manager row.
 *
 * Pure projection: no hooks, no store reads, no IO. The screen decides WHEN to build a row; this
 * module decides WHAT the row says, so the naming, the id and the dedup key can be reasoned about
 * (and read back) without a rendered screen.
 */

function getImageAuthor(backend?: string): string {
  return imageBackendLabel(backend, 'Image Generation');
}

/** Facade projection row to presentation data. No registry or platform-store read. */
export function facadeDownloadToActiveItem(
  entry: ModelsSnapshot['control']['downloads'][number],
): DownloadItem {
  const modelType = entry.modelType;
  if (modelType !== 'text' && modelType !== 'image' && modelType !== 'stt' && modelType !== 'tts') {
    throw new Error(`Download has an invalid model type: ${String(modelType)}`);
  }
  const image = modelType === 'image'
    ? mobileImageDownloadMetadata(entry.metadataJson)
    : undefined;
  const total = entry.totalBytes;
  return {
    type: 'active',
    modelType,
    downloadId: entry.downloadId,
    modelKey: entry.modelKey,
    modelId: entry.modelId,
    // A multi-file model names the part it is fetching by its published ROLE, so a projector
    // reads as "Vision support" rather than an opaque filename. Image models keep their own name.
    fileName: image?.imageModelName ?? downloadFileRoleLabel(entry.currentFileRole, entry.fileName),
    author: image
      ? getImageAuthor(image.imageModelBackend)
      : entry.modelId.split('/')[0] ?? 'Unknown',
    quantization: image?.imageModelBackend === 'coreml' ? 'Core ML' : '',
    fileSize: total,
    bytesDownloaded: entry.bytesDownloaded,
    progress: total > 0 ? entry.bytesDownloaded / total : 0,
    status: entry.status,
    reason: entry.reason,
    reasonCode: entry.reasonCode as DownloadItem['reasonCode'],
  };
}

/** Map the text + image model stores into completed Download Manager items. */
export function modelStoreCompletedItems(
  downloadedModels: DownloadedModel[],
  downloadedImageModels: ONNXImageModel[],
): DownloadItem[] {
  return [
    ...downloadedModels.map((model): DownloadItem => {
      const totalSize = hardwareService.getModelTotalSize(model);
      return {
        type: 'completed',
        modelType: 'text',
        modelId: model.id,
        fileName: model.fileName,
        author: model.author,
        quantization: model.quantization,
        fileSize: totalSize,
        bytesDownloaded: totalSize,
        progress: 1,
        status: 'completed',
        downloadedAt: model.downloadedAt,
        filePath: model.filePath,
        isVisionModel:
          model.engine === 'llama' ? model.isVisionModel : undefined,
        mmProjPath: model.engine === 'llama' ? model.mmProjPath : undefined,
        mmProjFileName:
          model.engine === 'llama' ? model.mmProjFileName : undefined,
        name: model.name,
      };
    }),
    ...downloadedImageModels.map(
      (model): DownloadItem => ({
        type: 'completed',
        modelType: 'image',
        modelId: model.id,
        fileName: model.name,
        author: 'Image Generation',
        quantization: '',
        fileSize: model.size,
        bytesDownloaded: model.size,
        progress: 1,
        status: 'completed',
        filePath: model.modelPath,
      }),
    ),
  ];
}
