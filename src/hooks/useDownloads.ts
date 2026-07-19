import { useEffect } from 'react';
import { backgroundDownloadService } from '../services/backgroundDownloadService';
import { useDownloadStore } from '../stores/downloadStore';
import { toUserMessage } from '../utils/downloadErrors';

/**
 * Lightweight hook for App root — registers native download event listeners only.
 * Has NO store subscription, so download progress never re-renders the root
 * component and the entire navigation tree.
 *
 * Screens that need to read download state should use useDownloads() directly.
 */
export function useDownloadListeners() {
  useEffect(() => {
    if (!backgroundDownloadService.isAvailable()) return;

    const unsubProgress = backgroundDownloadService.onAnyProgress(event => {
      const { downloadIdIndex, downloads } = useDownloadStore.getState();
      const modelKey = downloadIdIndex[event.downloadId];
      if (!modelKey) {
        return;
      }
      const entry = downloads[modelKey];
      if (!entry) {
        return;
      }

      // Status transitions from native (retrying / waiting_for_network) come
      // through Progress events. Don't treat them like normal byte updates —
      // route them to setStatus so the UI reflects the actual state.
      if (
        event.status === 'retrying' ||
        event.status === 'waiting_for_network'
      ) {
        useDownloadStore.getState().setStatus(event.downloadId, event.status);
        return;
      }

      if (entry.downloadId === event.downloadId) {
        useDownloadStore
          .getState()
          .updateProgress(
            event.downloadId,
            event.bytesDownloaded,
            event.totalBytes,
          );
      } else if (entry.mmProjDownloadId === event.downloadId) {
        useDownloadStore
          .getState()
          .updateMmProjProgress(event.downloadId, event.bytesDownloaded);
      } else {
        console.warn(
          '[useDownloads] progress event: downloadId matches neither main nor mmproj',
          {
            downloadId: event.downloadId,
            mainId: entry.downloadId,
            mmProjId: entry.mmProjDownloadId,
          },
        );
      }
    });

    const unsubComplete = backgroundDownloadService.onAnyComplete(event => {
      const { downloadIdIndex, downloads } = useDownloadStore.getState();
      const modelKey = downloadIdIndex[event.downloadId];
      if (!modelKey) return;
      const entry = downloads[modelKey];
      if (!entry) return;

      const isMmProj = entry.mmProjDownloadId === event.downloadId;

      if (isMmProj) {
        useDownloadStore
          .getState()
          .setMmProjCompleted(event.downloadId, event.bytesDownloaded);
        const updated = useDownloadStore.getState().downloads[modelKey];
        if (updated?.status === 'completed') {
          useDownloadStore.getState().setCompleted(entry.downloadId);
        }
        return;
      }

      // gguf complete — if waiting on mmproj, don't mark complete yet
      if (entry.mmProjDownloadId && entry.mmProjStatus !== 'completed') {
        useDownloadStore
          .getState()
          .updateProgress(
            event.downloadId,
            event.bytesDownloaded,
            event.totalBytes,
          );
        return;
      }

      if (entry.modelType === 'image') {
        useDownloadStore.getState().setProcessing(event.downloadId);
        return;
      }

      // Text model finalization (file move + model registration) is handled by
      // watchDownload callbacks in the download initiator. Don't mark complete here.
      if (entry.modelType === 'text') {
        useDownloadStore
          .getState()
          .updateProgress(
            event.downloadId,
            event.bytesDownloaded,
            event.totalBytes,
          );
        return;
      }

      useDownloadStore.getState().setCompleted(event.downloadId);
    });

    const unsubError = backgroundDownloadService.onAnyError(event => {
      const { downloadIdIndex, downloads } = useDownloadStore.getState();
      const modelKey = downloadIdIndex[event.downloadId];
      if (!modelKey) return;
      const entry = downloads[modelKey];
      if (!entry) return;

      useDownloadStore.getState().setStatus(event.downloadId, 'failed', {
        message: toUserMessage(event.reason, event.reasonCode),
        code: event.reasonCode,
      });
    });

    return () => {
      unsubProgress();
      unsubComplete();
      unsubError();
    };
  }, []);
}
