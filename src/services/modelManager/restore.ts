import RNFS from 'react-native-fs';
import { PersistedDownloadInfo, ModelFile, BackgroundDownloadInfo } from '../../types';
import { backgroundDownloadService } from '../backgroundDownloadService';
import {
  BackgroundDownloadContext,
  BackgroundDownloadMetadataCallback,
  DownloadProgressCallback,
} from './types';
import logger from '../../utils/logger';
import { mmProjLocalName } from './download';
import { isMmProjFileName } from '../downloadHydration';

export interface RestoreDownloadsOpts {
  modelsDir: string;
  backgroundDownloadContext: Map<string, BackgroundDownloadContext>;
  backgroundDownloadMetadataCallback: BackgroundDownloadMetadataCallback | null;
  onProgress?: DownloadProgressCallback;
  persistedDownloads?: Record<string, PersistedDownloadInfo>;
}

type RestorableDownloadInfo = BackgroundDownloadInfo & {
  combinedTotalBytes?: number;
  mmProjDownloadId?: string;
  quantization?: string;
};

function isRestorable(download: BackgroundDownloadInfo): boolean {
  return download.status === 'running' || download.status === 'pending' || download.status === 'completed';
}

async function resolveMmProjState(
  mmProjDownloadId: string,
  mmProjLocalPath: string | null,
  activeDownloads: BackgroundDownloadInfo[],
): Promise<boolean> {
  const mmProjDownload = activeDownloads.find(d => d.downloadId === mmProjDownloadId);
  logger.log('[DownloadDebug] Restoring mmproj state', {
    mmProjDownloadId,
    mmProjLocalPath,
    nativeStatus: mmProjDownload?.status ?? 'missing',
    bytesDownloaded: mmProjDownload?.bytesDownloaded,
    totalBytes: mmProjDownload?.totalBytes,
  });

  if (mmProjDownload?.status === 'failed') {
    logger.warn('[ModelManager] mmproj download failed while app was dead, vision will not be available');
    return true;
  }

  if (mmProjDownload?.status === 'completed') {
    // Native worker finished but file may not be moved yet. Do NOT call
    // moveCompletedDownload here — that move belongs exclusively to the
    // watchBackgroundDownload onComplete listener. If we move it here AND
    // the listener fires later (duplicate events or replayed events), the
    // second move attempt consumes the stale source and the target exists
    // check may still return false due to timing, leaving mmProjFileExists:false
    // in finalization. Instead, only check whether the file already landed
    // on disk (i.e. a previous onComplete listener already moved it).
    const fileOnDisk = mmProjLocalPath ? await RNFS.exists(mmProjLocalPath) : false;
    if (fileOnDisk) {
      logger.log('[DownloadDebug] mmproj already on disk, marking complete', { mmProjDownloadId, mmProjLocalPath });
      return true;
    }
    // File not on disk yet — native row says completed but the JS onComplete
    // listener hasn't moved it yet. Return false so watchBackgroundDownload
    // registers its onComplete listener and does the move.
    logger.log('[DownloadDebug] mmproj native completed but not on disk yet, deferring to onComplete', { mmProjDownloadId });
    return false;
  }

  if (!mmProjDownload) {
    // No active native row at all. Check disk as the final authority.
    const fileOnDisk = mmProjLocalPath ? await RNFS.exists(mmProjLocalPath) : false;
    if (!fileOnDisk) {
      logger.warn('[ModelManager] mmproj native row missing and file not found, vision will not be available');
    }
    return true; // Either file is there or it is permanently missing — either way, nothing left to wait for.
  }

  return false;
}

function buildFileInfo(metadata: PersistedDownloadInfo): ModelFile {
  const mainFileSize = metadata.mainFileSize ?? metadata.totalBytes;
  const mmProjFileSize = metadata.mmProjFileSize ?? 0;
  return {
    name: metadata.fileName,
    size: mainFileSize,
    quantization: metadata.quantization,
    downloadUrl: '',
    mmProjFile: metadata.mmProjFileName
      ? { name: metadata.mmProjFileName, downloadUrl: '', size: mmProjFileSize }
      : undefined,
  };
}

interface RestoreEntryOpts {
  download: RestorableDownloadInfo;
  metadata: PersistedDownloadInfo;
  modelsDir: string;
  activeDownloads: RestorableDownloadInfo[];
  backgroundDownloadContext: Map<string, BackgroundDownloadContext>;
  backgroundDownloadMetadataCallback: BackgroundDownloadMetadataCallback | null;
  onProgress?: DownloadProgressCallback;
}

function buildMetadataFromActiveDownload(download: RestorableDownloadInfo, modelsDir: string): PersistedDownloadInfo | null {
  // image: (image models) and whisper- (STT models) are owned by their own
  // managers, not the text model manager. Recovering them here registered them
  // as text models, so they showed up under Text in the model selector and the
  // Download Manager's downloaded list.
  if (!download.modelId || download.modelId.startsWith('image:') || download.modelId.startsWith('whisper-')) return null;
  const mainFileSize = download.totalBytes;
  const combinedTotal = download.combinedTotalBytes || download.totalBytes;
  const mmProjFileSize = Math.max(combinedTotal - mainFileSize, 0);
  const hasMmProj = !!download.mmProjDownloadId || mmProjFileSize > 0;

  // Prefer the mmProjFileName stored in the native DB row's metadataJson (written at
  // download-start and survived app kills) over the size-delta heuristic below.
  // This is the most reliable source — the heuristic misses cases where combinedTotal
  // equals mainFileSize (already-complete sidecar counted into the delta calculation).
  let derivedMmProjFileName: string | undefined;
  if (download.metadataJson) {
    try {
      const parsed = JSON.parse(download.metadataJson) as Record<string, unknown>;
      if (typeof parsed.mmProjFileName === 'string' && parsed.mmProjFileName) {
        derivedMmProjFileName = parsed.mmProjFileName;
      }
    } catch { /* non-fatal: fall through to heuristic */ }
  }
  if (!derivedMmProjFileName && hasMmProj) {
    derivedMmProjFileName = mmProjLocalName(download.fileName);
  }

  return {
    modelId: download.modelId,
    fileName: download.fileName,
    quantization: download.quantization || 'Unknown',
    author: download.modelId.split('/')[0] || 'Unknown',
    totalBytes: combinedTotal,
    mainFileSize,
    mmProjFileName: derivedMmProjFileName,
    mmProjFileSize: derivedMmProjFileName ? mmProjFileSize : undefined,
    mmProjLocalPath: derivedMmProjFileName ? `${modelsDir}/${derivedMmProjFileName}` : null,
    mmProjDownloadId: download.mmProjDownloadId,
  };
}

async function restoreDownloadEntry(opts: RestoreEntryOpts): Promise<void> {
  const {
    download, metadata, modelsDir, activeDownloads,
    backgroundDownloadContext, backgroundDownloadMetadataCallback, onProgress,
  } = opts;

  const localPath = `${modelsDir}/${metadata.fileName}`;
  const mmProjLocalPath = metadata.mmProjLocalPath ?? null;
  const mainFileSize = metadata.mainFileSize ?? metadata.totalBytes;
  const mmProjFileSize = metadata.mmProjFileSize ?? 0;
  const combinedTotalBytes = metadata.totalBytes > 0
    ? metadata.totalBytes
    : mainFileSize + mmProjFileSize;
  const mmProjDownloadId = metadata.mmProjDownloadId;
  const fileInfo = buildFileInfo(metadata);

  let mmProjCompleted = !mmProjDownloadId;
  if (mmProjDownloadId) {
    mmProjCompleted = await resolveMmProjState(mmProjDownloadId, mmProjLocalPath, activeDownloads);
  }
  logger.log('[DownloadDebug] Restoring in-progress download entry', {
    downloadId: download.downloadId,
    modelId: metadata.modelId,
    fileName: metadata.fileName,
    status: download.status,
    bytesDownloaded: download.bytesDownloaded,
    totalBytes: download.totalBytes,
    mmProjDownloadId,
    mmProjCompleted,
    mmProjLocalPath,
  });

  const mmProjDownload = mmProjDownloadId
    ? activeDownloads.find(d => d.downloadId === mmProjDownloadId)
    : undefined;
  let mainBytesDownloaded = download.bytesDownloaded;
  let mmProjBytesDownloaded = mmProjCompleted
    ? mmProjFileSize
    : (mmProjDownload?.bytesDownloaded || 0);

  const reportProgress = () => {
    const combinedDownloaded = mainBytesDownloaded + mmProjBytesDownloaded;
    onProgress?.({
      downloadId: download.downloadId,
      modelId: metadata.modelId, fileName: metadata.fileName,
      bytesDownloaded: combinedDownloaded, totalBytes: combinedTotalBytes,
      progress: combinedTotalBytes > 0 ? combinedDownloaded / combinedTotalBytes : 0,
    });
  };

  const removeProgressListener = backgroundDownloadService.onProgress(
    download.downloadId, (event) => {
      mainBytesDownloaded = event.bytesDownloaded; reportProgress();
    },
  );

  let removeMmProjProgressListener: (() => void) | undefined;
  if (mmProjDownloadId && !mmProjCompleted) {
    removeMmProjProgressListener = backgroundDownloadService.onProgress(
      mmProjDownloadId, (event) => {
        mmProjBytesDownloaded = event.bytesDownloaded; reportProgress();
      },
    );
  }

  backgroundDownloadContext.set(download.downloadId, {
    modelId: metadata.modelId, file: fileInfo, localPath, mmProjLocalPath,
    removeProgressListener, mmProjDownloadId, mmProjCompleted, mainCompleted: download.status === 'completed',
    removeMmProjProgressListener,
  });
  backgroundDownloadMetadataCallback?.(download.downloadId, { ...metadata, mmProjLocalPath });
  reportProgress();
}

function collectMmProjIds(
  persistedDownloads: Record<string, PersistedDownloadInfo> | undefined,
  activeDownloads: RestorableDownloadInfo[],
): Set<string> {
  const ids = new Set<string>();
  for (const info of Object.values(persistedDownloads ?? {})) {
    if (info.mmProjDownloadId) ids.add(info.mmProjDownloadId);
  }
  for (const d of activeDownloads) {
    if (d.mmProjDownloadId) ids.add(d.mmProjDownloadId);
  }
  return ids;
}

export async function restoreInProgressDownloads(opts: RestoreDownloadsOpts): Promise<string[]> {
  const { modelsDir, backgroundDownloadContext, backgroundDownloadMetadataCallback, onProgress, persistedDownloads } = opts;

  if (!backgroundDownloadService.isAvailable()) return [];

  const activeDownloads = await backgroundDownloadService.getActiveDownloads() as RestorableDownloadInfo[];
  logger.log('[DownloadDebug] restoreInProgressDownloads scan', {
    activeDownloads: activeDownloads.length,
  });
  const mmProjIds = collectMmProjIds(persistedDownloads, activeDownloads);
  const restoredDownloadIds: string[] = [];

  for (const download of activeDownloads) {
    if (!isRestorable(download)) continue;
    if (mmProjIds.has(download.downloadId)) continue;
    // Belt-and-suspenders: also skip by filename. collectMmProjIds relies on
    // the mmProjDownloadId link field being populated on the parent row, but
    // after a retry the parent row in the native DB may carry a fresh ID while
    // the retried sidecar row has no back-link. The filename check catches those
    // orphaned sidecar rows and prevents them appearing as standalone entries
    // in the Download Manager screen.
    if (isMmProjFileName(download.fileName)) continue;
    const metadata = buildMetadataFromActiveDownload(download, modelsDir);
    if (!metadata || backgroundDownloadContext.has(download.downloadId)) continue;
    try {
      await restoreDownloadEntry({
        download, metadata, modelsDir, activeDownloads,
        backgroundDownloadContext, backgroundDownloadMetadataCallback, onProgress,
      });
      restoredDownloadIds.push(download.downloadId);
    } catch (error) {
      // Keep restoring other downloads even if one stale native row is malformed.
      logger.error('[ModelManager] Failed to restore in-progress download', {
        downloadId: download.downloadId,
        modelId: download.modelId,
        fileName: download.fileName,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return restoredDownloadIds;
}
