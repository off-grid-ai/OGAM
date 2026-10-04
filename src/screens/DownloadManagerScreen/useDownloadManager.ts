import { useCallback, useState } from 'react';
import {
  AlertState,
  showAlert,
  hideAlert,
  initialAlertState,
} from '../../components/CustomAlert';
import { useAppStore } from '../../stores';
import {
  modelLibrary,
  hardwareService,
} from '../../services';
import {
  modelsFailureMessage,
  visionRepairMessage,
} from '@offgrid/application';
import { useVoiceDownloadItems } from './useVoiceDownloadItems';
import { DownloadedModel, ONNXImageModel } from '../../types';
import { DownloadItem, formatBytes } from './items';
import {
  facadeDownloadToActiveItem,
  modelStoreCompletedItems,
} from './downloadItemMapping';
import logger from '../../utils/logger';
import { useModelDownloadsProjection } from '../../hooks/useModelDownloadsProjection';
import { applicationFacade } from '../../services/applicationFacade';

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
  repairDownloadFor: (modelId: string) => DownloadItem | undefined;
  totalStorageUsed: number;
}

export function useDownloadManager(): UseDownloadManagerResult {
  const [alertState, setAlertState] = useState<AlertState>(initialAlertState);
  const [repairingVisionIds, setRepairingVisionIds] = useState<Record<string, boolean>>({});
  const setRepairingVision = useCallback((id: string, repairing: boolean) => {
    setRepairingVisionIds(current => {
      if (repairing) return { ...current, [id]: true };
      const next = { ...current };
      delete next[id];
      return next;
    });
  }, []);
  // Narrow selectors. A zero-argument `useAppStore()` re-rendered this whole screen for every
  // unrelated store write - image-generation progress, chat state, a settings change - while a
  // download was already re-rendering it on its own progress.
  const downloadedModels = useAppStore(state => state.downloadedModels);
  const downloadedImageModels = useAppStore(state => state.downloadedImageModels);

  const downloads = useModelDownloadsProjection();

  // Voice (TTS) + transcription (STT) downloaded models, loaded from disk.
  const { voiceItems, buildDeleteAlert: buildVoiceDeleteAlert } =
    useVoiceDownloadItems(() => setAlertState(hideAlert()));

  const idOf = (item: DownloadItem): string => `${item.modelType}:${item.modelId}`;

  const completedItems: DownloadItem[] = [
    ...modelStoreCompletedItems(downloadedModels, downloadedImageModels),
    ...voiceItems,
  ];

  // One entry per model. A downloaded (registered, on-disk) model is authoritative, so
  // a leftover in-flight/failed row for the SAME model is stale — drop it. Otherwise a
  // model that completed and was then re-started (a stale restore, a re-download)
  // shows as both a failed "Active" download and a "Downloaded" model — two guys doing
  // the same thing (e.g. SDXL Core ML appearing in both sections). Keyed by the shared
  // uniformDownloadId so text/image/stt all dedup the same way.
  const completedIds = new Set(completedItems.map(idOf));
  const startedItems = downloads
    .filter(e => e.status !== 'completed' && e.status !== 'cancelled')
    .map(facadeDownloadToActiveItem)
    .filter(item => !completedIds.has(idOf(item)));
  const activeItems: DownloadItem[] = startedItems;
  const repairDownloadFor = (modelId: string): DownloadItem | undefined => {
    const row = downloads.find(
      download => download.modelKey === modelId || download.modelId === modelId,
    );
    return row ? facadeDownloadToActiveItem(row) : undefined;
  };

  const totalStorageUsed = completedItems.reduce(
    (sum, item) => sum + item.fileSize,
    0,
  );

  const executeRemoveDownload = async (item: DownloadItem) => {
    setAlertState(hideAlert());
    try {
      const outcome = await applicationFacade().models.control({
        type: 'cancel-download',
        modelId: item.downloadId ?? item.modelId,
      });
      if (!outcome.ok) throw new Error(modelsFailureMessage(outcome.failure));
    } catch (error) {
      logger.error('[DownloadManager] Failed to remove download:', error);
      setAlertState(showAlert('Error', 'Failed to remove download'));
    }
  };

  const handleRetryDownload = async (item: DownloadItem) => {
    try {
      const outcome = await applicationFacade().models.control({
        type: 'retry-download',
        modelId: item.downloadId ?? item.modelId,
      });
      if (!outcome.ok) throw new Error(modelsFailureMessage(outcome.failure));
    } catch (error: any) {
      logger.error('[DownloadManager] Failed to retry download:', error);
      setAlertState(showAlert(
        'Retry Failed',
        error instanceof Error ? error.message : String(error),
      ));
    }
  };

  const handlePauseDownload = async (item: DownloadItem) => {
    try {
      const outcome = await applicationFacade().models.control({
        type: 'pause-download',
        modelId: item.downloadId ?? item.modelId,
      });
      if (!outcome.ok) throw new Error(modelsFailureMessage(outcome.failure));
    } catch (error) {
      logger.error('[DownloadManager] Failed to pause download:', error);
      setAlertState(showAlert('Error', 'Failed to pause download'));
    }
  };

  const handleResumeDownload = async (item: DownloadItem) => {
    try {
      const outcome = await applicationFacade().models.control({
        type: 'resume-download',
        modelId: item.downloadId ?? item.modelId,
      });
      if (!outcome.ok) throw new Error(modelsFailureMessage(outcome.failure));
    } catch (error) {
      logger.error('[DownloadManager] Failed to resume download:', error);
      setAlertState(showAlert('Error', 'Failed to resume download'));
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
      const outcome = await applicationFacade().models.remove(model.id);
      if (!outcome.ok) throw new Error(modelsFailureMessage(outcome.failure));
    } catch (error) {
      logger.error('[DownloadManager] Failed to delete model:', error);
      setAlertState(showAlert('Error', 'Failed to delete model'));
    }
  };

  const executeDeleteImageModel = async (model: ONNXImageModel) => {
    setAlertState(hideAlert());
    try {
      const outcome = await applicationFacade().models.remove(model.id);
      if (!outcome.ok) throw new Error(modelsFailureMessage(outcome.failure));
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
    modelLibrary
      .executeVisionRepair({ type: 'repair-model', model })
      .then(result => {
        if (result.status === 'failed') throw new Error(result.error);
        if (result.status === 'installed-reconciliation-pending') {
          setAlertState(showAlert('Vision Installed', result.message));
          return;
        }
        const outcome = result.outcome;
        logger.log('[DownloadDebug] Repair vision outcome', {
          modelId: item.modelId,
          outcome: outcome.kind,
        });
        const [title, body] = visionRepairMessage(outcome, item.fileName);
        setAlertState(showAlert(title, body));
      })
      .catch((e: Error) => {
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
    repairDownloadFor,
    totalStorageUsed,
  };
}
