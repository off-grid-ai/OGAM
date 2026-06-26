/**
 * Low-level download helper functions extracted from modelManagerDownload
 * to keep each file within the max-lines limit.
 */
import RNFS from 'react-native-fs';
import { DownloadedModel, ModelFile, PersistedDownloadInfo } from '../../types';
import { backgroundDownloadService } from '../backgroundDownloadService';
import { buildDownloadedModel, persistDownloadedModel } from './storage';

export async function getOrphanedTextFiles(
  modelsDir: string,
  modelsGetter: () => Promise<DownloadedModel[]>,
): Promise<Array<{ name: string; path: string; size: number }>> {
  const orphaned: Array<{ name: string; path: string; size: number }> = [];
  const modelsDirExists = await RNFS.exists(modelsDir);
  if (!modelsDirExists) return orphaned;

  const files = await RNFS.readDir(modelsDir);
  const models = await modelsGetter();

  const trackedPaths = new Set<string>();
  for (const model of models) {
    trackedPaths.add(model.filePath);
    if (model.engine === 'llama' && model.mmProjPath) trackedPaths.add(model.mmProjPath);
  }

  for (const file of files) {
    if (file.isFile() && !trackedPaths.has(file.path)) {
      orphaned.push({
        name: file.name,
        path: file.path,
        size: typeof file.size === 'string' ? Number.parseInt(file.size, 10) : file.size,
      });
    }
  }

  return orphaned;
}

function parseFileSize(size: string | number): number {
  return typeof size === 'string' ? Number.parseInt(size, 10) : size;
}

async function calculateDirectorySize(dirPath: string): Promise<number> {
  try {
    const dirFiles = await RNFS.readDir(dirPath);
    let total = 0;
    for (const f of dirFiles) {
      if (f.isFile()) total += parseFileSize(f.size);
    }
    return total;
  } catch {
    return 0;
  }
}

function isItemTracked(itemPath: string, trackedPaths: string[]): boolean {
  return trackedPaths.some(p => p === itemPath || p.startsWith(`${itemPath}/`));
}

export async function getOrphanedImageDirs(
  imageModelsDir: string,
  imageModelsGetter: () => Promise<import('../../types').ONNXImageModel[]>,
): Promise<Array<{ name: string; path: string; size: number }>> {
  const orphaned: Array<{ name: string; path: string; size: number }> = [];
  const imageDirExists = await RNFS.exists(imageModelsDir);
  if (!imageDirExists) return orphaned;

  const items = await RNFS.readDir(imageModelsDir);
  const imageModels = await imageModelsGetter();
  const trackedImagePaths = imageModels.map(m => m.modelPath);

  for (const item of items) {
    if (isItemTracked(item.path, trackedImagePaths)) continue;

    const totalSize = item.isDirectory()
      ? await calculateDirectorySize(item.path)
      : parseFileSize(item.size);

    orphaned.push({ name: item.name, path: item.path, size: totalSize });
  }

  return orphaned;
}

export interface SyncDownloadsOpts {
  persistedDownloads: Record<string, PersistedDownloadInfo>;
  modelsDir: string;
  clearDownloadCallback: (downloadId: string) => void;
}

/** Resolve the final mmproj path for a completed sync download. */
async function resolveMmProjPath(metadata: PersistedDownloadInfo): Promise<string | undefined> {
  const mmProjLocalPath = metadata.mmProjLocalPath ?? null;
  if (metadata.mmProjDownloadId && mmProjLocalPath) {
    try {
      await backgroundDownloadService.moveCompletedDownload(metadata.mmProjDownloadId, mmProjLocalPath);
      return mmProjLocalPath;
    } catch {
      return (await RNFS.exists(mmProjLocalPath)) ? mmProjLocalPath : undefined;
    }
  }
  if (mmProjLocalPath && await RNFS.exists(mmProjLocalPath)) return mmProjLocalPath;
  return undefined;
}

/** Check whether a parallel mmproj download is still in progress. */
function isMmProjStillRunning(
  metadata: PersistedDownloadInfo,
  activeDownloads: Array<{ downloadId: string; status: string }>,
): boolean {
  if (!metadata.mmProjDownloadId) return false;
  const mmProjDl = activeDownloads.find(d => d.downloadId === metadata.mmProjDownloadId);
  return !!mmProjDl && mmProjDl.status !== 'completed' && mmProjDl.status !== 'failed';
}

async function processCompletedDownload(
  downloadId: string, metadata: PersistedDownloadInfo, modelsDir: string,
): Promise<DownloadedModel> {
  const localPath = `${modelsDir}/${metadata.fileName}`;
  await backgroundDownloadService.moveCompletedDownload(downloadId, localPath);
  const finalMmProjPath = await resolveMmProjPath(metadata);

  const mainFileSize = metadata.mainFileSize ?? metadata.totalBytes;
  const mmProjFileSize = metadata.mmProjFileSize ?? 0;
  // We deliberately do NOT thread liteRTVision through metadata here — the
  // curated registry in buildDownloadedModel resolves capability bits by
  // fileName, so the restore-after-kill path produces the same result as
  // the in-session path without explicit plumbing.
  const fileInfo: ModelFile = {
    name: metadata.fileName, size: mainFileSize,
    quantization: metadata.quantization, downloadUrl: '',
    mmProjFile: metadata.mmProjFileName
      ? { name: metadata.mmProjFileName, size: mmProjFileSize, downloadUrl: '' }
      : undefined,
  };

  const model = await buildDownloadedModel({
    modelId: metadata.modelId,
    file: fileInfo,
    resolvedLocalPath: localPath,
    mmProjPath: finalMmProjPath,
    // Persist the sentinel even when the sidecar file is absent (failed/not-yet-moved).
    // This ensures needsVisionRepair() can show "Repair Vision" from the Download Manager
    // without relying on catalog data that the DM screen doesn't have.
    expectedMmProjFileName: !finalMmProjPath ? metadata.mmProjFileName : undefined,
  });
  await persistDownloadedModel(model, modelsDir);
  return model;
}

function handleFailedDownload(
  metadata: PersistedDownloadInfo, clearDownloadCallback: (downloadId: string) => void, downloadId: string,
): void {
  if (metadata.mmProjDownloadId) {
    backgroundDownloadService.cancelDownload(metadata.mmProjDownloadId).catch(() => {});
  }
  clearDownloadCallback(downloadId);
}

export async function syncCompletedBackgroundDownloads(opts: SyncDownloadsOpts): Promise<DownloadedModel[]> {
  const { persistedDownloads, modelsDir, clearDownloadCallback } = opts;
  const completedModels: DownloadedModel[] = [];
  const activeDownloads = await backgroundDownloadService.getActiveDownloads();

  for (const download of activeDownloads) {
    const metadata = persistedDownloads[download.downloadId];
    if (!metadata) continue;
    // image: (image models) and whisper- (STT models) belong to their own
    // managers; recovering them here mis-registered them as text models.
    if (metadata.modelId.startsWith('image:') || metadata.modelId.startsWith('whisper-')) continue;

    if (download.status === 'completed') {
      if (isMmProjStillRunning(metadata, activeDownloads)) continue;
      try {
        const model = await processCompletedDownload(download.downloadId, metadata, modelsDir);
        completedModels.push(model);
        clearDownloadCallback(download.downloadId);
      } catch { /* Skip failed syncs */ }
    } else if (download.status === 'failed') {
      handleFailedDownload(metadata, clearDownloadCallback, download.downloadId);
    }
  }

  return completedModels;
}
