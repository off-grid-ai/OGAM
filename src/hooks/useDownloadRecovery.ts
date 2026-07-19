import { useCallback, useEffect, useRef } from 'react';
import { modelManager } from '../services';
import { initActiveDownloadPersistence } from '../services/activeDownloadPersistence';
import { hydrateDownloadStore } from '../services/downloadHydration';
import { registerCoreDownloadProviders } from '../services/modelDownloadService/registerProviders';
import { restoreQueuedDownloads } from '../services/restoreQueuedDownloads';
import { useAppStore } from '../stores';
import { useDownloadStore } from '../stores/downloadStore';
import logger from '../utils/logger';

/** Owns cold-start download recovery and its process-lifetime polling resource. */
export function useDownloadRecovery() {
  const isMountedRef = useRef(true);
  const setDownloadedModels = useAppStore(state => state.setDownloadedModels);
  const setDownloadedImageModels = useAppStore(
    state => state.setDownloadedImageModels,
  );

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      modelManager.stopBackgroundDownloadPolling();
    };
  }, []);

  const reattachTextDownloadRecovery = useCallback(async () => {
    const restoredIds = await modelManager.restoreInProgressDownloads();
    if (!isMountedRef.current) return;
    modelManager.startBackgroundDownloadPolling();
    restoredIds.forEach(downloadId => {
      modelManager.watchDownload(
        downloadId,
        async () => {
          const models = await modelManager.getDownloadedModels();
          setDownloadedModels(models);
          const store = useDownloadStore.getState();
          store.remove(store.downloadIdIndex[downloadId] ?? '');
        },
        (error: Error) => {
          logger.error('[App] Restored text download failed:', error);
          useDownloadStore
            .getState()
            .setStatus(downloadId, 'failed', { message: error.message });
        },
      );
    });
  }, [setDownloadedModels]);

  const recoverDownloadState = useCallback(() => {
    (async () => {
      initActiveDownloadPersistence();
      await hydrateDownloadStore().catch(error => {
        logger.error(
          '[App] Failed to hydrate download store during startup:',
          error,
        );
      });
      await reattachTextDownloadRecovery();
      if (!isMountedRef.current) return;

      registerCoreDownloadProviders();
      await restoreQueuedDownloads().catch(error => {
        logger.error(
          '[App] Failed to restore queued downloads during startup:',
          error,
        );
      });
      if (!isMountedRef.current) return;

      const activeImageModelIds = new Set(
        Object.values(useDownloadStore.getState().downloads)
          .filter(entry => entry.modelType === 'image')
          .map(entry => entry.modelId.replace('image:', '')),
      );
      await modelManager
        .reconcileFinishedImageDownloads(activeImageModelIds)
        .catch(error => {
          logger.error('[App] Image model reconciliation failed:', error);
        });
      if (!isMountedRef.current) return;

      const { textModels, imageModels } =
        await modelManager.refreshModelLists();
      if (!isMountedRef.current) return;
      setDownloadedModels(textModels);
      setDownloadedImageModels(imageModels);
    })().catch(error => {
      logger.error('[App] Download-state recovery failed:', error);
    });
  }, [
    reattachTextDownloadRecovery,
    setDownloadedImageModels,
    setDownloadedModels,
  ]);

  return { reattachTextDownloadRecovery, recoverDownloadState };
}
