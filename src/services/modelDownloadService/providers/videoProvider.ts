import { videoModelDisplayName } from '../../../utils/modelHelpers';
import { mapStoreStatus } from '../storeStatus';
import { modelResidencyManager } from '../../modelResidency';
import RNFS from 'react-native-fs';
import type { ModelEntry } from '@offgrid/models';
import { useAppStore } from '../../../stores/appStore';
import { useDownloadStore } from '../../../stores/downloadStore';
import { backgroundDownloadService } from '../../backgroundDownloadService';
import {
  resolveVideoPack,
  validateVideoPack,
  videoModelDirectory,
} from '../../videoModelFiles';
import type {
  DownloadProvider,
  ModelDownload,
  ModelDownloadStatus,
} from '../types';

interface Transfer {
  cancelled: boolean;
  paused: boolean;
  nativeId?: string;
  wake?: () => void;
}
const transfers = new Map<string, Transfer>();
const key = (id: string) => `video:${id}`;
const bare = (id: string) => id.replace(/^video:/, '');
function addRow(model: ModelEntry, status: 'pending' | 'paused') {
  useDownloadStore
    .getState()
    .add({
      modelKey: key(model.id),
      modelId: model.id,
      downloadId: key(model.id),
      modelType: 'video',
      fileName: videoModelDisplayName(model.id, model.name),
      totalBytes: model.files.reduce((sum, f) => sum + (f.sizeBytes ?? 0), 0),
      bytesDownloaded: 0,
      progress: 0,
      status,
      quantization: '',
      combinedTotalBytes: model.files.reduce(
        (sum, f) => sum + (f.sizeBytes ?? 0),
        0,
      ),
      createdAt: Date.now(),
    });
}
async function start(model: ModelEntry): Promise<void> {
  validateVideoPack(model);
  if (
    useAppStore
      .getState()
      .downloadedVideoModels.some(item => item.id === model.id)
  )
    throw new Error(
      'Remove the installed video pack before downloading another variant.',
    );
  if (transfers.has(model.id)) return;
  const transfer: Transfer = { cancelled: false, paused: false };
  transfers.set(model.id, transfer);
  useAppStore.getState().setVideoDownload(model.id, model);
  addRow(model, 'pending');
  const directory = videoModelDirectory(model.id);
  let bytes = 0;
  const installedFiles: ModelEntry['files'] = [];
  const total = model.files.reduce(
    (sum, file) => sum + (file.sizeBytes ?? 0),
    0,
  );
  try {
    await RNFS.mkdir(directory);
    await backgroundDownloadService.excludeFromBackup(directory);
    for (const file of model.files) {
      if (transfer.paused)
        await new Promise<void>(resolve => {
          transfer.wake = resolve;
        });
      if (transfer.cancelled) throw new Error('Download cancelled.');
      const destination = `${directory}/${file.name}`;
      const existing = await RNFS.stat(destination).catch(() => null);
      if (
        existing &&
        file.sizeBytes &&
        Number(existing.size) === file.sizeBytes &&
        (!file.sha256 || (await RNFS.hash(destination, 'sha256')).toLowerCase() === file.sha256.toLowerCase())
      ) {
        installedFiles.push({ ...file, sizeBytes: Number(existing.size) });
        bytes += file.sizeBytes;
        useDownloadStore.getState().updateProgress(key(model.id), bytes, total);
        continue;
      }
      useDownloadStore.getState().setStatus(key(model.id), 'running');
      const task = backgroundDownloadService.downloadFileTo({
        params: {
          url: file.url,
          fileName: `${encodeURIComponent(model.id)}_${file.name}`,
          modelId: key(model.id),
          modelKey: key(model.id),
          modelType: 'video',
          totalBytes: file.sizeBytes,
          sha256: file.sha256,
        },
        destPath: destination,
        onProgress: received =>
          useDownloadStore
            .getState()
            .updateProgress(key(model.id), bytes + received, total),
      });
      task.downloadIdPromise
        ?.then(async id => {
          transfer.nativeId = id;
          if (transfer.cancelled)
            await backgroundDownloadService.cancelDownload(id);
          else if (transfer.paused)
            await backgroundDownloadService.pauseDownload(id);
        })
        .catch(() => {});
      await task.promise;
      transfer.nativeId = undefined;
      const sizeBytes = Number((await RNFS.stat(destination)).size);
      installedFiles.push({ ...file, sizeBytes });
      bytes += sizeBytes;
    }
    if (transfer.cancelled) throw new Error('Download cancelled.');
    useDownloadStore.getState().setProcessing(key(model.id));
    await resolveVideoPack(model, true);
    if (transfer.cancelled) throw new Error('Download cancelled.');
    const app = useAppStore.getState();
    app.addDownloadedVideoModel({
      ...model,
      kind: 'video',
      files: installedFiles,
      downloadedAt: new Date().toISOString(),
    });
    app.setVideoDownload(model.id, null);
    useDownloadStore.getState().remove(key(model.id));
  } catch (error) {
    if (!transfer.cancelled)
      useDownloadStore
        .getState()
        .setStatus(key(model.id), 'failed', {
          message:
            error instanceof Error ? error.message : 'Video download failed.',
        });
    else useDownloadStore.getState().remove(key(model.id));
  } finally {
    // Keep completed pack files. A later download validates and reuses them.
    transfers.delete(model.id);
  }
}
export const videoProvider: DownloadProvider = {
  modelType: 'video',
  async start(request) {
    if (request.modelType === 'video') await start(request.model);
  },
  async list() {
    const result: ModelDownload[] = [];
    for (const model of Object.values(useAppStore.getState().videoDownloads)) {
      const row = useDownloadStore.getState().downloads[key(model.id)];
      const status: ModelDownloadStatus = row ? mapStoreStatus(row.status) : 'paused';
      result.push({
        id: key(model.id),
        modelType: 'video',
        name: videoModelDisplayName(model.id, model.name),
        sizeBytes: row?.totalBytes ?? 0,
        bytesDownloaded: row?.bytesDownloaded ?? 0,
        progress: row?.progress ?? 0,
        status,
        error: row?.errorMessage,
        capabilities: {
          cancel: true,
          retry: true,
          remove: true,
          pause: transfers.has(model.id) && status === 'downloading',
          resume: status === 'paused',
          resumable: false,
          determinateProgress: true,
        },
      });
    }
    for (const model of useAppStore.getState().downloadedVideoModels) {
      if (result.some(row => row.id === key(model.id))) continue;
      const size = model.files.reduce(
        (sum, file) => sum + (file.sizeBytes ?? 0),
        0,
      );
      result.push({
        id: key(model.id),
        modelType: 'video',
        name: videoModelDisplayName(model.id, model.name),
        sizeBytes: size,
        bytesDownloaded: size,
        progress: 1,
        status: 'completed',
        filePath: videoModelDirectory(model.id),
        capabilities: {
          cancel: false,
          retry: false,
          remove: true,
          resumable: false,
          determinateProgress: true,
        },
      });
    }
    return result;
  },
  async pause(id) {
    const transfer = transfers.get(bare(id));
    if (!transfer) return;
    transfer.paused = true;
    try {
      if (transfer.nativeId)
        await backgroundDownloadService.pauseDownload(transfer.nativeId);
    } catch (error) {
      transfer.paused = false;
      throw error;
    }
    useDownloadStore.getState().setStatus(id, 'paused');
  },
  async resume(id) {
    const transfer = transfers.get(bare(id));
    if (!transfer) {
      await videoProvider.retry(id);
      return;
    }
    if (transfer.nativeId)
      await backgroundDownloadService.resumeDownload(transfer.nativeId);
    transfer.paused = false;
    transfer.wake?.();
    transfer.wake = undefined;
    useDownloadStore.getState().setStatus(id, 'running');
  },
  async cancel(id) {
    const modelId = bare(id),
      transfer = transfers.get(modelId);
    if (transfer) {
      transfer.cancelled = true;
      transfer.wake?.();
      backgroundDownloadService.cancelQueued(key(modelId));
      if (transfer.nativeId)
        await backgroundDownloadService.cancelDownload(transfer.nativeId);
    }
    useAppStore.getState().setVideoDownload(modelId, null);
    useDownloadStore.getState().remove(key(modelId));
  },
  async retry(id) {
    const model = useAppStore.getState().videoDownloads[bare(id)];
    if (model) await start(model);
  },
  async remove(id) {
    const modelId = bare(id);
    if (
      modelResidencyManager
        .getResidents()
        .some(resident => resident.type === 'video')
    )
      throw new Error('Stop video generation before removing this model.');
    if (transfers.has(modelId))
      throw new Error('Cancel the download before removing its files.');
    const directory = videoModelDirectory(modelId);
    if (await RNFS.exists(directory)) await RNFS.unlink(directory);
    useAppStore.getState().removeDownloadedVideoModel(modelId);
    useAppStore.getState().setVideoDownload(modelId, null);
    useDownloadStore.getState().remove(key(modelId));
  },
  subscribe(listener) {
    const a = useAppStore.subscribe(listener),
      b = useDownloadStore.subscribe(listener);
    return () => {
      a();
      b();
    };
  },
  async reconcile() {
    // An old native request has no pack continuation after process death. Preserve
    // completed pack files, stop the orphan request, and offer an explicit resume.
    for (const row of await backgroundDownloadService.getActiveDownloads()) {
      if (row.modelId.startsWith('video:') && !transfers.has(bare(row.modelId)))
        await backgroundDownloadService.cancelDownload(row.downloadId);
    }
    for (const model of Object.values(useAppStore.getState().videoDownloads)) {
      if (!transfers.has(model.id)) addRow(model, 'paused');
    }
  },
};
