import { useState } from 'react';
import { Platform } from 'react-native';
import { AlertState, showAlert, hideAlert, initialAlertState } from '../../components/CustomAlert';
import { useAppStore } from '../../stores';
import { useDownloadStore, DownloadEntry } from '../../stores/downloadStore';
import {
  modelManager,
  activeModelService,
  hardwareService,
  huggingFaceService,
  backgroundDownloadService,
} from '../../services';
import { useVoiceDownloadItems } from './useVoiceDownloadItems';
import { DownloadedModel, ONNXImageModel } from '../../types';
import { DownloadItem, formatBytes } from './items';
import logger from '../../utils/logger';
import { cancelSyntheticImageDownload, proceedWithDownload } from '../ModelsScreen/imageDownloadActions';
import { resumeImageDownload } from '../ModelsScreen/imageDownloadResume';

export interface UseDownloadManagerResult {
  activeItems: DownloadItem[];
  completedItems: DownloadItem[];
  alertState: AlertState;
  setAlertState: (state: AlertState) => void;
  handleRemoveDownload: (item: DownloadItem) => void;
  handleRetryDownload: (item: DownloadItem) => void;
  handleDeleteItem: (item: DownloadItem) => void;
  handleRepairVision: (item: DownloadItem) => void;
  isRepairingVision: (modelId: string) => boolean;
  totalStorageUsed: number;
}

async function resumeImageFinalization(
  entry: DownloadEntry,
  setAlertState: (state: AlertState) => void,
): Promise<void> {
  const appState = useAppStore.getState();
  await resumeImageDownload(entry, {
    addDownloadedImageModel: appState.addDownloadedImageModel,
    activeImageModelId: appState.activeImageModelId,
    setActiveImageModelId: appState.setActiveImageModelId,
    setAlertState,
    triedImageGen: appState.onboardingChecklist.triedImageGen,
  });
}

function parseEntryMetadata(entry: DownloadEntry): Record<string, any> | null {
  if (!entry.metadataJson) return null;
  try {
    return JSON.parse(entry.metadataJson);
  } catch {
    return null;
  }
}

function getActiveItemModelId(entry: DownloadEntry, isImage: boolean): string {
  if (isImage && entry.modelId.startsWith('image:')) {
    return entry.modelId.replace('image:', '');
  }
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
  if (backend === 'coreml') return 'Core ML';
  if (backend === 'qnn') return 'NPU';
  if (backend === 'mnn') return 'GPU';
  return 'Image Generation';
}

function getActiveItemAuthor(
  entry: DownloadEntry,
  isImage: boolean,
  metadata: Record<string, any> | null,
): string {
  if (isImage) return getImageAuthor(metadata?.imageModelBackend);
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

function entryToActiveItem(entry: DownloadEntry): DownloadItem {
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
    bytesDownloaded: entry.bytesDownloaded + (entry.mmProjBytesDownloaded ?? 0),
    progress: entry.progress,
    status: entry.status,
    reason: entry.errorMessage,
    reasonCode: entry.errorCode as import('../../types').BackgroundDownloadReasonCode | undefined,
  };
}

async function reattachRetriedTextDownload(
  item: DownloadItem,
  setDownloadedModels: (models: DownloadedModel[]) => void,
): Promise<void> {
  logger.log('[DownloadDebug] Reattaching text download finalizer after retry', {
    modelId: item.modelId,
    fileName: item.fileName,
    downloadId: item.downloadId,
  });
  modelManager.watchDownload(
    item.downloadId!,
    async () => {
      logger.log('[DownloadDebug] Retried text download finalized', {
        modelId: item.modelId,
        fileName: item.fileName,
        downloadId: item.downloadId,
      });
      const models = await modelManager.getDownloadedModels();
      setDownloadedModels(models);
      const modelKey = useDownloadStore.getState().downloadIdIndex[item.downloadId!] ?? '';
      if (modelKey) {
        useDownloadStore.getState().remove(modelKey);
      }
    },
    (error: Error) => {
      logger.error('[DownloadManager] Retried text download failed:', error);
      useDownloadStore.getState().setStatus(item.downloadId!, 'failed', {
        message: error.message,
      });
    },
  );
}

async function retryFailedMmProj(entry: DownloadEntry | undefined): Promise<boolean> {
  if (!entry?.mmProjDownloadId || entry.mmProjStatus !== 'failed') return false;
  useDownloadStore.getState().setStatus(entry.mmProjDownloadId, 'pending');
  try {
    logger.log('[DownloadDebug] Retrying failed mmproj sidecar', {
      modelKey: entry.modelKey,
      modelId: entry.modelId,
      mainDownloadId: entry.downloadId,
      mmProjDownloadId: entry.mmProjDownloadId,
    });
    await backgroundDownloadService.retryDownload(entry.mmProjDownloadId);
    return true;
  } catch (error) {
    logger.warn('[DownloadManager] Failed to retry mmproj sidecar:', error);
    useDownloadStore.getState().setStatus(entry.mmProjDownloadId, 'failed', {
      message: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

async function retryAndroidDownload(item: DownloadItem, entry: DownloadEntry | undefined, setDownloadedModels: (models: DownloadedModel[]) => void): Promise<void> {
  const downloadId = item.downloadId as string;
  useDownloadStore.getState().setStatus(downloadId, 'pending');
  await backgroundDownloadService.retryDownload(downloadId);
  if (item.modelType === 'text') {
    const mmProjRetried = await retryFailedMmProj(entry);
    if (mmProjRetried) {
      modelManager.resetMmProjForRetry(downloadId);
    }
    await reattachRetriedTextDownload(item, setDownloadedModels);
  }
}

async function retryIosImageDownload(entry: DownloadEntry, setAlertState: (s: AlertState) => void): Promise<void> {
  const meta = parseEntryMetadata(entry);
  if (!meta) return;
  const isZip = meta.imageDownloadType === 'zip';
  if (isZip && !meta.imageModelDownloadUrl) {
    logger.error('[DownloadManager] retryIosImageDownload: missing imageModelDownloadUrl for zip download', { modelId: entry.modelId });
    return;
  }
  // Cancel the stale native row so it doesn't accumulate in the native DB across
  // retries. proceedWithDownload starts a fresh row — without this the old failed
  // row stays persisted and re-hydrates after the next app kill.
  await backgroundDownloadService.cancelDownload(entry.downloadId).catch(() => {});
  const modelId = entry.modelId.replace('image:', '');
  const appState = useAppStore.getState();
  const deps = {
    addDownloadedImageModel: appState.addDownloadedImageModel,
    activeImageModelId: appState.activeImageModelId,
    setActiveImageModelId: appState.setActiveImageModelId,
    setAlertState,
    triedImageGen: appState.onboardingChecklist.triedImageGen,
  };
  await proceedWithDownload({
    id: modelId,
    name: meta.imageModelName,
    description: meta.imageModelDescription,
    downloadUrl: meta.imageModelDownloadUrl ?? '',
    size: meta.imageModelSize,
    style: meta.imageModelStyle,
    backend: meta.imageModelBackend,
    attentionVariant: meta.imageModelAttentionVariant,
    huggingFaceRepo: meta.imageModelRepo,
    huggingFaceFiles: meta.imageModelHuggingFaceFiles,
    coremlFiles: meta.imageModelCoremlFiles,
    repo: meta.imageModelRepo,
  }, deps);
}

async function retryIosTextDownload(
  item: DownloadItem,
  entry: DownloadEntry,
  setDownloadedModels: (models: DownloadedModel[]) => void,
): Promise<void> {
  const meta = parseEntryMetadata(entry);
  const mmProjFile = entry.mmProjFileName && entry.mmProjFileSize && meta?.mmProjDownloadUrl
    ? { name: entry.mmProjFileName, size: entry.mmProjFileSize, downloadUrl: meta.mmProjDownloadUrl }
    : undefined;
  const file = {
    name: entry.fileName,
    size: entry.totalBytes,
    quantization: entry.quantization,
    downloadUrl: huggingFaceService.getDownloadUrl(entry.modelId, entry.fileName),
    ...(mmProjFile ? { mmProjFile } : {}),
  };
  const info = await modelManager.downloadModelBackground(entry.modelId, file);
  await reattachRetriedTextDownload({ ...item, downloadId: info.downloadId }, setDownloadedModels);
}

/** Map the text + image model stores into completed Download Manager items. */
function modelStoreCompletedItems(
  downloadedModels: DownloadedModel[],
  downloadedImageModels: ONNXImageModel[],
): DownloadItem[] {
  return [
    ...downloadedModels.map((model): DownloadItem => {
      const totalSize = hardwareService.getModelTotalSize(model);
      return {
        type: 'completed', modelType: 'text', modelId: model.id, fileName: model.fileName,
        author: model.author, quantization: model.quantization, fileSize: totalSize,
        bytesDownloaded: totalSize, progress: 1, status: 'completed',
        downloadedAt: model.downloadedAt, filePath: model.filePath,
        isVisionModel: model.engine === 'llama' ? model.isVisionModel : undefined,
        mmProjPath: model.engine === 'llama' ? model.mmProjPath : undefined,
        mmProjFileName: model.engine === 'llama' ? model.mmProjFileName : undefined,
        name: model.name,
      };
    }),
    ...downloadedImageModels.map((model): DownloadItem => ({
      type: 'completed', modelType: 'image', modelId: model.id, fileName: model.name,
      author: 'Image Generation', quantization: '', fileSize: model.size,
      bytesDownloaded: model.size, progress: 1, status: 'completed', filePath: model.modelPath,
    })),
  ];
}

export function useDownloadManager(): UseDownloadManagerResult {
  const [alertState, setAlertState] = useState<AlertState>(initialAlertState);
  const repairingVisionIds = useDownloadStore(s => s.repairingVisionIds);
  const setRepairingVision = useDownloadStore(s => s.setRepairingVision);
  const {
    downloadedModels,
    setDownloadedModels,
    removeDownloadedModel,
    downloadedImageModels,
    removeDownloadedImageModel,
  } = useAppStore();

  const downloads = useDownloadStore(state => state.downloads);
  const removeDownloadEntry = useDownloadStore(state => state.remove);

  // Voice (TTS) + transcription (STT) downloaded models, loaded from disk.
  const { voiceItems, buildDeleteAlert: buildVoiceDeleteAlert } = useVoiceDownloadItems(() => setAlertState(hideAlert()));

  const activeItems: DownloadItem[] = Object.values(downloads)
    .filter(e => e.status !== 'completed' && e.status !== 'cancelled')
    .map(entryToActiveItem);

  const completedItems: DownloadItem[] = [
    ...modelStoreCompletedItems(downloadedModels, downloadedImageModels),
    ...voiceItems,
  ];

  const totalStorageUsed = completedItems.reduce((sum, item) => sum + item.fileSize, 0);

  const executeRemoveDownload = async (item: DownloadItem) => {
    setAlertState(hideAlert());
    try {
      const modelKey = item.modelKey ?? `${item.modelId}/${item.fileName}`;
      const entry = downloads[modelKey];
      logger.log('[DownloadDebug] Removing download entry', {
        modelKey,
        modelId: item.modelId,
        fileName: item.fileName,
        mainDownloadId: entry?.downloadId,
        mmProjDownloadId: entry?.mmProjDownloadId,
      });
      removeDownloadEntry(modelKey);
      if (entry) {
        if (entry.downloadId.startsWith('image-multi:')) {
          await cancelSyntheticImageDownload(item.modelId).catch(() => {});
          // After app kill the runtime is gone — cancel native rows so they aren't re-hydrated.
          try {
            const activeRows = await backgroundDownloadService.getActiveDownloads();
            const imageModelId = `image:${item.modelId}`;
            await Promise.all(
              activeRows
                .filter(r => r.modelId === imageModelId)
                .map(r => backgroundDownloadService.cancelDownload(r.downloadId).catch(() => {})),
            );
          } catch {
            // Best-effort — store entry already removed above.
          }
          return;
        }
        await modelManager.cancelBackgroundDownload(entry.downloadId).catch(() => {});
        if (entry.mmProjDownloadId) {
          await modelManager.cancelBackgroundDownload(entry.mmProjDownloadId).catch(() => {});
        }
      }
    } catch (error) {
      logger.error('[DownloadManager] Failed to remove download:', error);
      setAlertState(showAlert('Error', 'Failed to remove download'));
    }
  };

  const handleRetryDownload = async (item: DownloadItem) => {
    if (!item.downloadId) return;
    const modelKey = item.modelKey ?? `${item.modelId}/${item.fileName}`;
    const entry = downloads[modelKey];
    try {
      logger.log('[DownloadDebug] Manual retry requested', { modelKey, modelId: item.modelId, fileName: item.fileName, modelType: item.modelType, mainDownloadId: item.downloadId, mmProjDownloadId: entry?.mmProjDownloadId, status: item.status, mmProjStatus: entry?.mmProjStatus });

      const hasAllBytes = item.fileSize > 0 && item.bytesDownloaded >= item.fileSize;
      if (item.modelType === 'image' && entry) {
        let nativeMainStatus: string | undefined;
        try {
          const activeRows = await backgroundDownloadService.getActiveDownloads();
          nativeMainStatus = activeRows.find(row => row.downloadId === item.downloadId)?.status;
        } catch {
          // Best-effort native state check only.
        }
        if (item.status === 'processing' || hasAllBytes || nativeMainStatus === 'completed') {
          await resumeImageFinalization(entry, setAlertState);
          return;
        }
      }

      if (Platform.OS === 'android') {
        await retryAndroidDownload(item, entry, setDownloadedModels);
      } else if (Platform.OS === 'ios' && item.modelType === 'image' && entry) {
        await retryIosImageDownload(entry, setAlertState);
      } else if (Platform.OS === 'ios' && item.modelType === 'text' && entry) {
        await retryIosTextDownload(item, entry, setDownloadedModels);
      }
      backgroundDownloadService.startProgressPolling();
    } catch (error: any) {
      logger.error('[DownloadManager] Failed to retry download:', error);
      const errorMessage = error?.message || 'Retry failed. Please remove and re-download.';
      useDownloadStore.getState().setStatus(item.downloadId, 'failed', {
        message: errorMessage,
      });
    }
  };

  const handleRemoveDownload = (item: DownloadItem) => {
    setAlertState(showAlert(
      'Remove Download',
      'Are you sure you want to remove this download?',
      [
        { text: 'No', style: 'cancel' },
        { text: 'Yes', style: 'destructive', onPress: () => { executeRemoveDownload(item); } },
      ],
    ));
  };

  const executeDeleteModel = async (model: DownloadedModel) => {
    setAlertState(hideAlert());
    try {
      await modelManager.deleteModel(model.id);
      removeDownloadedModel(model.id);
    } catch (error) {
      logger.error('[DownloadManager] Failed to delete model:', error);
      setAlertState(showAlert('Error', 'Failed to delete model'));
    }
  };

  const executeDeleteImageModel = async (model: ONNXImageModel) => {
    setAlertState(hideAlert());
    try {
      await activeModelService.unloadImageModel();
      await modelManager.deleteImageModel(model.id);
      removeDownloadedImageModel(model.id);
    } catch (error) {
      logger.error('[DownloadManager] Failed to delete image model:', error);
      setAlertState(showAlert('Error', 'Failed to delete image model'));
    }
  };

  const handleDeleteItem = (item: DownloadItem) => {
    if (item.modelType === 'tts' || item.modelType === 'stt') {
      setAlertState(buildVoiceDeleteAlert(item));
      return;
    }
    if (item.modelType === 'image') {
      const model = downloadedImageModels.find(m => m.id === item.modelId);
      if (!model) return;
      setAlertState(showAlert(
        'Delete Image Model',
        `Are you sure you want to delete "${model.name}"? This will free up ${formatBytes(model.size)}.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Delete', style: 'destructive', onPress: () => { executeDeleteImageModel(model); } },
        ],
      ));
    } else {
      const model = downloadedModels.find(m => m.id === item.modelId);
      if (!model) return;
      const totalSize = hardwareService.getModelTotalSize(model);
      setAlertState(showAlert(
        'Delete Model',
        `Are you sure you want to delete "${model.fileName}"? This will free up ${formatBytes(totalSize)}.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Delete', style: 'destructive', onPress: () => { executeDeleteModel(model); } },
        ],
      ));
    }
  };

  const handleRepairVision = (item: DownloadItem): void => {
    const lastSlash = item.modelId.lastIndexOf('/');
    if (lastSlash < 0) return;
    const repoId = item.modelId.substring(0, lastSlash);
    const fileName = item.modelId.substring(lastSlash + 1);
    setRepairingVision(item.modelId, true);
    logger.log('[DownloadDebug] Repair vision requested', {
      modelId: item.modelId,
      fileName,
      currentMmProjPath: item.mmProjPath,
      currentMmProjFileName: item.mmProjFileName,
    });
    huggingFaceService.getModelFiles(repoId).then(async (files) => {
      const file = files.find(f => f.name === fileName);
      if (!file?.mmProjFile) {
        setAlertState(showAlert(
          'No Vision File Available',
          'This model does not publish a separate vision projection file. Re-download the original (non-i1) variant if vision support is required.',
        ));
        return;
      }
      await modelManager.repairMmProj(repoId, file, {});
      const models = await modelManager.getDownloadedModels();
      setDownloadedModels(models);
      logger.log('[DownloadDebug] Repair vision completed', {
        modelId: item.modelId,
        fileName,
      });
      setAlertState(showAlert('Vision Repaired', `Vision file restored for ${item.fileName}. Reload the model to enable vision.`));
    }).catch((e: Error) => {
      logger.error('[DownloadDebug] Repair vision failed', {
        modelId: item.modelId,
        fileName,
        error: e.message,
      });
      setAlertState(showAlert('Repair Failed', e.message));
    }).finally(() => {
      setRepairingVision(item.modelId, false);
    });
  };

  const isRepairingVision = (modelId: string) => !!repairingVisionIds[modelId];

  return {
    activeItems,
    completedItems,
    alertState,
    setAlertState,
    handleRemoveDownload,
    handleRetryDownload,
    handleDeleteItem,
    handleRepairVision,
    isRepairingVision,
    totalStorageUsed,
  };
}
