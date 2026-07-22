/**
 * Image (ONNX/CoreML) download provider. list/remove/reconcile are service-level.
 *
 * RETRY platform split lives HERE (mirrors textProvider): Android resumes the native
 * row in-place (setStatus + retryDownload — UI-free, so the provider does it
 * directly); iOS must re-run the alert-coupled finalization/re-download, which pulls
 * CustomAlert and can't be imported into a service, so that one path is INJECTED by
 * the Download Manager via setImageDownloadOps. The UI never branches on Platform.OS
 * for retry — the provider owns the decision.
 *
 * CANCEL is UI-coupled for multi-file (synthetic `image-multi:` rows need the alert
 * path), also injected via setImageDownloadOps; it falls back to a plain native
 * cancel when no ops are registered.
 *
 * resumable: zip on Android only; multi-file (synthetic `image-multi:` id, no native
 * row) is never resumable → reconcile strands stranded in-flight as retriable error.
 */
import { Platform } from 'react-native';
import { modelManager } from '../../modelManager';
import { activeModelService } from '../../activeModelService';
import { backgroundDownloadService } from '../../backgroundDownloadService';
import { useAppStore } from '../../../stores';
import { useDownloadStore, isActiveStatus, DownloadEntry } from '../../../stores/downloadStore';
import logger from '../../../utils/logger';
import { mapStoreStatus } from '../storeStatus';
import { uniformDownloadId } from '../uniformId';
import type { DownloadProvider, ModelDownload } from '../types';

/**
 * Alert-coupled image ops the Download Manager injects:
 *  - cancel: multi-file (synthetic row) cancel that needs the alert path.
 *  - retry:  the iOS re-download/finalization path (pulls CustomAlert). Android retry
 *            is handled natively inside this provider and does NOT use this op.
 */
export interface ImageDownloadOps {
  cancel?: (modelId: string, entry: DownloadEntry) => Promise<void>;
  retry?: (modelId: string, entry: DownloadEntry) => Promise<void>;
}
let imageOps: ImageDownloadOps = {};
export function setImageDownloadOps(ops: ImageDownloadOps): void { imageOps = ops; }

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const bareId = (storeModelId: string): string => storeModelId.replace(/^image:/, '');
const modelIdOf = (id: string): string => id.replace(/^image:/, '');
const isMultifile = (e: DownloadEntry): boolean => e.downloadId.startsWith('image-multi:');
const imageEntries = (): DownloadEntry[] =>
  Object.values(useDownloadStore.getState().downloads).filter(e => e.modelType === 'image');
const findEntry = (modelId: string): DownloadEntry | undefined =>
  imageEntries().find(e => bareId(e.modelId) === modelId);

export const imageProvider: DownloadProvider = {
  modelType: 'image',

  async list(): Promise<ModelDownload[]> {
    const out: ModelDownload[] = [];
    // Retry is structurally available for image on BOTH platforms (Android resumes
    // the native row here; iOS re-runs the injected re-download/finalization), so the
    // flag is a STABLE constant — it must not depend on imageOps, which are injected
    // by a component effect after the first list (that flip made the affordance flap
    // from dead→live). Matches textProvider's unconditional retry: true.
    for (const e of imageEntries()) {
      const id = bareId(e.modelId);
      // multi-file (no native row) is never resumable; zip resumes on Android.
      const resumable = !isMultifile(e) && Platform.OS === 'android';
      out.push({
        id: uniformDownloadId('image', e.modelId), modelType: 'image', name: e.fileName || id,
        sizeBytes: e.combinedTotalBytes || e.totalBytes, bytesDownloaded: e.bytesDownloaded,
        progress: e.progress, status: mapStoreStatus(e.status),
        capabilities: { cancel: true, retry: true, remove: true, resumable, determinateProgress: true },
        error: e.errorMessage,
      });
    }
    const inflight = new Set(out.map(d => d.id));
    for (const m of useAppStore.getState().downloadedImageModels) {
      const id = uniformDownloadId('image', m.id);
      if (inflight.has(id)) continue;
      out.push({
        id, modelType: 'image', name: m.name, sizeBytes: m.size, bytesDownloaded: m.size,
        progress: 1, status: 'completed',
        capabilities: { cancel: true, retry: true, remove: true, resumable: false, determinateProgress: true },
        filePath: m.modelPath,
      });
    }
    return out;
  },

  async cancel(id: string): Promise<void> {
    const modelId = modelIdOf(id);
    const entry = findEntry(modelId);
    if (!entry) return;
    if (imageOps.cancel) { await imageOps.cancel(modelId, entry); return; } // UI-coupled (multi-file)
    // Fallback: plain native cancel for a zip/native row.
    await backgroundDownloadService.cancelDownload(entry.downloadId)
      .catch(err => logger.log(`[DL-SM] image:${modelId} cancel: native cancel failed err=${msg(err)}`));
    useDownloadStore.getState().remove(entry.modelKey);
  },

  async retry(id: string): Promise<void> {
    const modelId = modelIdOf(id);
    const entry = findEntry(modelId);
    if (!entry) return;
    // A zip interrupted MID-TRANSFER resumes natively (UI-free, do it here). But an image whose bytes
    // FINISHED and then failed EXTRACTION (ImageModelIncompleteError — missing unet.bin/clip.weight),
    // or a multi-file download (synthetic `image-multi:` row), has NO live native row to resume:
    // retryDownload throws "Download not found" on EVERY tap (device-confirmed, B6). In those cases
    // fall back to the injected full re-download path (cancels the stale row, fetches fresh).
    const nativeResumable = Platform.OS === 'android' && !isMultifile(entry) && !!entry.downloadId;
    if (nativeResumable) {
      try {
        await backgroundDownloadService.retryDownload(entry.downloadId);
        // Publish "pending" only after native accepts ownership. If the completed
        // archive is gone, the fallback below must still see a failed row so its
        // replacement download is not coalesced as an already-active request.
        useDownloadStore.getState().setStatus(entry.downloadId, 'pending');
        backgroundDownloadService.startProgressPolling();
        return;
      } catch (e) {
        // Native row gone (bytes completed, extraction failed) → re-download from scratch below.
        logger.log(`[DL-SM] image:${modelId} native resume failed (${msg(e)}) — re-downloading from scratch`);
      }
    }
    if (imageOps.retry) { await imageOps.retry(modelId, entry); return; } // full re-download (all platforms) / iOS
    logger.log(`[DL-SM] image:${modelId} retry: no live native row and no image ops — refused`);
  },

  async remove(id: string): Promise<void> {
    const modelId = modelIdOf(id);
    const entry = findEntry(modelId);
    if (entry) {
      await backgroundDownloadService.cancelDownload(entry.downloadId)
        .catch(err => logger.log(`[DL-SM] image:${modelId} remove: native cancel failed err=${msg(err)}`));
      useDownloadStore.getState().remove(entry.modelKey);
    }
    await activeModelService.unloadImageModel()
      .catch(err => logger.log(`[DL-SM] image:${modelId} remove: unload failed err=${msg(err)}`));
    await modelManager.deleteImageModel(modelId)
      .catch(err => logger.log(`[DL-SM] image:${modelId} remove: delete failed err=${msg(err)}`));
    useAppStore.getState().removeDownloadedImageModel(modelId);
  },

  subscribe(onChange: () => void): () => void {
    return useDownloadStore.subscribe(onChange);
  },

  async reconcile(): Promise<void> {
    // Multi-file has no native row (never resumes); iOS zip foreground dies too.
    const store = useDownloadStore.getState();
    for (const e of imageEntries()) {
      if (!isActiveStatus(e.status)) continue;
      const resumableOnRelaunch = !isMultifile(e) && Platform.OS === 'android';
      if (resumableOnRelaunch) continue;
      logger.log(`[DL-SM] image:${bareId(e.modelId)} reconcile: interrupted (multifile/iOS) → failed`);
      store.setStatus(e.downloadId, 'failed', { message: 'Interrupted — app closed. Tap retry.' });
    }
  },
};
