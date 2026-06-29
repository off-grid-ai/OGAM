/**
 * STT (Whisper) download provider. Wraps the EXISTING working bridge — it does not
 * reinvent downloading: completed models come from whisperService (disk), in-flight
 * from the shared downloadStore, and retry/cancel/remove delegate to the same
 * service-level calls the Download Manager already uses (whisperService.downloadModel
 * / deleteModel, backgroundDownloadService.cancelDownload, downloadStore.remove).
 *
 * Capabilities: STT is NOT resumable (the foreground download dies on app-kill) →
 * reconcile() strands an interrupted in-flight download as a retriable error rather
 * than a phantom "downloading".
 */
import { whisperService } from '../../whisperService';
import { backgroundDownloadService } from '../../backgroundDownloadService';
import { useDownloadStore, isActiveStatus } from '../../../stores/downloadStore';
import logger from '../../../utils/logger';
import { mapStoreStatus } from '../storeStatus';
import type { DownloadProvider, ModelDownload } from '../types';

const STT_CAPABILITIES = {
  cancel: true,
  retry: true,
  remove: true,
  resumable: false,        // foreground download dies on app-kill
  determinateProgress: true,
} as const;

/** The store keys STT models as `whisper-<id>`; the uniform id uses the bare id. */
const bareId = (storeModelId: string): string => storeModelId.replace(/^whisper-/, '');
const downloadId = (id: string): string => id.replace(/^stt:/, '');

/** Find the in-flight store entry for a bare STT model id, if any. */
function findEntry(modelId: string) {
  return Object.values(useDownloadStore.getState().downloads)
    .find(e => e.modelType === 'stt' && bareId(e.modelId) === modelId);
}

export const sttProvider: DownloadProvider = {
  modelType: 'stt',

  async list(): Promise<ModelDownload[]> {
    const out: ModelDownload[] = [];
    // In-flight (downloadStore).
    for (const e of Object.values(useDownloadStore.getState().downloads)) {
      if (e.modelType !== 'stt') continue;
      const id = bareId(e.modelId);
      out.push({
        id: `stt:${id}`, modelType: 'stt', name: e.fileName || id,
        sizeBytes: e.totalBytes, bytesDownloaded: e.bytesDownloaded, progress: e.progress,
        status: mapStoreStatus(e.status), capabilities: STT_CAPABILITIES, error: e.errorMessage,
      });
    }
    // Completed (on disk) — skip ones that also have a live in-flight entry.
    const inflight = new Set(out.map(d => d.id));
    const downloaded = await whisperService.listDownloadedModels();
    for (const m of downloaded) {
      const id = `stt:${m.modelId}`;
      if (inflight.has(id)) continue;
      out.push({
        id, modelType: 'stt', name: m.fileName, sizeBytes: m.sizeBytes,
        bytesDownloaded: m.sizeBytes, progress: 1, status: 'completed',
        capabilities: STT_CAPABILITIES, filePath: m.filePath,
      });
    }
    return out;
  },

  async cancel(id: string): Promise<void> {
    const entry = findEntry(downloadId(id));
    if (!entry) return;
    await backgroundDownloadService.cancelDownload(entry.downloadId).catch(() => {});
    useDownloadStore.getState().remove(entry.modelKey);
  },

  async retry(id: string): Promise<void> {
    const modelId = downloadId(id);
    // Clear the dead native task + stale store row, then re-download (whisperService
    // refuses to start while an entry exists) — the same recovery the manager uses.
    const entry = findEntry(modelId);
    if (entry?.downloadId) await backgroundDownloadService.cancelDownload(entry.downloadId).catch(() => {});
    if (entry) useDownloadStore.getState().remove(entry.modelKey);
    whisperService.downloadModel(modelId).catch(err =>
      logger.warn('[sttProvider] retry download failed:', err));
  },

  async remove(id: string): Promise<void> {
    const modelId = downloadId(id);
    const entry = findEntry(modelId);
    if (entry) {
      await backgroundDownloadService.cancelDownload(entry.downloadId).catch(() => {});
      useDownloadStore.getState().remove(entry.modelKey);
    }
    await whisperService.deleteModel(modelId).catch(err =>
      logger.warn('[sttProvider] delete failed:', err));
  },

  subscribe(onChange: () => void): () => void {
    return useDownloadStore.subscribe(onChange);
  },

  async reconcile(): Promise<void> {
    // Not resumable: any STT download still 'active' on launch was interrupted by
    // the app close — mark it failed so it surfaces as a retry, not a phantom.
    const store = useDownloadStore.getState();
    for (const e of Object.values(store.downloads)) {
      if (e.modelType === 'stt' && isActiveStatus(e.status)) {
        logger.log(`[DL-SM] stt:${bareId(e.modelId)} reconcile: interrupted by app close → failed`);
        store.setStatus(e.downloadId, 'failed', { message: 'Interrupted — app closed. Tap retry.' });
      }
    }
  },
};
