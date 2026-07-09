/* eslint-disable max-lines */
import RNFS from 'react-native-fs';
import { ModelFile, BackgroundDownloadInfo } from '../../types';
import { huggingFaceService } from '../huggingface';
import { backgroundDownloadService } from '../backgroundDownloadService';
import {
  DownloadProgressCallback,
  DownloadCompleteCallback,
  DownloadErrorCallback,
  BackgroundDownloadMetadataCallback,
  BackgroundDownloadContext,
} from './types';
import { buildDownloadedModel, persistDownloadedModel, loadDownloadedModels, saveModelsList } from './storage';
import logger from '../../utils/logger';
import { useDownloadStore } from '../../stores/downloadStore';
import { makeModelKey } from '../../utils/modelKey';
import { extractBaseName } from './scan';

export function mmProjLocalName(ggufFileName: string): string {
  return `${ggufFileName.replace(/\.gguf$/i, '')}-mmproj.gguf`;
}

export interface MmProjRepairDownloadOpts {
  modelId: string;
  file: ModelFile;
  modelsDir: string;
  onProgress?: DownloadProgressCallback;
  onDownloadIdReady?: (id: string) => void;
}

/**
 * Re-download a model's mmproj (vision projector) sidecar, routing progress through
 * the SAME download-store rows the normal download writes so the existing determinate
 * progress bar lights up during the ~900MB fetch instead of an indeterminate spinner
 * (BUG OD2). The store row is keyed on the model's modelKey (`repo/file`) — the id the
 * completed model carries — and torn down once the repair settles. Returns the local
 * path the mmproj resolved to.
 */
export async function performMmProjRepairDownload(opts: MmProjRepairDownloadOpts): Promise<string> {
  const { modelId, file, modelsDir, onProgress, onDownloadIdReady } = opts;
  const mmProjFile = file.mmProjFile;
  if (!mmProjFile) throw new Error('Model file has no associated mmproj');

  const modelKey = makeModelKey(modelId, file.name);
  const mmProjFileName = `${extractBaseName(file.name)}-${mmProjFile.name}`;
  const mmProjLocalPath = `${modelsDir}/${mmProjFileName}`;
  const totalBytes = mmProjFile.size;
  if (await RNFS.exists(mmProjLocalPath)) await RNFS.unlink(mmProjLocalPath).catch(() => {});

  const info = await backgroundDownloadService.startDownload({
    url: mmProjFile.downloadUrl,
    fileName: mmProjFile.name,
    modelId,
    totalBytes,
  });
  onDownloadIdReady?.(info.downloadId);

  useDownloadStore.getState().add({
    modelKey,
    downloadId: info.downloadId,
    modelId,
    fileName: mmProjFile.name,
    quantization: file.quantization ?? '',
    modelType: 'text',
    status: 'running',
    bytesDownloaded: 0,
    totalBytes,
    combinedTotalBytes: totalBytes,
    progress: 0,
    createdAt: Date.now(),
  });

  let resolvedPath = mmProjLocalPath;
  try {
    await new Promise<void>((resolve, reject) => {
      const removeProgress = backgroundDownloadService.onProgress(info.downloadId, (event) => {
        useDownloadStore.getState().updateProgress(info.downloadId, event.bytesDownloaded, totalBytes);
        onProgress?.({
          downloadId: info.downloadId,
          modelId,
          fileName: mmProjFile.name,
          bytesDownloaded: event.bytesDownloaded,
          totalBytes,
          progress: totalBytes > 0 ? event.bytesDownloaded / totalBytes : 0,
        });
      });
      const removeComplete = backgroundDownloadService.onComplete(info.downloadId, async (event) => {
        removeProgress(); removeComplete(); removeError();
        try {
          resolvedPath = await backgroundDownloadService.moveCompletedDownload(info.downloadId, mmProjLocalPath);
        } catch {
          resolvedPath = event.localUri?.replace('file://', '') || mmProjLocalPath;
        }
        useDownloadStore.getState().setCompleted(info.downloadId);
        resolve();
      });
      const removeError = backgroundDownloadService.onError(info.downloadId, (err) => {
        removeProgress(); removeComplete(); removeError();
        useDownloadStore.getState().setStatus(info.downloadId, 'failed', { message: err.reason || 'Download failed' });
        reject(new Error(err.reason || 'Download failed'));
      });
      backgroundDownloadService.startProgressPolling();
    });
    return resolvedPath;
  } finally {
    // The repair row is transient — remove it once settled so the completed model
    // (rebuilt via loadDownloadedModels) is the only surviving row.
    useDownloadStore.getState().remove(modelKey);
  }
}

function makeAlreadyDownloadedId(modelId: string, fileName: string): string {
  return `already-downloaded:${makeModelKey(modelId, fileName)}`;
}

export {
  getOrphanedTextFiles,
  getOrphanedImageDirs,
  syncCompletedBackgroundDownloads,
} from './downloadHelpers';
export type { SyncDownloadsOpts } from './downloadHelpers';

export interface PerformBackgroundDownloadOpts {
  modelId: string;
  file: ModelFile;
  modelsDir: string;
  backgroundDownloadContext: Map<string, BackgroundDownloadContext>;
  backgroundDownloadMetadataCallback: BackgroundDownloadMetadataCallback | null;
  onProgress?: DownloadProgressCallback;
}

export async function performBackgroundDownload(opts: PerformBackgroundDownloadOpts): Promise<BackgroundDownloadInfo> {
  const { modelId, file, modelsDir, backgroundDownloadContext, backgroundDownloadMetadataCallback, onProgress } = opts;
  const localPath = `${modelsDir}/${file.name}`;
  const mmProjLocalPath = file.mmProjFile
    ? `${modelsDir}/${mmProjLocalName(file.name)}`
    : null;

  const mainExists = await RNFS.exists(localPath);
  const mmProjExists = await checkMmProjExists(mmProjLocalPath, file.mmProjFile?.size);

  if (mainExists && mmProjExists) {
    return handleAlreadyDownloaded({ modelId, file, localPath, mmProjLocalPath, backgroundDownloadContext });
  }

  return startBgDownload({
    modelId, file, localPath, mmProjLocalPath, mmProjExists,
    modelsDir, backgroundDownloadContext, backgroundDownloadMetadataCallback, onProgress,
  });
}

async function checkMmProjExists(path: string | null, expectedSize?: number): Promise<boolean> {
  if (!path) return true;
  const exists = await RNFS.exists(path);
  if (!exists || !expectedSize) return exists;
  try {
    const stat = await RNFS.stat(path);
    const actualSize = typeof stat.size === 'string' ? Number.parseInt(stat.size, 10) : stat.size;
    if (actualSize < expectedSize) {
      logger.warn(`[ModelManager] mmproj partial (${actualSize}/${expectedSize}), re-downloading`);
      await RNFS.unlink(path).catch(() => {});
      return false;
    }
    return true;
  } catch {
    await RNFS.unlink(path).catch(() => {});
    return false;
  }
}

interface AlreadyDownloadedOpts {
  modelId: string;
  file: ModelFile;
  localPath: string;
  mmProjLocalPath: string | null;
  backgroundDownloadContext: Map<string, BackgroundDownloadContext>;
}

async function handleAlreadyDownloaded(opts: AlreadyDownloadedOpts): Promise<BackgroundDownloadInfo> {
  const { modelId, file, localPath, mmProjLocalPath, backgroundDownloadContext } = opts;
  const model = await buildDownloadedModel({ modelId, file, resolvedLocalPath: localPath, mmProjPath: mmProjLocalPath || undefined });
  const totalBytes = file.size + (file.mmProjFile?.size || 0);
  const downloadId = makeAlreadyDownloadedId(modelId, file.name);
  const completedInfo: BackgroundDownloadInfo = {
    downloadId, fileName: file.name, modelId, status: 'completed',
    bytesDownloaded: totalBytes, totalBytes, startedAt: Date.now(),
  };
  backgroundDownloadContext.set(downloadId, { model, error: null });
  return completedInfo;
}

interface StartBgDownloadOpts {
  modelId: string;
  file: ModelFile;
  localPath: string;
  mmProjLocalPath: string | null;
  mmProjExists: boolean;
  modelsDir: string;
  backgroundDownloadContext: Map<string, BackgroundDownloadContext>;
  backgroundDownloadMetadataCallback: BackgroundDownloadMetadataCallback | null;
  onProgress?: DownloadProgressCallback;
}

async function startBgDownload(opts: StartBgDownloadOpts): Promise<BackgroundDownloadInfo> {
  const { modelId, file, localPath, mmProjLocalPath, mmProjExists, backgroundDownloadContext, backgroundDownloadMetadataCallback, onProgress } = opts;

  const mmProjSize = file.mmProjFile?.size || 0;
  const combinedTotalBytes = file.size + mmProjSize;
  const downloadUrl = file.downloadUrl || huggingFaceService.getDownloadUrl(modelId, file.name);
  const author = modelId.split('/')[0] || 'Unknown';
  const modelKey = makeModelKey(modelId, file.name);

  const needsMmProj = !!(file.mmProjFile && mmProjLocalPath && !mmProjExists);
  const skipSizeValidation = modelId.startsWith('offgrid/');
  const metadataObj: Record<string, unknown> = {};
  if (needsMmProj) {
    metadataObj.mmProjFileName = mmProjLocalName(file.name);
    metadataObj.mmProjDownloadUrl = file.mmProjFile?.downloadUrl;
  }
  if (skipSizeValidation) metadataObj.skipSizeValidation = true;
  const metadataJson = Object.keys(metadataObj).length > 0 ? JSON.stringify(metadataObj) : undefined;

  // Start the mmproj sidecar BEFORE the main, so the MAIN is the last download started
  // before we return and the caller attaches watchDownload. Otherwise, under the 3-cap,
  // the main starts, then this function blocks awaiting the sidecar's *queued* start —
  // during that (possibly minutes-long) wait the main can complete and fire its one
  // DownloadComplete with no listener attached yet (lost → finalize hangs at 100%). With
  // the sidecar first, nothing long is awaited after the main starts, so the watcher is
  // live before the main can complete (the reconcile then covers the microtask gap).
  let mmProjDownloadId: string | undefined;
  if (needsMmProj) {
    const mmProjFile = file.mmProjFile!;
    logger.log('[DownloadDebug] Starting mmproj sidecar download', {
      modelKey, modelId, fileName: file.name,
      mmProjFileName: mmProjLocalName(file.name), mmProjBytes: mmProjFile.size,
    });
    const mmProjInfo = await backgroundDownloadService.startDownload({
      url: mmProjFile.downloadUrl,
      fileName: mmProjLocalName(file.name),
      modelId,
      modelType: 'text',
      totalBytes: mmProjFile.size,
      sha256: mmProjFile.sha256,
      // Dependent sub-download of the main GGUF — doesn't occupy a concurrency slot, so a
      // vision file's main+mmproj count as ONE logical download against the 3-cap (else
      // one vision file held two slots and only one file could download at a time).
      isSidecar: true,
    });
    mmProjDownloadId = mmProjInfo.downloadId;
    logger.log('[DownloadDebug] mmproj sidecar download started', {
      modelKey, modelId, fileName: file.name, mmProjDownloadId,
    });
  }

  const downloadInfo = await backgroundDownloadService.startDownload({
    url: downloadUrl,
    fileName: file.name,
    modelId,
    modelKey,
    modelType: 'text',
    quantization: file.quantization,
    combinedTotalBytes,
    totalBytes: file.size,
    sha256: file.sha256,
    metadataJson,
  });
  logger.log('[DownloadDebug] Main download started', {
    modelKey,
    modelId,
    fileName: file.name,
    mainDownloadId: downloadInfo.downloadId,
    mmProjDownloadId,
    totalBytes: file.size,
    combinedTotalBytes,
    needsMmProj,
    mmProjLocalPath,
  });

  const existing = useDownloadStore.getState().downloads[modelKey];
  if (existing) {
    // A `queued:<modelKey>` placeholder row (added by startModelDownload to show the
    // queued state immediately) has NO native download behind it — cancelling it would
    // wrongly free a concurrency slot. Only cancel real native ids; then reconcile the
    // row to the real downloadId either way.
    const isPlaceholder = String(existing.downloadId).startsWith('queued:');
    if (!isPlaceholder) {
      await backgroundDownloadService.cancelDownload(existing.downloadId).catch(() => {});
      if (existing.mmProjDownloadId) {
        await backgroundDownloadService.cancelDownload(existing.mmProjDownloadId).catch(() => {});
      }
    }
    useDownloadStore.getState().retryEntry(modelKey, downloadInfo.downloadId);
  } else {
    useDownloadStore.getState().add({
      modelKey,
      downloadId: downloadInfo.downloadId,
      modelId,
      fileName: file.name,
      quantization: file.quantization,
      modelType: 'text',
      status: 'pending',
      bytesDownloaded: 0,
      totalBytes: file.size,
      combinedTotalBytes,
      progress: 0,
      createdAt: Date.now(),
      ...(needsMmProj && {
        mmProjFileName: mmProjLocalName(file.name),
        mmProjFileSize: file.mmProjFile?.size,
      }),
    });
  }
  // Record the sidecar id on the (now-present) store row for restore + cancel.
  if (mmProjDownloadId) useDownloadStore.getState().setMmProjDownloadId(modelKey, mmProjDownloadId);

  backgroundDownloadMetadataCallback?.(downloadInfo.downloadId as any, {
    modelId, fileName: file.name, quantization: file.quantization, author,
    totalBytes: combinedTotalBytes, mainFileSize: file.size,
    mmProjFileName: mmProjLocalPath ? mmProjLocalPath.split('/').pop() : file.mmProjFile?.name, mmProjFileSize: mmProjSize,
    mmProjLocalPath, mmProjDownloadId: mmProjDownloadId as any,
  });

  // Combined progress tracking
  let mainBytesDownloaded = 0;
  let mmProjBytesDownloaded = mmProjExists ? mmProjSize : 0;
  const mmProjFileName = file.mmProjFile?.name || '';
  const progressMilestones = [25, 50, 75, 90, 95, 99];
  let lastMainMilestone = -1;
  let lastMmProjMilestone = mmProjExists ? 100 : -1;
  let lastCombinedMilestone = -1;

  const maybeLogMilestone = (
    channel: 'main' | 'mmproj' | 'combined',
    downloadedBytes: number,
    totalBytes: number,
    lastMilestone: number,
    // eslint-disable-next-line max-params
  ): number => {
    if (totalBytes <= 0) return lastMilestone;
    const pct = Math.floor((downloadedBytes / totalBytes) * 100);
    const nextMilestone = progressMilestones.find(m => pct >= m && m > lastMilestone);
    if (nextMilestone == null) return lastMilestone;
    logger.log('[DownloadDebug] Download progress milestone', {
      modelKey,
      modelId,
      fileName: file.name,
      channel,
      milestonePercent: nextMilestone,
      downloadedBytes,
      totalBytes,
      mainDownloadId: downloadInfo.downloadId,
      mmProjDownloadId,
    });
    return nextMilestone;
  };

  const reportProgress = () => {
    const combinedDownloaded = mainBytesDownloaded + mmProjBytesDownloaded;
    lastMainMilestone = maybeLogMilestone('main', mainBytesDownloaded, file.size, lastMainMilestone);
    if (needsMmProj && mmProjSize > 0) {
      lastMmProjMilestone = maybeLogMilestone('mmproj', mmProjBytesDownloaded, mmProjSize, lastMmProjMilestone);
    }
    lastCombinedMilestone = maybeLogMilestone('combined', combinedDownloaded, combinedTotalBytes, lastCombinedMilestone);

    // Update Android notification with combined progress for vision models
    if (needsMmProj && mmProjDownloadId) {
      try {
        const { DownloadManagerModule } = require('react-native').NativeModules as {
          DownloadManagerModule?: {
            updateCombinedProgress?: (
              modelId: string,
              fileName: string,
              mmProjFileName: string,
              mainBytesDownloaded: number,
              mainTotalBytes: number,
              mmProjBytesDownloaded: number,
              mmProjTotalBytes: number,
            ) => void;
          };
        };
        if (typeof DownloadManagerModule?.updateCombinedProgress === 'function') {
          DownloadManagerModule.updateCombinedProgress(
            modelId,
            file.name,
            mmProjFileName,
            mainBytesDownloaded,
            file.size,
            mmProjBytesDownloaded,
            mmProjSize,
          );
        }
      } catch {
        // Best-effort notification update only.
      }
    }

    onProgress?.({
      downloadId: downloadInfo.downloadId,
      modelId, fileName: file.name, bytesDownloaded: combinedDownloaded,
      totalBytes: combinedTotalBytes,
      progress: combinedTotalBytes > 0 ? combinedDownloaded / combinedTotalBytes : 0,
    });
  };

  const removeProgressListener = backgroundDownloadService.onProgress(
    downloadInfo.downloadId, (event) => {
      mainBytesDownloaded = event.bytesDownloaded; reportProgress();
    },
  );

  let removeMmProjProgressListener: (() => void) | undefined;
  if (mmProjDownloadId) {
    removeMmProjProgressListener = backgroundDownloadService.onProgress(
      mmProjDownloadId, (event) => {
        mmProjBytesDownloaded = event.bytesDownloaded; reportProgress();
      },
    );
  }

  // Cast to any: this context map and all callers are removed in Step 5.
  (backgroundDownloadContext as Map<any, any>).set(downloadInfo.downloadId, {
    modelId, file, localPath, mmProjLocalPath, removeProgressListener,
    mmProjDownloadId, mmProjCompleted: !needsMmProj, mainCompleted: false,
    mainCompleteHandled: false, mmProjCompleteHandled: false, isFinalizing: false,
    removeMmProjProgressListener,
  });

  backgroundDownloadService.startProgressPolling();
  return downloadInfo;
}

export interface WatchDownloadOpts {
  downloadId: string;
  modelsDir: string;
  backgroundDownloadContext: Map<any, any>;
  backgroundDownloadMetadataCallback: BackgroundDownloadMetadataCallback | null;
  onComplete?: DownloadCompleteCallback;
  onError?: DownloadErrorCallback;
}

export function watchBackgroundDownload(opts: WatchDownloadOpts): void {
  const { downloadId, modelsDir, backgroundDownloadContext, backgroundDownloadMetadataCallback, onComplete, onError } = opts;
  const ctx = backgroundDownloadContext.get(downloadId);
  const isAlreadyDownloaded = typeof downloadId === 'string' && downloadId.startsWith('already-downloaded:');

  if (isAlreadyDownloaded && ctx && 'model' in ctx) {
    backgroundDownloadContext.delete(downloadId);
    if (ctx.model) {
      // File is on disk but persistDownloadedModel may not have run (e.g. app
      // killed mid-finalization). Always persist before calling onComplete so the
      // model survives restart and delete works correctly.
      persistDownloadedModel(ctx.model, modelsDir)
        .then(() => onComplete?.(ctx.model!))
        .catch(() => onComplete?.(ctx.model!));
    } else if (ctx.error) {
      onError?.(ctx.error);
    }
    return;
  }

  if (!ctx || !('file' in ctx)) return;
  logger.log('[DownloadDebug] watchDownload attached', {
    downloadId,
    modelId: ctx.modelId,
    fileName: ctx.file.name,
    mmProjDownloadId: ctx.mmProjDownloadId,
    mmProjLocalPath: ctx.mmProjLocalPath,
    mainCompleted: ctx.mainCompleted,
    mmProjCompleted: ctx.mmProjCompleted,
  });

  let removeMmProjComplete: (() => void) | undefined;
  let removeMmProjError: (() => void) | undefined;
  let loggedMainWait = false;
  let loggedMmProjWait = false;

  const cleanupListeners = () => {
    ctx.removeProgressListener();
    ctx.removeMmProjProgressListener?.();
    removeMainComplete();
    removeMainError();
    removeMmProjComplete?.();
    removeMmProjError?.();
  };

  const handleError = (error: Error) => {
    // Do NOT cancel the mmproj sidecar here. Cancelling it puts the native
    // worker into 'cancelled' state, which retryDownload() refuses to act on
    // ("Download is not in a failed state"). This caused a deadlock: the retried
    // main GGUF could complete but ctx.mmProjCompleted was never set (the sidecar
    // was stuck in cancelled and its onComplete never fired), so tryFinalize
    // waited forever. The model only finalised on the next foreground restore
    // scan — without vision because the partial mmproj temp file had been cleaned
    // up. Each download now manages its own lifecycle: if the network drops, the
    // sidecar fails independently and lands in 'failed' state, which retryDownload
    // handles correctly.
    logger.error('[DownloadDebug] Main download failed', {
      downloadId,
      modelId: ctx.modelId,
      fileName: ctx.file.name,
      mmProjDownloadId: ctx.mmProjDownloadId,
      mmProjStatus: useDownloadStore.getState().downloads[
        useDownloadStore.getState().downloadIdIndex[downloadId] ?? ''
      ]?.mmProjStatus,
      error: error.message,
    });
    cleanupListeners();
    // Preserve the context so reattachRetriedTextDownload can reuse it on manual
    // retry — deleting it here caused watchBackgroundDownload to return early
    // (ctx === null) and finalization to never run after retry.
    // Reset only the main-download flags; mmproj state is left as-is and
    // restored separately via resetMmProjForRetry when the sidecar is retried.
    ctx.mainCompleted = false;
    ctx.mainCompleteHandled = false;
    ctx.isFinalizing = false;
    onError?.(error);
  };

  const tryFinalize = async () => {
    if (!ctx.mainCompleted) {
      if (!loggedMainWait) {
        loggedMainWait = true;
        logger.log('[DownloadDebug] Finalization waiting on main GGUF', {
          downloadId,
          modelId: ctx.modelId,
          fileName: ctx.file.name,
          mmProjDownloadId: ctx.mmProjDownloadId,
        });
      }
      return;
    }
    if (!ctx.mmProjCompleted) {
      if (!loggedMmProjWait) {
        loggedMmProjWait = true;
        logger.log('[DownloadDebug] Finalization waiting on mmproj', {
          downloadId,
          modelId: ctx.modelId,
          fileName: ctx.file.name,
          mmProjDownloadId: ctx.mmProjDownloadId,
        });
      }
      return;
    }
    if (ctx.isFinalizing) {
      logger.log('[DownloadDebug] Finalization already running', {
        downloadId,
        modelId: ctx.modelId,
        fileName: ctx.file.name,
      });
      return;
    }
    ctx.isFinalizing = true;
    logger.log('[DownloadDebug] Finalization started', {
      downloadId,
      modelId: ctx.modelId,
      fileName: ctx.file.name,
      localPath: ctx.localPath,
      mmProjLocalPath: ctx.mmProjLocalPath,
    });
    cleanupListeners();
    backgroundDownloadContext.delete(downloadId);
    try {
      // Idempotent move: a native record can report 'completed' yet reject the move
      // (NOT_COMPLETED / NOT_FOUND) when it was already moved in a PRIOR session — its
      // localUri is cleared but the file is already at ctx.localPath. Restore re-adopts
      // such a record every foreground, so a plain failure here loops forever
      // ("Finalization failed: Download N not completed yet" on every launch). If the
      // final file is already on disk, finalize from it; only a genuinely-absent file is
      // a real failure.
      let movedNatively = true;
      let finalPath: string;
      try {
        finalPath = await backgroundDownloadService.moveCompletedDownload(downloadId, ctx.localPath);
      } catch (moveErr) {
        if (await RNFS.exists(ctx.localPath)) {
          movedNatively = false;
          finalPath = ctx.localPath;
          logger.log('[DownloadDebug] native move rejected but file present — finalizing from disk (idempotent)', {
            downloadId, modelId: ctx.modelId, localPath: ctx.localPath,
            error: moveErr instanceof Error ? moveErr.message : String(moveErr),
          });
        } else {
          throw moveErr;
        }
      }
      const mmProjFileExists = ctx.mmProjLocalPath ? await RNFS.exists(ctx.mmProjLocalPath) : false;
      const finalMmProjPath = ctx.mmProjLocalPath && mmProjFileExists ? ctx.mmProjLocalPath : undefined;
      logger.log('[DownloadDebug] Finalization paths resolved', {
        downloadId,
        modelId: ctx.modelId,
        fileName: ctx.file.name,
        finalPath,
        mmProjLocalPath: ctx.mmProjLocalPath,
        mmProjFileExists,
        finalMmProjPath,
      });

      const model = await buildDownloadedModel({
        modelId: ctx.modelId, file: ctx.file, resolvedLocalPath: finalPath, mmProjPath: finalMmProjPath,
        // If the sidecar download failed, mmProjPath is undefined but we still know
        // the intended filename from the catalog. This sentinel triggers needsVisionRepair
        // without any name-based heuristic so the "Repair Vision" button always appears.
        expectedMmProjFileName: !finalMmProjPath ? ctx.file.mmProjFile?.name : undefined,
      });
      await persistDownloadedModel(model, modelsDir);
      logger.log('[DownloadDebug] Finalization completed', {
        downloadId,
        modelId: ctx.modelId,
        fileName: ctx.file.name,
        finalPath,
        finalMmProjPath,
        savedEngine: model.engine,
        savedLiteRTVision: model.engine === 'litert' ? model.liteRTVision : undefined,
      });
      backgroundDownloadMetadataCallback?.(downloadId, null);
      onComplete?.(model);
      // When we finalized from an already-on-disk file (native move was skipped), the
      // stale native record still lingers as 'completed'-without-localUri and restore
      // would re-adopt + re-finalize it every foreground. Purge it so it can't loop.
      if (!movedNatively) backgroundDownloadService.purgeNativeRecord(downloadId).catch(() => {});
    } catch (error) {
      ctx.isFinalizing = false;
      logger.error('[DownloadDebug] Finalization failed', {
        downloadId,
        modelId: ctx.modelId,
        fileName: ctx.file.name,
        error: error instanceof Error ? error.message : String(error),
      });
      onError?.(error as Error);
    }
  };

  // One completion handler per download, invoked by EITHER the live onComplete event
  // OR the reconcile below — so a completion that fired before we subscribed is never
  // lost (was previously true only for the mmproj; the main could hang at 100%).
  const handleMainComplete = async () => {
    if (ctx.mainCompleteHandled) return;
    ctx.mainCompleteHandled = true;
    ctx.mainCompleted = true;
    logger.log('[DownloadDebug] Main GGUF complete', {
      downloadId,
      modelId: ctx.modelId,
      fileName: ctx.file.name,
      mmProjDownloadId: ctx.mmProjDownloadId,
    });
    await tryFinalize();
  };
  const handleMmProjComplete = async () => {
    if (ctx.mmProjCompleteHandled) return;
    ctx.mmProjCompleteHandled = true;
    logger.log('[DownloadDebug] mmproj complete, moving sidecar file', {
      downloadId,
      modelId: ctx.modelId,
      fileName: ctx.file.name,
      mmProjDownloadId: ctx.mmProjDownloadId,
      mmProjLocalPath: ctx.mmProjLocalPath,
    });
    try {
      await backgroundDownloadService.moveCompletedDownload(ctx.mmProjDownloadId!, ctx.mmProjLocalPath!);
    } catch (moveErr) {
      const targetExists = ctx.mmProjLocalPath ? await RNFS.exists(ctx.mmProjLocalPath) : false;
      if (!targetExists) {
        logger.warn('[ModelManager] mmproj move failed and target not found, continuing without vision:', moveErr);
        ctx.mmProjLocalPath = null;
      }
    }
    ctx.mmProjCompleted = true;
    await tryFinalize();
  };

  const removeMainComplete = backgroundDownloadService.onComplete(downloadId, handleMainComplete);
  const removeMainError = backgroundDownloadService.onError(downloadId, (event) => {
    handleError(new Error(event.reason || 'Download failed'));
  });

  if (ctx.mmProjDownloadId && !ctx.mmProjCompleted) {
    removeMmProjComplete = backgroundDownloadService.onComplete(ctx.mmProjDownloadId, handleMmProjComplete);
    removeMmProjError = backgroundDownloadService.onError(ctx.mmProjDownloadId, (event) => {
      // mmproj failure must NOT fail the parent download. Treat as
      // text-only-with-repair-needed: clear the mmproj path, mark sidecar
      // complete (from the finalizer's perspective) so tryFinalize() can
      // proceed when the main GGUF finishes. Surface the failure to the
      // store so UI shows a "vision broken / repair needed" affordance.
      logger.warn('[ModelManager] mmproj failed, continuing as text-only:', event.reason);
      logger.warn('[DownloadDebug] mmproj failed, switching to text-only fallback', {
        downloadId,
        modelId: ctx.modelId,
        fileName: ctx.file.name,
        mmProjDownloadId: ctx.mmProjDownloadId,
        reason: event.reason,
        reasonCode: event.reasonCode,
      });
      ctx.mmProjLocalPath = null;
      ctx.mmProjCompleted = true;
      // Update the sidecar status in the store before tryFinalize completes
      // and removes the entry; setStatus on a sidecar id only marks
      // mmProjStatus, not the main status (see downloadStore.setStatus).
      if (ctx.mmProjDownloadId) {
        useDownloadStore.getState().setStatus(ctx.mmProjDownloadId, 'failed', {
          message: event.reason || 'Vision projection download failed',
          code: event.reasonCode,
        });
      }
      removeMmProjComplete?.();
      removeMmProjError?.();
      tryFinalize().catch(() => {});
    });
  }

  // Catch-up reconcile: the native service fires onComplete exactly once — if a
  // download already completed before we subscribed (a fast/cached main, or listener
  // setup delayed behind an awaited-queued sidecar), the event is permanently lost and
  // tryFinalize would wait forever (progress stuck at 100%). Query native ONCE and, for
  // whichever of main/mmproj is already 'completed', run its completion handler (the
  // *CompleteHandled flags guard against a double-run if the live event also fires).
  // Covers BOTH downloads via one reconcile — previously only the mmproj had a catch-up.
  backgroundDownloadService.getActiveDownloads().then(async (downloads) => {
    const rows = downloads as Array<{ downloadId: string; status: string }>;
    const isDone = (id?: string) => !!id && rows.find(d => d.downloadId === id)?.status === 'completed';
    if (isDone(downloadId) && !ctx.mainCompleteHandled) {
      logger.log('[DownloadDebug] main catch-up: completed before onComplete listener registered', { downloadId, modelId: ctx.modelId });
      await handleMainComplete();
    }
    if (ctx.mmProjDownloadId && !ctx.mmProjCompleted && isDone(ctx.mmProjDownloadId) && !ctx.mmProjCompleteHandled) {
      logger.log('[DownloadDebug] mmproj catch-up: completed before onComplete listener registered', { downloadId, mmProjDownloadId: ctx.mmProjDownloadId });
      await handleMmProjComplete();
    }
  }).catch(() => {});

  tryFinalize().catch(() => {});
}

export { loadDownloadedModels, saveModelsList };
