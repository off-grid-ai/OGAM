import { create } from 'zustand';
import type { DownloadProjectionPort } from '@offgrid/application';
import { createModelDownloadProjection } from '../services/composition/downloads';
import type { ModelKey } from '../utils/modelKey';
import type { DownloadStatus, DownloadEntry } from '../utils/downloadStatus';

export type { DownloadStatus, DownloadEntry };
export {
  isActiveStatus,
  isQueuedStatus,
  isDownloadingStatus,
  isFailedStatus,
} from '../utils/downloadStatus';

interface DownloadStoreState {
  downloads: Record<ModelKey, DownloadEntry>;
  downloadIdIndex: Record<string, ModelKey>;
  repairingVisionIds: Record<string, true>;
  setRepairingVision(modelId: string, repairing: boolean): void;
  setAll(entries: DownloadEntry[]): void;
  hydrate(entries: DownloadEntry[]): void;
  add(entry: DownloadEntry): void;
  setMmProjDownloadId(modelKey: ModelKey, mmProjDownloadId: string): void;
  updateProgress(downloadId: string, bytes: number, total: number): void;
  updateMmProjProgress(mmProjDownloadId: string, bytes: number): void;
  setStatus(downloadId: string, status: DownloadStatus, error?: { message: string; code?: string }): void;
  setProcessing(downloadId: string): void;
  setCompleted(downloadId: string): void;
  setMmProjCompleted(mmProjDownloadId: string, bytes: number): void;
  retryEntry(modelKey: ModelKey, newDownloadId: string): void;
  remove(modelKey: ModelKey): void;
}

/** Zustand read/write as the projection's persistence port. */
function mobileDownloadProjectionPorts(): DownloadProjectionPort<DownloadEntry> {
  return {
    read: () => {
      const state = useDownloadStore.getState();
      return { downloads: state.downloads, downloadIdIndex: state.downloadIdIndex };
    },
    write: state => useDownloadStore.setState(state),
  };
}

export const useDownloadStore = create<DownloadStoreState>((set) => {
  return {
    downloads: {},
    downloadIdIndex: {},
    repairingVisionIds: {},
    setRepairingVision: (modelId, repairing) => set(state => {
      const repairingVisionIds = { ...state.repairingVisionIds };
      if (repairing) repairingVisionIds[modelId] = true;
      else delete repairingVisionIds[modelId];
      return { repairingVisionIds };
    }),
    setAll: entries => modelDownloadProjection.replace(entries),
    hydrate: entries => modelDownloadProjection.hydrate(entries),
    add: entry => modelDownloadProjection.admit(entry),
    setMmProjDownloadId: (modelKey, downloadId) =>
      modelDownloadProjection.attachProjector(modelKey, downloadId),
    updateProgress: (downloadId, bytes, total) =>
      modelDownloadProjection.reportProgress(downloadId, bytes, total, Date.now()),
    updateMmProjProgress: (downloadId, bytes) =>
      modelDownloadProjection.reportProjectorProgress(downloadId, bytes, Date.now()),
    setStatus: (downloadId, status, error) =>
      modelDownloadProjection.reportStatus(downloadId, status, error),
    setProcessing: downloadId => modelDownloadProjection.beginProcessing(downloadId),
    setCompleted: downloadId => modelDownloadProjection.complete(downloadId),
    setMmProjCompleted: (downloadId, bytes) =>
      modelDownloadProjection.completeProjector(downloadId, bytes),
    retryEntry: (modelKey, downloadId) => modelDownloadProjection.retry(modelKey, downloadId),
    remove: modelKey => modelDownloadProjection.remove(modelKey),
  };
});

export const modelDownloadProjection =
  createModelDownloadProjection<DownloadEntry>(mobileDownloadProjectionPorts());
