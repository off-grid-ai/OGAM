import { DownloadEntry } from '../../stores/downloadStore';
import { jobBytesDownloaded } from '../../utils/downloadStatus';
import { hardwareService } from '../../services';
import { DownloadedModel, ONNXImageModel } from '../../types';
import { DownloadItem } from './items';
import { parseEntryMetadata } from './retryHandlers';
import { imageBackendLabel } from '../../utils/imageBackend';

/**
 * How a download store row, a queued start, or a finished model becomes one Download Manager row.
 *
 * Pure projection: no hooks, no store reads, no IO. The screen decides WHEN to build a row; this
 * module decides WHAT the row says, so the naming, the id and the dedup key can be reasoned about
 * (and read back) without a rendered screen.
 */

function getActiveItemModelId(entry: DownloadEntry, isImage: boolean): string {
  if (isImage && entry.modelId.startsWith('image:')) {
    return entry.modelId.replace('image:', '');
  }
  // Text canonical id = the modelKey (repo/file), which is exactly what the finished
  // model's id is (buildDownloadedModel: `${modelId}/${fileName}`). Keying the in-flight
  // row by the bare repo produced a DIFFERENT uniform id than the completed model, so the
  // dedup + reconcile never collapsed them → phantom "100%" rows and Active+Downloaded
  // duplicates for one model. Image/STT already normalize to one id per model.
  if (entry.modelType === 'text') return entry.modelKey;
  return entry.modelId;
}

function getActiveItemFileName(
  entry: DownloadEntry,
  isImage: boolean,
  metadata: Record<string, any> | null,
): string {
  return isImage && metadata?.imageModelName
    ? metadata.imageModelName
    : entry.fileName;
}

function getImageAuthor(backend?: string): string {
  return imageBackendLabel(backend, 'Image Generation');
}

function getActiveItemAuthor(
  entry: DownloadEntry,
  isImage: boolean,
  metadata: Record<string, any> | null,
): string {
  if (isImage) return getImageAuthor(metadata?.imageModelBackend);
  // Synced model downloads use an encoded transfer identity as modelId. It is
  // needed for routing, but it is not a publisher name for the visible card.
  if (entry.modelId.startsWith('model-download:')) return 'Unknown';
  return entry.modelId.split('/')[0] ?? 'Unknown';
}

function getActiveItemQuantization(
  entry: DownloadEntry,
  isImage: boolean,
  metadata: Record<string, any> | null,
): string {
  if (!isImage) return entry.quantization;
  return metadata?.imageModelBackend === 'coreml' ? 'Core ML' : '';
}

/** A start waiting for a concurrency slot (no native downloadId yet) → a "Queued"
 *  active item. status 'pending' renders as "Queued" in the item row. */
export function queuedToActiveItem(q: {
  modelKey: string;
  modelId: string;
  fileName: string;
  modelType: string;
  totalBytes: number;
}): DownloadItem {
  return {
    type: 'active',
    modelType: q.modelType as DownloadItem['modelType'],
    modelKey: q.modelKey,
    // Match getActiveItemModelId: text routes/dedups on the modelKey (repo/file), the
    // same id the finished model carries; other types pass the modelId through.
    modelId: q.modelType === 'text' ? q.modelKey : q.modelId,
    fileName: q.fileName,
    author: '',
    quantization: '',
    fileSize: q.totalBytes,
    bytesDownloaded: 0,
    progress: 0,
    status: 'pending',
  };
}

export function entryToActiveItem(entry: DownloadEntry): DownloadItem {
  const metadata = parseEntryMetadata(entry);
  const isImage = entry.modelType === 'image';

  return {
    type: 'active',
    modelType: entry.modelType,
    downloadId: entry.downloadId,
    modelKey: entry.modelKey,
    modelId: getActiveItemModelId(entry, isImage),
    fileName: getActiveItemFileName(entry, isImage, metadata),
    author: getActiveItemAuthor(entry, isImage, metadata),
    quantization: getActiveItemQuantization(entry, isImage, metadata),
    fileSize: entry.combinedTotalBytes || entry.totalBytes,
    bytesDownloaded: jobBytesDownloaded(entry),
    progress: entry.progress,
    bytesPerSecond: entry.bytesPerSecond,
    status: entry.status,
    canPause: !!entry.downloadId && (entry.status === 'running' || entry.status === 'pending' || entry.status === 'waiting_for_network'),
    canResume: !!entry.downloadId && entry.status === 'paused',
    reason: entry.errorMessage,
    reasonCode: entry.errorCode as
      | import('../../types').BackgroundDownloadReasonCode
      | undefined,
    isVisionModel: isImage ? undefined : !!metadata?.mmProjFileName || !!entry.mmProjDownloadId,
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
          model.engine === 'llama' ? model.isVisionModel : model.liteRTVision,
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
