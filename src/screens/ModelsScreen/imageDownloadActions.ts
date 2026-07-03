/** Standalone async image download handlers - no hooks. All download state flows through
 *  useDownloadStore via the stable image:<id> modelKey (single source of truth). */
import { Platform } from 'react-native';
import RNFS from 'react-native-fs';
import { unzip } from 'react-native-zip-archive';
import { showAlert, AlertState } from '../../components/CustomAlert';
import { modelManager, hardwareService, backgroundDownloadService } from '../../services';
import { resolveCoreMLModelDir, downloadCoreMLTokenizerFiles } from '../../utils/coreMLModelUtils';
import { getUserFacingDownloadMessage } from '../../utils/downloadErrors';
import { ONNXImageModel } from '../../types';
import { useDownloadStore, isActiveStatus } from '../../stores/downloadStore';
import { makeImageModelKey } from '../../utils/modelKey';
import { ImageModelDescriptor } from './types';
import { getQnnWarningMessage, showQnnWarningAlert } from './imageDownloadQnn';
import logger from '../../utils/logger';

export interface ImageDownloadDeps {
  addDownloadedImageModel: (m: ONNXImageModel) => void;
  activeImageModelId: string | null;
  setActiveImageModelId: (id: string) => void;
  setAlertState: (s: AlertState) => void;
  /** When false, skip auto-load so the onboarding spotlight can guide the user to load manually. */
  triedImageGen: boolean;
}

interface ImageMetadata {
  imageDownloadType: 'zip' | 'multifile';
  imageModelName: string;
  imageModelDescription: string;
  imageModelSize: number;
  imageModelStyle?: string;
  imageModelBackend?: 'mnn' | 'qnn' | 'coreml';
  imageModelRepo?: string;
  imageModelAttentionVariant?: string;
  imageModelDownloadUrl?: string;
  imageModelHuggingFaceFiles?: { path: string; size: number }[];
  imageModelCoremlFiles?: { path: string; relativePath: string; size: number; downloadUrl: string }[];
}

type MultifileRuntime = {
  cancelled: boolean;
  currentDownloadId?: string;
};

const activeMultifileDownloads = new Map<string, MultifileRuntime>();
const USER_CANCELLED_ERROR = 'user_cancelled';

/** Build a synthetic downloadId for multi-file flows that don't go through WorkManager. */
function makeMultifileId(modelId: string): string {
  return `image-multi:${modelId}`;
}

function startMultifileRuntime(modelId: string): MultifileRuntime {
  const runtime: MultifileRuntime = { cancelled: false };
  activeMultifileDownloads.set(modelId, runtime);
  return runtime;
}

function clearMultifileRuntime(modelId: string) {
  activeMultifileDownloads.delete(modelId);
}

function isCancelledError(error: unknown): boolean {
  // Local assertNotCancelled sentinel OR the cross-service `.cancelled` convention
  // backgroundDownloadService raises for a user-cancelled active/queued download.
  if (!(error instanceof Error)) return false;
  return error.message === USER_CANCELLED_ERROR
    || (error as Error & { cancelled?: boolean }).cancelled === true;
}

function assertNotCancelled(modelId: string, runtime: MultifileRuntime) {
  const stillVisible = !!useDownloadStore.getState().downloads[makeImageModelKey(modelId)];
  if (runtime.cancelled || !stillVisible) {
    runtime.cancelled = true;
    throw new Error(USER_CANCELLED_ERROR);
  }
}

function wireCurrentDownloadPromise(downloadIdPromise: Promise<string> | undefined, runtime: MultifileRuntime) {
  if (downloadIdPromise === undefined) return;
  downloadIdPromise.then((downloadId) => {
    runtime.currentDownloadId = downloadId;
    if (runtime.cancelled) {
      backgroundDownloadService.cancelDownload(downloadId).catch(() => {});
    }
  }).catch(() => {});
}

export async function cancelSyntheticImageDownload(modelId: string): Promise<void> {
  const runtime = activeMultifileDownloads.get(modelId);
  if (!runtime) return;
  runtime.cancelled = true;
  // Drop a part still waiting for a slot NOW — it has no native downloadId yet, so
  // cancelDownload can't reach it (else it promotes, briefly starts, then cancels).
  // The queue key is the part's modelId param, == makeImageModelKey(modelId).
  backgroundDownloadService.cancelQueued(makeImageModelKey(modelId));
  if (runtime.currentDownloadId) {
    await backgroundDownloadService.cancelDownload(runtime.currentDownloadId).catch(() => {});
  }
}

async function ensureDirectory(path: string): Promise<void> {
  if (!(await RNFS.exists(path))) await RNFS.mkdir(path);
}

async function cleanupImageModelDir(modelId: string): Promise<void> {
  try {
    const dir = `${modelManager.getImageModelsDirectory()}/${modelId}`;
    if (await RNFS.exists(dir)) await RNFS.unlink(dir);
  } catch {
    /* ignore cleanup errors */
  }
}

function setMultifileFailed(syntheticId: string, deps: ImageDownloadDeps, message?: string): void {
  deps.setAlertState(showAlert('Download Failed', getUserFacingDownloadMessage(message)));
  useDownloadStore.getState().setStatus(syntheticId, 'failed', {
    message: message || 'Multi-file download failed',
  });
}

type MultifileDownloadSpec = {
  relativePath: string;
  size: number;
  url: string;
};

async function downloadSequentialFiles(opts: {
  modelInfo: ImageModelDescriptor;
  runtime: MultifileRuntime;
  syntheticId: string;
  modelDir: string;
  files: MultifileDownloadSpec[];
}): Promise<void> {
  const { modelInfo, runtime, syntheticId, modelDir, files } = opts;
  const totalSize = files.reduce((sum, file) => sum + file.size, 0);
  let downloadedSize = 0;

  for (const file of files) {
    assertNotCancelled(modelInfo.id, runtime);
    const filePath = `${modelDir}/${file.relativePath}`;
    const fileDir = filePath.substring(0, filePath.lastIndexOf('/'));
    await ensureDirectory(fileDir);

    const tempFileName = `${modelInfo.id}_${file.relativePath.replaceAll('/', '_')}`;
    const capturedDownloadedSize = downloadedSize;
    const { downloadIdPromise, promise } = backgroundDownloadService.downloadFileTo({
      params: { url: file.url, fileName: tempFileName, modelId: `image:${modelInfo.id}`, modelType: 'image', totalBytes: file.size },
      destPath: filePath,
      onProgress: (bytesDownloaded) => {
        if (runtime.cancelled) return;
        const totalDownloaded = capturedDownloadedSize + bytesDownloaded;
        useDownloadStore.getState().updateProgress(syntheticId, totalDownloaded, totalSize);
      },
    });
    wireCurrentDownloadPromise(downloadIdPromise, runtime);
    await promise;
    runtime.currentDownloadId = undefined;
    downloadedSize += file.size;
    useDownloadStore.getState().updateProgress(syntheticId, downloadedSize, totalSize);
  }
}

/** Verify every part is present and non-empty before registering — a download can
 *  resolve "successfully" yet write a 0-byte file (200 with no body). Existence +
 *  non-empty only (NOT exact size: descriptor sizes drift from real bytes). Throws so
 *  the caller's catch fails it (retry-able) instead of registering garbage. */
async function validateMultifileComplete(modelDir: string, files: MultifileDownloadSpec[]): Promise<void> {
  for (const file of files) {
    const filePath = `${modelDir}/${file.relativePath}`;
    const stat = await RNFS.stat(filePath).catch(() => null);
    const size = stat ? (typeof stat.size === 'string' ? Number.parseInt(stat.size, 10) : stat.size) : -1;
    if (size <= 0) throw new Error(`Downloaded file missing or empty: ${file.relativePath} — tap retry`);
  }
}

/** Remove the entry from the store. Use after register-and-notify or on error. */
function removeStoreEntry(modelId: string) {
  useDownloadStore.getState().remove(makeImageModelKey(modelId));
}

/** Build the registerable ONNXImageModel — one definition so the zip / on-disk /
 *  multifile branches can't drift. */
function buildImageModel(modelInfo: ImageModelDescriptor, modelPath: string): ONNXImageModel {
  return {
    id: modelInfo.id, name: modelInfo.name, description: modelInfo.description,
    modelPath, downloadedAt: new Date().toISOString(), size: modelInfo.size,
    style: modelInfo.style, backend: modelInfo.backend, attentionVariant: modelInfo.attentionVariant,
  };
}

/** Register a downloaded image model, activate if first, then cleanup + alert. */
export async function registerAndNotify(
  deps: ImageDownloadDeps,
  opts: { imageModel: ONNXImageModel; modelName: string },
) {
  const { imageModel, modelName } = opts;
  await modelManager.addDownloadedImageModel(imageModel);
  deps.addDownloadedImageModel(imageModel);
  // Auto-load the first image model unless onboarding is still active (Step 13 needs
  // activeImageModelId null so the "Load your image model" spotlight fires on Home).
  if (!deps.activeImageModelId && deps.triedImageGen) deps.setActiveImageModelId(imageModel.id);
  removeStoreEntry(imageModel.id);
  deps.setAlertState(showAlert('Success', `${modelName} downloaded successfully!`));
}

/** Add (or refuse-add) an image entry to the store. Returns true if a new entry was created. */
function addImageEntry(opts: {
  modelId: string;
  downloadId: string;
  fileName: string;
  totalBytes: number;
  metadata: ImageMetadata;
}): boolean {
  const { modelId, downloadId, fileName, totalBytes, metadata } = opts;
  const modelKey = makeImageModelKey(modelId);
  const existing = useDownloadStore.getState().downloads[modelKey];
  if (existing && isActiveStatus(existing.status)) return false;
  if (existing) {
    // Failed/etc. entry from a prior attempt - reuse logical record.
    useDownloadStore.getState().retryEntry(modelKey, downloadId);
    return true;
  }
  useDownloadStore.getState().add({
    modelKey,
    downloadId,
    modelId: `image:${modelId}`,
    fileName,
    quantization: '',
    modelType: 'image',
    status: 'pending',
    bytesDownloaded: 0,
    totalBytes,
    combinedTotalBytes: totalBytes,
    progress: 0,
    createdAt: Date.now(),
    metadataJson: JSON.stringify(metadata),
  });
  return true;
}

/** Wire complete + error listeners for a zip-style download. */
function wireZipListeners(
  ctx: { downloadId: string; modelId: string; deps: ImageDownloadDeps },
  onCompleteWork: () => Promise<void>,
) {
  const { downloadId, deps } = ctx;
  const unsubComplete = backgroundDownloadService.onComplete(downloadId, async () => {
    unsubComplete(); unsubError();
    try { await onCompleteWork(); } catch (e: any) {
      deps.setAlertState(showAlert('Download Failed', getUserFacingDownloadMessage(e?.message || 'Failed to process model')));
      useDownloadStore.getState().setStatus(downloadId, 'failed', { message: e?.message || 'Failed to process model' });
    }
  });
  const unsubError = backgroundDownloadService.onError(downloadId, (ev) => {
    unsubComplete(); unsubError();
    deps.setAlertState(showAlert('Download Failed', getUserFacingDownloadMessage(ev.reason)));
    // useDownloads at app root has already routed this to setStatus('failed').
    // Keep the entry visible so the user can retry/remove. No removeStoreEntry here.
  });
}

/** HuggingFace multi-file download. Each file goes through downloadFileTo sequentially. */
export async function downloadHuggingFaceModel(
  modelInfo: ImageModelDescriptor,
  deps: ImageDownloadDeps,
): Promise<void> {
  if (!modelInfo.huggingFaceRepo || !modelInfo.huggingFaceFiles) {
    deps.setAlertState(showAlert('Error', 'Invalid HuggingFace model configuration'));
    return;
  }
  const syntheticId = makeMultifileId(modelInfo.id);
  const created = addImageEntry({
    modelId: modelInfo.id,
    downloadId: syntheticId,
    fileName: modelInfo.id,
    totalBytes: modelInfo.size,
    metadata: {
      imageDownloadType: 'multifile',
      imageModelName: modelInfo.name,
      imageModelDescription: modelInfo.description,
      imageModelSize: modelInfo.size,
      imageModelStyle: modelInfo.style,
      imageModelBackend: modelInfo.backend,
      imageModelRepo: modelInfo.huggingFaceRepo,
      imageModelHuggingFaceFiles: modelInfo.huggingFaceFiles,
    },
  });
  if (!created) return;
  const runtime = startMultifileRuntime(modelInfo.id);
  try {
    const imageModelsDir = modelManager.getImageModelsDirectory();
    const modelDir = `${imageModelsDir}/${modelInfo.id}`;
    await ensureDirectory(imageModelsDir);
    await ensureDirectory(modelDir);

    const files = modelInfo.huggingFaceFiles.map((file) => ({
      relativePath: file.path,
      size: file.size,
      url: `https://huggingface.co/${modelInfo.huggingFaceRepo}/resolve/main/${file.path}`,
    }));
    await downloadSequentialFiles({ modelInfo, runtime, syntheticId, modelDir, files });
    assertNotCancelled(modelInfo.id, runtime);
    await validateMultifileComplete(modelDir, files); // reject a silently-truncated part before registering
    useDownloadStore.getState().setProcessing(syntheticId);
    assertNotCancelled(modelInfo.id, runtime);
    await RNFS.writeFile(`${modelDir}/_ready`, '', 'utf8').catch(() => {});
    await registerAndNotify(deps, { imageModel: buildImageModel(modelInfo, modelDir), modelName: modelInfo.name });
  } catch (error: any) {
    if (isCancelledError(error)) {
      await cleanupImageModelDir(modelInfo.id);
      return;
    }
    setMultifileFailed(syntheticId, deps, error?.message);
    await cleanupImageModelDir(modelInfo.id);
  } finally {
    clearMultifileRuntime(modelInfo.id);
  }
}

/** CoreML multi-file download (one file per blob in coremlFiles). */
export async function downloadCoreMLMultiFile(
  modelInfo: ImageModelDescriptor,
  deps: ImageDownloadDeps,
): Promise<void> {
  if (!modelInfo.coremlFiles || modelInfo.coremlFiles.length === 0) return;

  const syntheticId = makeMultifileId(modelInfo.id);
  const created = addImageEntry({
    modelId: modelInfo.id,
    downloadId: syntheticId,
    fileName: modelInfo.id,
    totalBytes: modelInfo.size,
    metadata: {
      imageDownloadType: 'multifile',
      imageModelName: modelInfo.name,
      imageModelDescription: modelInfo.description,
      imageModelSize: modelInfo.size,
      imageModelStyle: modelInfo.style,
      imageModelBackend: modelInfo.backend,
      imageModelRepo: modelInfo.repo,
      imageModelAttentionVariant: modelInfo.attentionVariant,
      imageModelCoremlFiles: modelInfo.coremlFiles,
    },
  });
  if (!created) return;
  const runtime = startMultifileRuntime(modelInfo.id);

  try {
    const imageModelsDir = modelManager.getImageModelsDirectory();
    const modelDir = `${imageModelsDir}/${modelInfo.id}`;
    await ensureDirectory(imageModelsDir);
    await ensureDirectory(modelDir);

    const files = modelInfo.coremlFiles.map(f => ({ relativePath: f.relativePath, size: f.size, url: f.downloadUrl }));
    await downloadSequentialFiles({ modelInfo, runtime, syntheticId, modelDir, files });
    assertNotCancelled(modelInfo.id, runtime);
    await validateMultifileComplete(modelDir, files); // reject a silently-truncated part before registering
    useDownloadStore.getState().setProcessing(syntheticId);
    assertNotCancelled(modelInfo.id, runtime);
    await RNFS.writeFile(`${modelDir}/_ready`, '', 'utf8').catch(() => {});
    const resolvedModelDir = await resolveCoreMLModelDir(modelDir);
    await registerAndNotify(deps, { imageModel: buildImageModel(modelInfo, resolvedModelDir), modelName: modelInfo.name });
    if (modelInfo.repo) downloadCoreMLTokenizerFiles(resolvedModelDir, modelInfo.repo).catch(() => {});
  } catch (error: any) {
    await cleanupImageModelDir(modelInfo.id);
    if (isCancelledError(error)) return;
    deps.setAlertState(showAlert('Download Failed', getUserFacingDownloadMessage(error?.message)));
    useDownloadStore.getState().setStatus(syntheticId, 'failed', {
      message: error?.message || 'CoreML download failed',
    });
  } finally {
    clearMultifileRuntime(modelInfo.id);
  }
}

export async function proceedWithDownload(
  modelInfo: ImageModelDescriptor,
  deps: ImageDownloadDeps,
): Promise<void> {
  deps.setAlertState({ ...showAlert('Download Started', 'Keep app open while image model processes'), closeLabel: '' });
  if (modelInfo.huggingFaceRepo && modelInfo.huggingFaceFiles) {
    await downloadHuggingFaceModel(modelInfo, deps);
    return;
  }
  if (modelInfo.coremlFiles && modelInfo.coremlFiles.length > 0) {
    await downloadCoreMLMultiFile(modelInfo, deps);
    return;
  }

  // Zip flow: native WorkManager handles the download; useDownloads at app root routes
  // progress/error to the store. We only wire completion to run zip-extract finalization.
  const fileName = `${modelInfo.id}.zip`;
  const metadata: ImageMetadata = {
    imageDownloadType: 'zip',
    imageModelName: modelInfo.name,
    imageModelDescription: modelInfo.description,
    imageModelSize: modelInfo.size,
    imageModelStyle: modelInfo.style,
    imageModelBackend: modelInfo.backend,
    imageModelAttentionVariant: modelInfo.attentionVariant,
    imageModelDownloadUrl: modelInfo.downloadUrl,
  };
  const modelKey = makeImageModelKey(modelInfo.id);
  const existing = useDownloadStore.getState().downloads[modelKey];
  if (existing && isActiveStatus(existing.status)) return;

  // Guard: if files already exist on disk, register without re-downloading.
  const imageModelsDir = modelManager.getImageModelsDirectory();
  const modelDir = `${imageModelsDir}/${modelInfo.id}`;
  if (await RNFS.exists(modelDir)) {
    const resolvedModelDir = modelInfo.backend === 'coreml' ? await resolveCoreMLModelDir(modelDir) : modelDir;
    logger.log(`[ImageDownload] proceedWithDownload zip - files exist on disk, registering directly modelId=${modelInfo.id}`);
    await registerAndNotify(deps, { imageModel: buildImageModel(modelInfo, resolvedModelDir), modelName: modelInfo.name });
    return;
  }

  // Publish a QUEUED row IMMEDIATELY, before awaiting the (slot-limited) native start —
  // same pattern startModelDownload uses for text. Without it a queued image download had
  // no store entry until a slot freed, so ImageModelsTab's card (reading the store by
  // makeImageModelKey) showed the plain arrow while the Download Manager listed it queued.
  const placeholderId = `queued:${modelKey}`; // reconciled to the real id on start
  const created = addImageEntry({
    modelId: modelInfo.id,
    downloadId: placeholderId,
    fileName,
    totalBytes: modelInfo.size,
    metadata,
  });
  if (!created) return; // an active entry already owns this key (coalesced double-tap)
  try {
    const downloadInfo = await backgroundDownloadService.startDownload({
      url: modelInfo.downloadUrl, fileName, modelId: `image:${modelInfo.id}`,
      modelKey,
      modelType: 'image',
      totalBytes: modelInfo.size,
      metadataJson: JSON.stringify(metadata),
    });
    // Reconcile the queued placeholder row to the real native downloadId so progress /
    // complete / error events (routed via downloadIdIndex) reach this entry.
    useDownloadStore.getState().retryEntry(modelKey, downloadInfo.downloadId);
    wireZipListeners({ downloadId: downloadInfo.downloadId, modelId: modelInfo.id, deps }, async () => {
      const zipPath = `${imageModelsDir}/${fileName}`;
      try {
        useDownloadStore.getState().setProcessing(downloadInfo.downloadId);
        if (!(await RNFS.exists(imageModelsDir))) await RNFS.mkdir(imageModelsDir);
        const t0 = Date.now();
        await backgroundDownloadService.moveCompletedDownload(downloadInfo.downloadId, zipPath);
        logger.log(`[ImageDownload] moveCompletedDownload took ${Date.now() - t0}ms modelId=${modelInfo.id}`);
        if (!(await RNFS.exists(modelDir))) await RNFS.mkdir(modelDir);
        await RNFS.writeFile(`${modelDir}/_zip_name`, fileName, 'utf8').catch(() => {});
        const t1 = Date.now();
        await unzip(zipPath, modelDir);
        logger.log(`[ImageDownload] unzip took ${Date.now() - t1}ms modelId=${modelInfo.id}`);
        const resolvedModelDir = modelInfo.backend === 'coreml' ? await resolveCoreMLModelDir(modelDir) : modelDir;
        await RNFS.writeFile(`${modelDir}/_ready`, '', 'utf8').catch(() => {});
        await RNFS.unlink(zipPath).catch(() => {});
        await registerAndNotify(deps, { imageModel: buildImageModel(modelInfo, resolvedModelDir), modelName: modelInfo.name });
      } catch (e) {
        await RNFS.unlink(zipPath).catch(() => {});
        await RNFS.unlink(modelDir).catch(() => {});
        throw e;
      }
    });
    backgroundDownloadService.startProgressPolling();
  } catch (error: any) {
    // Cancelled while still queued (no slot) rejects with `.cancelled` — a user
    // cancellation, not a failure: drop the placeholder row quietly.
    if (isCancelledError(error)) {
      removeStoreEntry(modelInfo.id);
      return;
    }
    // Native start failed: fail the placeholder row so the card/Manager offer retry.
    useDownloadStore.getState().setStatus(placeholderId, 'failed', { message: error?.message || 'Download failed' });
    deps.setAlertState(showAlert('Download Failed', getUserFacingDownloadMessage(error?.message)));
  }
}

export async function handleDownloadImageModel(
  modelInfo: ImageModelDescriptor,
  deps: ImageDownloadDeps,
): Promise<void> {
  if (modelInfo.backend === 'qnn' && Platform.OS === 'android') {
    const socInfo = await hardwareService.getSoCInfo();
    const warningMessage = getQnnWarningMessage(modelInfo, socInfo);
    if (warningMessage) {
      showQnnWarningAlert({
        warningMessage,
        hasNPU: socInfo.hasNPU,
        modelInfo,
        onDownloadAnyway: () => {
          proceedWithDownload(modelInfo, deps).catch(() => {});
        },
      }, deps);
      return;
    }
  }
  await proceedWithDownload(modelInfo, deps);
}

