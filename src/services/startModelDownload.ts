import { modelManager } from './modelManager';
import { mmProjLocalName } from './modelManager/download';
import { useDownloadStore, isActiveStatus } from '../stores/downloadStore';
import { useAppStore } from '../stores';
import { makeModelKey } from '../utils/modelKey';
import type { ModelFile, DownloadedModel } from '../types';

/** Placeholder downloadId for a row that exists only to represent the QUEUED state
 *  before a real native download has been started (which may wait for a concurrency
 *  slot). Reconciled to the real id by download.ts's retryEntry once the start begins. */
const queuedPlaceholderId = (modelKey: string) => `queued:${modelKey}`;

export interface StartModelDownloadOpts {
  /** Screen-specific UI to run AFTER the model is registered (e.g. a success or
   *  vision-repair alert). The standard register + clear has already happened. */
  onRegistered?: (model: DownloadedModel) => void;
  /** Screen-specific error UI (e.g. an alert). The in-flight entry's 'failed' status
   *  is already set when this fires. */
  onError?: (error: Error) => void;
}

/**
 * THE single entry point to start a model download — shared by the Models screen
 * (useTextModels) and the onboarding ModelDownloadScreen so both use the IDENTICAL
 * mechanism instead of two near-duplicate handlers:
 *   duplicate-start guard → modelManager.downloadModelBackground → watchDownload →
 *   register the model (appStore) + clear the in-flight store entry.
 * Each screen owns only its presentation, via onRegistered / onError. The underlying
 * pipeline (backgroundDownloadService, downloadStore progress, mmproj sidecar) was
 * already shared; this collapses the last duplicated wrapper around it.
 */
export async function startModelDownload(
  modelId: string,
  file: ModelFile,
  opts: StartModelDownloadOpts = {},
): Promise<void> {
  const modelKey = makeModelKey(modelId, file.name);
  // Duplicate-start guard: a download already active for this logical file (rapid
  // double-tap, race after retry) is a no-op. add() also enforces this; checking
  // up-front avoids the unnecessary native call.
  const existing = useDownloadStore.getState().downloads[modelKey];
  if (existing && isActiveStatus(existing.status)) return;

  // Publish a QUEUED row to the store IMMEDIATELY, before starting the (possibly
  // slot-limited) native download. Without this, a queued download had no store entry
  // at all until a concurrency slot freed up — so the Models/onboarding screens (which
  // read the store) showed nothing, and this very guard missed a second tap while
  // queued (letting the same model enqueue twice). The store is the single source of
  // truth all screens read; download.ts reconciles this placeholder id to the real
  // native downloadId via retryEntry once the start begins.
  useDownloadStore.getState().add({
    modelKey,
    downloadId: queuedPlaceholderId(modelKey),
    modelId,
    fileName: file.name,
    quantization: file.quantization,
    modelType: 'text',
    status: 'pending',
    bytesDownloaded: 0,
    totalBytes: file.size,
    combinedTotalBytes: file.size + (file.mmProjFile?.size ?? 0),
    progress: 0,
    createdAt: Date.now(),
    ...(file.mmProjFile && {
      mmProjFileName: mmProjLocalName(file.name),
      mmProjFileSize: file.mmProjFile.size,
    }),
  });

  // Until the real native start begins, the failure target is the queued placeholder row.
  let currentDownloadId: string | undefined = queuedPlaceholderId(modelKey);
  const fail = (err: Error) => {
    if (currentDownloadId) {
      useDownloadStore.getState().setStatus(currentDownloadId, 'failed', { message: err.message });
    }
    opts.onError?.(err);
  };

  try {
    // downloadModelBackground writes the row + adds the store entry synchronously
    // after start (add for new, retryEntry for an existing failed one — including the
    // queued placeholder row added above, whose id it reconciles to the real one).
    const info = await modelManager.downloadModelBackground(modelId, file);
    currentDownloadId = info.downloadId;
    modelManager.watchDownload(info.downloadId, (model: DownloadedModel) => {
      // Standard completion: register + clear the in-flight entry so the UI reads
      // "downloaded" from downloadedModels, not a lingering 100% store entry.
      useAppStore.getState().addDownloadedModel(model);
      useDownloadStore.getState().remove(modelKey);
      opts.onRegistered?.(model);
    }, fail);
  } catch (e) {
    // A start cancelled while still queued (no slot yet) rejects with `.cancelled` — it
    // is not an error, so drop the queued placeholder row and clean up quietly.
    if ((e as Error & { cancelled?: boolean })?.cancelled) {
      useDownloadStore.getState().remove(modelKey);
      return;
    }
    fail(e as Error);
  }
}
