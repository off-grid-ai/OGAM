import { modelManager } from './modelManager';
import RNFS from 'react-native-fs';
import { mtpHeadForPrimaryFile } from '@offgrid/models';
import { mmProjLocalName, downloadCompanionFile } from './modelManager/download';
import { backgroundDownloadService } from './backgroundDownloadService';
import { useDownloadStore, isActiveStatus } from '../stores/downloadStore';
import { useAppStore } from '../stores';
import { activeModelService } from './activeModelService';
import { makeModelKey } from '../utils/modelKey';
import { statFile } from '../utils/fileStat';
import type { ModelFile, DownloadedModel } from '../types';

/** Placeholder downloadId for a row that exists only to represent the QUEUED state
 *  before a real native download has been started (which may wait for a concurrency
 *  slot). Reconciled to the real id by download.ts's retryEntry once the start begins. */
const queuedPlaceholderId = (modelKey: string) => `queued:${modelKey}`;

type CompanionFile = { name: string; url: string; sizeBytes: number; sha256?: string };

/** The job's files besides the weights and their vision projector: a split model's later parts and
 *  the model's separately published MTP head. */
function companionFiles(file: ModelFile): CompanionFile[] {
  const parts = (file.parts ?? []).slice(1).map(part => ({
    name: part.name, url: part.downloadUrl, sizeBytes: part.size, ...(part.sha256 ? { sha256: part.sha256 } : {}),
  }));
  const head = mtpHeadForPrimaryFile(file.name);
  return head ? [...parts, head] : parts;
}

async function onDisk(path: string, sizeBytes: number): Promise<boolean> {
  return (await RNFS.exists(path)) && (await statFile(path))?.size === sizeBytes;
}

/**
 * Fetch the job's other files before its weights, one after another, counting their bytes toward the
 * model's one progress bar. A file already on disk is not fetched again. Removing the row (cancel)
 * stops the transfer under way. Rejects when a file fails, so the model never registers incomplete.
 */
async function fetchCompanions(modelId: string, modelKey: string, companions: CompanionFile[]): Promise<void> {
  if (companions.length === 0) return;
  const dir = modelManager.getModelsDirectory();
  const present = await Promise.all(companions.map(c => onDisk(`${dir}/${c.name}`, c.sizeBytes)));
  let done = companions.reduce((total, c, i) => total + (present[i] ? c.sizeBytes : 0), 0);
  useDownloadStore.getState().setCompanionBytes(modelKey, done);
  for (const companion of companions.filter((_, i) => !present[i])) {
    const localPath = `${dir}/${companion.name}`;
    if (!useDownloadStore.getState().downloads[modelKey]) throw Object.assign(new Error('cancelled'), { cancelled: true });
    let transferId: string | undefined;
    const stopWatching = useDownloadStore.subscribe(state => {
      if (!state.downloads[modelKey] && transferId) backgroundDownloadService.cancelDownload(transferId).catch(() => {});
    });
    try {
      // One transfer at a time on purpose: the bar fills in order and the job holds one download slot.
      await downloadCompanionFile({ // NOSONAR
        modelId,
        file: companion,
        localPath,
        onDownloadIdReady: id => { transferId = id; },
        onBytes: bytes => useDownloadStore.getState().setCompanionBytes(modelKey, done + bytes),
      });
    } finally {
      stopWatching();
    }
    done += companion.sizeBytes;
    useDownloadStore.getState().setCompanionBytes(modelKey, done);
  }
}

export interface StartModelDownloadOpts {
  /** Select a downloaded user model when the download began without a selection.
   * Hidden support-model downloads leave this off. */
  autoSelectIfEmpty?: boolean;
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
  // Capture this before the asynchronous download starts. If the user had a
  // selection and explicitly unloads it while this download runs, completion
  // must not replace that decision.
  const mayAutoSelect =
    opts.autoSelectIfEmpty === true &&
    useAppStore.getState().activeModelId === null;
  const modelKey = makeModelKey(modelId, file.name);
  // Duplicate-start guard: a download already active for this logical file (rapid
  // double-tap, race after retry) is a no-op. add() also enforces this; checking
  // up-front avoids the unnecessary native call.
  const existing = useDownloadStore.getState().downloads[modelKey];
  if (existing && isActiveStatus(existing.status)) return;
  // One tap downloads everything the model needs: every part of a split model, its vision projector
  // and its MTP head, on one progress bar.
  const companions = companionFiles(file);

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
    // A split model's size is already every part's; the MTP head is the one file it does not count.
    combinedTotalBytes: file.size + (file.mmProjFile?.size ?? 0) + (mtpHeadForPrimaryFile(file.name)?.sizeBytes ?? 0),
    progress: 0,
    createdAt: Date.now(),
    ...(file.mmProjFile && {
      mmProjFileName: mmProjLocalName(file.name, file.mmProjFile.name),
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
    await fetchCompanions(modelId, modelKey, companions);
  } catch (e) {
    // Cancelled (the row is gone) stops quietly. A failed file clears the row and says so; the next
    // tap fetches only what is still missing.
    const cancelled = (e as Error & { cancelled?: boolean }).cancelled || !useDownloadStore.getState().downloads[modelKey];
    useDownloadStore.getState().remove(modelKey);
    if (!cancelled) opts.onError?.(e as Error);
    return;
  }

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
      const app = useAppStore.getState();
      if (mayAutoSelect && app.activeModelId === null) {
        const selected =
          app.downloadedModels.find(item => item.id === app.lastTextModelId) ??
          app.downloadedModels[0];
        if (selected) activeModelService.selectTextModel(selected.id);
      }
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
