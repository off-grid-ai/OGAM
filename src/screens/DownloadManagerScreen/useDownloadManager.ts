import { videoModelDisplayName } from '../../utils/modelHelpers';
import { useState } from 'react';
import {
  AlertState,
  showAlert,
  hideAlert,
  initialAlertState,
} from '../../components/CustomAlert';
import { useAppStore } from '../../stores';
import { useDownloadStore } from '../../stores/downloadStore';
import {
  modelManager,
  hardwareService,
  backgroundDownloadService,
} from '../../services';
import { visionRepairMessage } from '../../services/modelManager/visionRepairMessage';
import { useVoiceDownloadItems } from './useVoiceDownloadItems';
import { DownloadedModel, ONNXImageModel } from '../../types';
import { DownloadItem, formatBytes } from './items';
import {
  entryToActiveItem,
  modelStoreCompletedItems,
  queuedToActiveItem,
} from './downloadItemMapping';
import logger from '../../utils/logger';
import { cancelSyntheticImageDownload } from '../../services/imageDownloadActions';
import { retryImageDownload } from './retryHandlers';
import { modelDownloadService } from '../../services/modelDownloadService';
import { uniformDownloadId } from '../../services/modelDownloadService/uniformId';
import { setImageDownloadOps } from '../../services/modelDownloadService/providers/imageProvider';
import { useEffect } from 'react';

export interface UseDownloadManagerResult {
  activeItems: DownloadItem[];
  completedItems: DownloadItem[];
  alertState: AlertState;
  setAlertState: (state: AlertState) => void;
  handleRemoveDownload: (item: DownloadItem) => void;
  handleRetryDownload: (item: DownloadItem) => void;
  handlePauseDownload: (item: DownloadItem) => void;
  handleResumeDownload: (item: DownloadItem) => void;
  handleDeleteItem: (item: DownloadItem) => void;
  handleRepairVision: (item: DownloadItem) => void;
  isRepairingVision: (modelId: string) => boolean;
  totalStorageUsed: number;
}

export function useDownloadManager(): UseDownloadManagerResult {
  const [alertState, setAlertState] = useState<AlertState>(initialAlertState);
  const repairingVisionIds = useDownloadStore(s => s.repairingVisionIds);
  const setRepairingVision = useDownloadStore(s => s.setRepairingVision);
  const {
    downloadedModels,
    setDownloadedModels,
    downloadedImageModels,
    downloadedVideoModels,
  } = useAppStore();

  const downloads = useDownloadStore(state => state.downloads);
  const removeDownloadEntry = useDownloadStore(state => state.remove);

  // Downloads waiting for a concurrency slot live only in the service's queue (no
  // store row yet), so read them from their owner and show them as "Queued". Refresh
  // on store changes (a completing download drains the queue) and on a light poll.
  const [queuedItems, setQueuedItems] = useState<DownloadItem[]>([]);
  useEffect(() => {
    const refresh = () =>
      setQueuedItems(
        backgroundDownloadService.getQueuedItems().map(queuedToActiveItem),
      );
    // On the light poll, also reconcile the concurrency accounting against the native
    // truth so a leaked slot (e.g. a folded mmproj sidecar) is reclaimed and a stuck
    // Queued download starts — without waiting for a new start to trigger it.
    const reconcileAndRefresh = () => {
      backgroundDownloadService.reconcileActiveIds().catch(() => {});
      refresh();
    };
    refresh();
    // The service owns the queue and notifies on every control op (incl. cancelling a
    // queued start), so a cancel drops the "Queued" row immediately, not on the poll.
    const unsubscribe = modelDownloadService.subscribe(refresh);
    const t = setInterval(reconcileAndRefresh, 1000);
    return () => {
      unsubscribe();
      clearInterval(t);
    };
    // Mount once: the subscription already fires on every store change (that's what
    // drains the queue) and the interval covers the rest. Depending on `downloads` here
    // tore down + rebuilt the subscription and interval on EVERY progress tick — pure
    // churn while a download runs — and refresh reads from the service, not `downloads`.
  }, []);

  // Voice (TTS) + transcription (STT) downloaded models, loaded from disk.
  const { voiceItems, buildDeleteAlert: buildVoiceDeleteAlert } =
    useVoiceDownloadItems(() => setAlertState(hideAlert()));

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
          const rows = await backgroundDownloadService
            .getActiveDownloads()
            .catch(() => [] as any[]);
          await Promise.all(
            rows
              .filter(r => r.modelId === `image:${modelId}`)
              .map(r =>
                backgroundDownloadService
                  .cancelDownload(r.downloadId)
                  .catch(() => {}),
              ),
          );
        } else {
          await backgroundDownloadService
            .cancelDownload(entry.downloadId)
            .catch(() => {});
        }
      },
      retry: async (_modelId, entry) => {
        await retryImageDownload(
          entryToActiveItem(entry),
          entry,
          setAlertState,
        );
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
  const idOf = (item: DownloadItem): string =>
    uniformDownloadId(item.modelType, item.modelId);

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
    ...downloadedVideoModels.map(model => ({
      type: 'completed' as const,
      modelType: 'video' as const,
      modelId: model.id,
      fileName: videoModelDisplayName(model.id, model.name),
      name: videoModelDisplayName(model.id, model.name),
      author: model.org ?? '',
      quantization: model.quant ?? '',
      fileSize: model.files.reduce(
        (sum, file) => sum + (file.sizeBytes ?? 0),
        0,
      ),
      bytesDownloaded: 0,
      progress: 1,
      status: 'completed',
      downloadedAt: model.downloadedAt,
    })),
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
  const voiceActiveDeduped = voiceActive.filter(
    item => !completedIds.has(idOf(item)),
  );
  const activeItems: DownloadItem[] = [
    ...startedItems,
    ...queuedActive,
    ...voiceActiveDeduped,
  ];

  const totalStorageUsed = completedItems.reduce(
    (sum, item) => sum + item.fileSize,
    0,
  );

  const executeRemoveDownload = async (item: DownloadItem) => {
    setAlertState(hideAlert());
    try {
      // Older model-package transfers persisted their individual files as native
      // "artifact" rows. Hydration can display them, but no model provider owns
      // that type, so service.cancel() refuses the id and leaves the card in place.
      if (item.modelKey?.startsWith('model-download:') && item.downloadId) {
        await backgroundDownloadService.cancelDownload(item.downloadId);
        const stillNative = (await backgroundDownloadService.getActiveDownloads())
          .some(row => row.downloadId === item.downloadId);
        if (stillNative) throw new Error('The native download could not be removed');
        removeDownloadEntry(item.modelKey);
        return;
      }
      // Single owner: the service cancels the in-flight download (routing to the
      // owning provider — image uses the injected ops above) and logs [DL-SM].
      await modelDownloadService.cancel(idOf(item));
      // A projector repair remains a pending promise until its native cancellation
      // callback settles. Its transient download row is already gone, so stop showing
      // the completed model as busy now.
      if (repairingVisionIds[item.modelId]) setRepairingVision(item.modelId, false);
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
      const errorMessage =
        error?.message || 'Retry failed. Please remove and re-download.';
      if (item.downloadId)
        useDownloadStore.getState().setStatus(item.downloadId, 'failed', {
          message: errorMessage,
        });
    }
  };

  const handlePauseDownload = async (item: DownloadItem) => {
    try {
      await modelDownloadService.pause(idOf(item));
    } catch (error) {
      logger.error('[DownloadManager] Failed to pause download:', error);
      setAlertState(showAlert('Pause failed', 'This download could not pause. Try again.'));
    }
  };

  const handleResumeDownload = async (item: DownloadItem) => {
    try {
      await modelDownloadService.resume(idOf(item));
    } catch (error) {
      logger.error('[DownloadManager] Failed to resume download:', error);
      setAlertState(showAlert('Resume failed', error instanceof Error ? error.message : 'Try again.'));
    }
  };

  const handleRemoveDownload = (item: DownloadItem) => {
    setAlertState(
      showAlert(
        'Remove Download',
        'Are you sure you want to remove this download?',
        [
          { text: 'No', style: 'cancel' },
          {
            text: 'Yes',
            style: 'destructive',
            onPress: () => {
              executeRemoveDownload(item);
            },
          },
        ],
      ),
    );
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
    if (item.modelType === 'video') {
      setAlertState(
        showAlert(
          'Delete Video Model',
          `Delete "${item.fileName}" and free ${formatBytes(item.fileSize)}?`,
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Delete',
              style: 'destructive',
              onPress: () => {
                void modelDownloadService
                  .remove(idOf(item))
                  .catch(error =>
                    setAlertState(
                      showAlert(
                        'Could not delete model',
                        String(error.message),
                      ),
                    ),
                  );
              },
            },
          ],
        ),
      );
      return;
    }
    if (item.modelType === 'tts' || item.modelType === 'stt') {
      setAlertState(buildVoiceDeleteAlert(item));
      return;
    }
    if (item.modelType === 'image') {
      const model = downloadedImageModels.find(m => m.id === item.modelId);
      if (!model) return;
      setAlertState(
        showAlert(
          'Delete Image Model',
          `Are you sure you want to delete "${
            model.name
          }"? This will free up ${formatBytes(model.size)}.`,
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Delete',
              style: 'destructive',
              onPress: () => {
                executeDeleteImageModel(model);
              },
            },
          ],
        ),
      );
    } else {
      const model = downloadedModels.find(m => m.id === item.modelId);
      if (!model) return;
      const totalSize = hardwareService.getModelTotalSize(model);
      setAlertState(
        showAlert(
          'Delete Model',
          `Are you sure you want to delete "${
            model.fileName
          }"? This will free up ${formatBytes(totalSize)}.`,
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Delete',
              style: 'destructive',
              onPress: () => {
                executeDeleteModel(model);
              },
            },
          ],
        ),
      );
    }
  };

  /**
   * Repair a vision model's missing projector.
   *
   * This used to rebuild a Hugging Face repo id by splitting the LOCAL display id at its last
   * slash, which only works for a model whose id happens to be a repo path. A model that arrived
   * by device transfer, or was imported from storage, produced a repo id Hugging Face has never
   * seen - and HF answers an unknown repo with 401, so the user was shown a raw auth error for a
   * file that never had an upstream at all.
   *
   * The service decides where the projector can come from now (recorded provenance, then a
   * projector already on disk, then a size-verified HF match) and reports which, so every outcome
   * here says something true rather than leaking a status code.
   */
  const handleRepairVision = (item: DownloadItem): void => {
    const model = downloadedModels.find(m => m.id === item.modelId);
    if (!model) return;
    setRepairingVision(item.modelId, true);
    logger.log('[DownloadDebug] Repair vision requested', {
      modelId: item.modelId,
      currentMmProjPath: item.mmProjPath,
      currentMmProjFileName: item.mmProjFileName,
    });
    modelManager
      .repairVision(model)
      .then(async outcome => {
        setDownloadedModels(await modelManager.getDownloadedModels());
        logger.log('[DownloadDebug] Repair vision outcome', {
          modelId: item.modelId,
          outcome: outcome.kind,
        });
        const [title, body] = visionRepairMessage(outcome, item.fileName);
        setAlertState(showAlert(title, body));
      })
      .catch((e: Error) => {
        if (e.message === 'Download cancelled' || !useDownloadStore.getState().repairingVisionIds[item.modelId]) return;
        logger.error('[DownloadDebug] Repair vision failed', {
          modelId: item.modelId,
          error: e.message,
        });
        setAlertState(showAlert('Repair Failed', e.message));
      })
      .finally(() => {
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
    handlePauseDownload,
    handleResumeDownload,
    handleDeleteItem,
    handleRepairVision,
    isRepairingVision,
    totalStorageUsed,
  };
}
