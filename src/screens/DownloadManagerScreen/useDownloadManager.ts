import { useState } from 'react';
import { AlertState, showAlert, hideAlert, initialAlertState } from '../../components/CustomAlert';
import { useAppStore } from '../../stores';
import { useDownloadStore, DownloadEntry } from '../../stores/downloadStore';
import {
  modelManager,
  hardwareService,
  huggingFaceService,
  backgroundDownloadService,
} from '../../services';
import { useVoiceDownloadItems } from './useVoiceDownloadItems';
import { DownloadedModel, ONNXImageModel } from '../../types';
import { DownloadItem, formatBytes } from './items';
import logger from '../../utils/logger';
import { cancelSyntheticImageDownload } from '../ModelsScreen/imageDownloadActions';
import { parseEntryMetadata, retryImageDownload } from './retryHandlers';
import { modelDownloadService } from '../../services/modelDownloadService';
import { uniformDownloadId } from '../../services/modelDownloadService/uniformId';
import { imageBackendLabel } from '../../utils/imageBackend';
import { setImageDownloadOps } from '../../services/modelDownloadService/providers/imageProvider';
import { useEffect } from 'react';

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
function queuedToActiveItem(q: { modelKey: string; modelId: string; fileName: string; modelType: string; totalBytes: number }): DownloadItem {
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
    downloadedImageModels,
  } = useAppStore();

  const downloads = useDownloadStore(state => state.downloads);
  const removeDownloadEntry = useDownloadStore(state => state.remove);

  // Downloads waiting for a concurrency slot live only in the service's queue (no
  // store row yet), so read them from their owner and show them as "Queued". Refresh
  // on store changes (a completing download drains the queue) and on a light poll.
  const [queuedItems, setQueuedItems] = useState<DownloadItem[]>([]);
  useEffect(() => {
    const refresh = () => setQueuedItems(backgroundDownloadService.getQueuedItems().map(queuedToActiveItem));
    // On the light poll, also reconcile the concurrency accounting against the native
    // truth so a leaked slot (e.g. a folded mmproj sidecar) is reclaimed and a stuck
    // Queued download starts — without waiting for a new start to trigger it.
    const reconcileAndRefresh = () => { backgroundDownloadService.reconcileActiveIds().catch(() => {}); refresh(); };
    refresh();
    // The service owns the queue and notifies on every control op (incl. cancelling a
    // queued start), so a cancel drops the "Queued" row immediately, not on the poll.
    const unsubscribe = modelDownloadService.subscribe(refresh);
    const t = setInterval(reconcileAndRefresh, 1000);
    return () => { unsubscribe(); clearInterval(t); };
    // Mount once: the subscription already fires on every store change (that's what
    // drains the queue) and the interval covers the rest. Depending on `downloads` here
    // tore down + rebuilt the subscription and interval on EVERY progress tick — pure
    // churn while a download runs — and refresh reads from the service, not `downloads`.
  }, []);

  // Voice (TTS) + transcription (STT) downloaded models, loaded from disk.
  const { voiceItems, buildDeleteAlert: buildVoiceDeleteAlert } = useVoiceDownloadItems(() => setAlertState(hideAlert()));

  // Inject the UI-coupled image cancel/retry into the image provider so control ops
  // route through the single download service (which logs every [DL-SM] action).
  // These are the exact paths the manager used inline; they need alerts/resume, so
  // they can't live in the (UI-free) provider — they're injected here.
  useEffect(() => {
    setImageDownloadOps({
      cancel: async (modelId, entry) => {
        removeDownloadEntry(entry.modelKey);
        if (entry.downloadId.startsWith('image-multi:')) {
          await cancelSyntheticImageDownload(modelId).catch(() => {});
          const rows = await backgroundDownloadService.getActiveDownloads().catch(() => [] as any[]);
          await Promise.all(rows.filter(r => r.modelId === `image:${modelId}`)
            .map(r => backgroundDownloadService.cancelDownload(r.downloadId).catch(() => {})));
        } else {
          await backgroundDownloadService.cancelDownload(entry.downloadId).catch(() => {});
        }
      },
      retry: async (_modelId, entry) => {
        await retryImageDownload(entryToActiveItem(entry), entry, setAlertState);
      },
    });
  }, [removeDownloadEntry]);

  /**
   * Uniform download id the service routes on. MUST go through uniformDownloadId so
   * it matches the id the owning provider assigned in list() — re-deriving it inline
   * (`${type}:${modelId}`) leaked the per-type id scheme and broke STT remove/cancel:
   * the store keys whisper rows `whisper-<id>` but the provider lists them as the bare
   * `stt:<id>`, so the raw id missed and the service REFUSED it as not-found.
   */
  const idOf = (item: DownloadItem): string => uniformDownloadId(item.modelType, item.modelId);

  // voiceItems (TTS/STT) carries BOTH finished and in-flight rows: a completed model
  // is type:'completed', while a downloading or failed one is type:'active'. Route by
  // that type — a downloading Kokoro must land in Active Downloads, NOT Downloaded
  // Models. (Dumping all of voiceItems into completedItems made an in-progress voice
  // download render as a finished 82MB model via CompletedDownloadCard, regardless of
  // its real progress — the "shows downloaded while downloading/queued" bug.)
  const voiceCompleted = voiceItems.filter(i => i.type === 'completed');
  const voiceActive = voiceItems.filter(i => i.type === 'active');

  const completedItems: DownloadItem[] = [
    ...modelStoreCompletedItems(downloadedModels, downloadedImageModels),
    ...voiceCompleted,
  ];

  // One entry per model. A downloaded (registered, on-disk) model is authoritative, so
  // a leftover in-flight/failed row for the SAME model is stale — drop it. Otherwise a
  // model that completed and was then re-started (a stale restore, a re-download)
  // shows as both a failed "Active" download and a "Downloaded" model — two guys doing
  // the same thing (e.g. SDXL Core ML appearing in both sections). Keyed by the shared
  // uniformDownloadId so text/image/stt all dedup the same way.
  const completedIds = new Set(completedItems.map(idOf));
  const startedItems = Object.values(downloads)
    .filter(e => e.status !== 'completed' && e.status !== 'cancelled')
    .map(entryToActiveItem)
    .filter(item => !completedIds.has(idOf(item)));
  // Append queued (not-yet-started) downloads, skipping any already started or already
  // downloaded — one entry per model, no duplicates across started/queued/completed.
  const startedKeys = new Set(startedItems.map(i => i.modelKey));
  const queuedActive = queuedItems.filter(
    q => !startedKeys.has(q.modelKey) && !completedIds.has(idOf(q)),
  );
  // Include the in-flight/failed voice rows here so they render in Active Downloads
  // (ActiveDownloadCard shows their live progress bar / Retry). Dedup against
  // completedIds so a voice model that also has a completed row can't double-list.
  const voiceActiveDeduped = voiceActive.filter(item => !completedIds.has(idOf(item)));
  const activeItems: DownloadItem[] = [...startedItems, ...queuedActive, ...voiceActiveDeduped];

  const totalStorageUsed = completedItems.reduce((sum, item) => sum + item.fileSize, 0);

  const executeRemoveDownload = async (item: DownloadItem) => {
    setAlertState(hideAlert());
    try {
      // Single owner: the service cancels the in-flight download (routing to the
      // owning provider — image uses the injected ops above) and logs [DL-SM].
      await modelDownloadService.cancel(idOf(item));
    } catch (error) {
      logger.error('[DownloadManager] Failed to remove download:', error);
      setAlertState(showAlert('Error', 'Failed to remove download'));
    }
  };

  const handleRetryDownload = async (item: DownloadItem) => {
    // Route purely by id — the service looks up the download and refuses a not-found
    // id uniformly, so the UI does not gate on downloadId (which leaked the per-type
    // id scheme: stt re-downloads via whisperService and never has a downloadId).
    try {
      // Single owner: the service routes retry to the owning provider (image uses
      // the injected retry above; text/stt are service-level) and logs [DL-SM].
      await modelDownloadService.retry(idOf(item));
    } catch (error: any) {
      logger.error('[DownloadManager] Failed to retry download:', error);
      const errorMessage = error?.message || 'Retry failed. Please remove and re-download.';
      if (item.downloadId) useDownloadStore.getState().setStatus(item.downloadId, 'failed', {
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
      // Single owner: provider.remove unloads (n/a for text) + deletes + drops it
      // from the store, and logs [DL-SM].
      await modelDownloadService.remove(uniformDownloadId('text', model.id));
    } catch (error) {
      logger.error('[DownloadManager] Failed to delete model:', error);
      setAlertState(showAlert('Error', 'Failed to delete model'));
    }
  };

  const executeDeleteImageModel = async (model: ONNXImageModel) => {
    setAlertState(hideAlert());
    try {
      // Single owner: provider.remove unloads the image model + deletes + drops it
      // from the store, and logs [DL-SM].
      await modelDownloadService.remove(uniformDownloadId('image', model.id));
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
