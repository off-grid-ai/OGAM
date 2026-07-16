import { create } from 'zustand';
import { ModelKey } from '../utils/modelKey';
import logger from '../utils/logger';
// The status classification + DownloadEntry shape live in a PURE util so pure consumers can use
// them without depending on this store (utils-stay-pure). Re-exported here for back-compat — every
// existing `from '../stores/downloadStore'` importer of these keeps working unchanged.
import { DownloadStatus, DownloadEntry } from '../utils/downloadStatus';

export type { DownloadStatus, DownloadEntry };
export type { ModelType } from '../utils/downloadStatus';
export { isActiveStatus, isQueuedStatus, isDownloadingStatus, isFailedStatus } from '../utils/downloadStatus';

interface DownloadStoreState {
  downloads: Record<ModelKey, DownloadEntry>
  downloadIdIndex: Record<string, ModelKey>
  repairingVisionIds: Record<string, true>

  setRepairingVision: (modelId: string, repairing: boolean) => void
  setAll: (entries: DownloadEntry[]) => void
  hydrate: (entries: DownloadEntry[]) => void
  add: (entry: DownloadEntry) => void
  setMmProjDownloadId: (modelKey: ModelKey, mmProjDownloadId: string) => void
  updateProgress: (downloadId: string, bytes: number, total: number) => void
  updateMmProjProgress: (mmProjDownloadId: string, bytes: number) => void
  setStatus: (downloadId: string, status: DownloadStatus, error?: { message: string; code?: string }) => void
  setProcessing: (downloadId: string) => void
  setCompleted: (downloadId: string) => void
  setMmProjCompleted: (mmProjDownloadId: string, bytes: number) => void
  retryEntry: (modelKey: ModelKey, newDownloadId: string) => void
  remove: (modelKey: ModelKey) => void
}

export const useDownloadStore = create<DownloadStoreState>((set) => ({
  downloads: {},
  downloadIdIndex: {},
  repairingVisionIds: {},

  setRepairingVision: (modelId, repairing) => set(state => {
    if (repairing) {
      return { repairingVisionIds: { ...state.repairingVisionIds, [modelId]: true } };
    }
    const next = { ...state.repairingVisionIds };
    delete next[modelId];
    return { repairingVisionIds: next };
  }),

  setAll: (entries) => {
    const downloads: Record<ModelKey, DownloadEntry> = {};
    const downloadIdIndex: Record<string, ModelKey> = {};
    for (const entry of entries) {
      downloads[entry.modelKey] = entry;
      downloadIdIndex[entry.downloadId] = entry.modelKey;
      if (entry.mmProjDownloadId) {
        downloadIdIndex[entry.mmProjDownloadId] = entry.modelKey;
      }
    }
    set({ downloads, downloadIdIndex });
  },

  // Like setAll, but preserves any existing entry whose JS-tracked progress
  // is ahead of the native row. Avoids foreground-resume hydration blowing
  // away in-flight progress that listeners have already advanced past the
  // native snapshot.
  hydrate: (entries) => set(state => {
    const downloads: Record<ModelKey, DownloadEntry> = {};
    const downloadIdIndex: Record<string, ModelKey> = {};
    for (const next of entries) {
      const existing = state.downloads[next.modelKey];
      let merged: DownloadEntry;
      if (existing && existing.bytesDownloaded >= next.bytesDownloaded) {
        // Local listeners are ahead — keep them, just refresh metadataJson + total
        merged = {
          ...existing,
          totalBytes: next.totalBytes || existing.totalBytes,
          combinedTotalBytes: next.combinedTotalBytes || existing.combinedTotalBytes,
          metadataJson: next.metadataJson ?? existing.metadataJson,
        };
      } else {
        merged = next;
      }
      downloads[merged.modelKey] = merged;
      downloadIdIndex[merged.downloadId] = merged.modelKey;
      if (merged.mmProjDownloadId) {
        downloadIdIndex[merged.mmProjDownloadId] = merged.modelKey;
      }
    }
    return { downloads, downloadIdIndex };
  }),

  // Adds a new entry. Refuses if any entry already exists for this modelKey,
  // active or otherwise. Failed/stuck/retrying entries must be restarted via
  // retryEntry (which preserves the same logical record), or the user must
  // remove() them first. This enforces "one logical entry per model/file"
  // and prevents a fresh start path from silently replacing a visible failed
  // entry that the product rules say must persist until explicit user action.
  add: (entry) => set(state => {
    if (state.downloads[entry.modelKey]) return state;
    return {
      downloads: { ...state.downloads, [entry.modelKey]: entry },
      downloadIdIndex: {
        ...state.downloadIdIndex,
        [entry.downloadId]: entry.modelKey,
        ...(entry.mmProjDownloadId ? { [entry.mmProjDownloadId]: entry.modelKey } : {}),
      },
    };
  }),

  setMmProjDownloadId: (modelKey, mmProjDownloadId) => set(state => {
    const entry = state.downloads[modelKey];
    if (!entry) return state;
    logger.log('[DownloadDebug] Register mmproj download', {
      modelKey,
      mmProjDownloadId,
      mainDownloadId: entry.downloadId,
    });
    return {
      downloads: { ...state.downloads, [modelKey]: { ...entry, mmProjDownloadId, mmProjStatus: 'pending' } },
      downloadIdIndex: { ...state.downloadIdIndex, [mmProjDownloadId]: modelKey },
    };
  }),

  updateProgress: (downloadId, bytes, total) => set(state => {
    const modelKey = state.downloadIdIndex[downloadId];
    if (!modelKey) return state;
    const entry = state.downloads[modelKey];
    if (!entry || entry.downloadId !== downloadId) return state;
    const combinedTotal = entry.combinedTotalBytes || total;
    const mmProjBytes = entry.mmProjBytesDownloaded ?? 0;
    // Clamp: when combinedTotalBytes isn't set yet, the denominator is the main file
    // only, so adding the mmproj sidecar's bytes can push this past 1.0 (the >100%
    // progress bar). A wrong total can also overshoot. Never report >1 or <0.
    const progress = combinedTotal > 0 ? Math.min(1, Math.max(0, (bytes + mmProjBytes) / combinedTotal)) : 0;
    return {
      downloads: {
        ...state.downloads,
        [modelKey]: {
          ...entry,
          bytesDownloaded: bytes,
          totalBytes: total,
          progress,
          status: 'running',
        },
      },
    };
  }),

  updateMmProjProgress: (mmProjDownloadId, bytes) => set(state => {
    const modelKey = state.downloadIdIndex[mmProjDownloadId];
    if (!modelKey) {
      logger.warn('[DownloadDebug] mmproj progress dropped: missing modelKey', { mmProjDownloadId });
      return state;
    }
    const entry = state.downloads[modelKey];
    if (!entry || entry.mmProjDownloadId !== mmProjDownloadId) {
      logger.warn('[DownloadDebug] mmproj progress dropped: entry mismatch', {
        modelKey,
        mmProjDownloadId,
        entryMmProjId: entry?.mmProjDownloadId,
      });
      return state;
    }
    const combinedTotal = entry.combinedTotalBytes || entry.totalBytes;
    // Clamp to [0,1] — same reason as updateProgress (main-only denominator + mmproj bytes).
    const progress = combinedTotal > 0 ? Math.min(1, Math.max(0, (entry.bytesDownloaded + bytes) / combinedTotal)) : 0;
    return {
      downloads: {
        ...state.downloads,
        [modelKey]: {
          ...entry,
          mmProjBytesDownloaded: bytes,
          mmProjStatus: 'running',
          progress,
        },
      },
    };
  }),

  setStatus: (downloadId, status, error) => set(state => {
    const modelKey = state.downloadIdIndex[downloadId];
    if (!modelKey) return state;
    const entry = state.downloads[modelKey];
    if (!entry) return state;
    const isMmProj = entry.mmProjDownloadId === downloadId;
    if (isMmProj) {
      // Sidecar status is independent of the parent. mmproj failure must not
      // fail the whole download — the main GGUF can still complete and the
      // model becomes usable text-only with a "repair vision" affordance.
      let mmProjErrorMessage = entry.errorMessage;
      if (entry.status !== 'failed') {
        mmProjErrorMessage = status === 'failed' ? error?.message : entry.errorMessage;
      }
      return {
        downloads: {
          ...state.downloads,
          [modelKey]: {
            ...entry,
            mmProjStatus: status as DownloadStatus,
            errorMessage: mmProjErrorMessage,
          },
        },
      };
    }
    return {
      downloads: {
        ...state.downloads,
        [modelKey]: { ...entry, status, errorMessage: error?.message, errorCode: error?.code },
      },
    };
  }),

  setProcessing: (downloadId) => set(state => {
    const modelKey = state.downloadIdIndex[downloadId];
    if (!modelKey) return state;
    const entry = state.downloads[modelKey];
    if (!entry) return state;
    return {
      downloads: { ...state.downloads, [modelKey]: { ...entry, status: 'processing' } },
    };
  }),

  setCompleted: (downloadId) => set(state => {
    const modelKey = state.downloadIdIndex[downloadId];
    if (!modelKey) return state;
    const entry = state.downloads[modelKey];
    if (!entry) return state;
    return {
      downloads: {
        ...state.downloads,
        [modelKey]: { ...entry, status: 'completed', progress: 1 },
      },
    };
  }),

  setMmProjCompleted: (mmProjDownloadId, bytes) => set(state => {
    const modelKey = state.downloadIdIndex[mmProjDownloadId];
    if (!modelKey) return state;
    const entry = state.downloads[modelKey];
    if (!entry || entry.mmProjDownloadId !== mmProjDownloadId) return state;
    return {
      downloads: {
        ...state.downloads,
        [modelKey]: {
          ...entry,
          mmProjBytesDownloaded: bytes,
          mmProjStatus: 'completed' as DownloadStatus,
        },
      },
    };
  }),

  retryEntry: (modelKey, newDownloadId) => set(state => {
    const entry = state.downloads[modelKey];
    if (!entry) return state;
    const newIndex = { ...state.downloadIdIndex };
    delete newIndex[entry.downloadId];
    // Keep mmProjDownloadId in the index — it is still valid until
    // setMmProjDownloadId swaps it for the new sidecar ID after the retry
    // starts. Removing it here creates a window where mmproj progress events
    // arrive with no index match (updateMmProjProgress would log a mismatch
    // warning and drop the update).
    newIndex[newDownloadId] = modelKey;
    return {
      downloads: {
        ...state.downloads,
        [modelKey]: {
          ...entry,
          downloadId: newDownloadId,
          status: 'pending',
          bytesDownloaded: 0,
          progress: 0,
          errorMessage: undefined,
          errorCode: undefined,
          // Preserve mmproj identity fields so the UI still knows this is a
          // vision model and so updateMmProjProgress can still route events.
          // Only reset the mutable progress/status to give a clean slate.
          mmProjStatus: entry.mmProjDownloadId ? 'pending' : undefined,
          mmProjBytesDownloaded: 0,
          // mmProjDownloadId, mmProjFileName, mmProjFileSize — preserved via ...entry
        },
      },
      downloadIdIndex: newIndex,
    };
  }),

  remove: (modelKey) => set(state => {
    const entry = state.downloads[modelKey];
    if (!entry) return state;
    const newIndex = { ...state.downloadIdIndex };
    delete newIndex[entry.downloadId];
    if (entry.mmProjDownloadId) delete newIndex[entry.mmProjDownloadId];
    const newDownloads = { ...state.downloads };
    delete newDownloads[modelKey];
    return { downloads: newDownloads, downloadIdIndex: newIndex };
  }),
}));
