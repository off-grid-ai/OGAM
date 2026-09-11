import type { ModelsSnapshot } from '@offgrid/application';
import type { DownloadedModel, ModelFile } from '../../types';
import { needsVisionRepair } from '../../utils/visionRepair';
import { isFailedStatus } from '../../utils/downloadStatus';
import { makeModelKey } from '../../utils/modelKey';
import { modelDownloadMatchesFile } from './modelDownloadProjection';

type DownloadEntry = ModelsSnapshot['control']['downloads'][number];
type Operation = ModelsSnapshot['operations']['active'][number];

interface Input {
  readonly modelId: string;
  readonly file: ModelFile;
  readonly downloads: readonly DownloadEntry[];
  readonly projectorRepairs: readonly Operation[];
  readonly downloaded: boolean;
  readonly downloadedModel?: DownloadedModel;
  readonly locallyRepairing: boolean;
}

/** Pure presentation projection for one model-file card. Shared remains the lifecycle owner. */
export function projectModelFileCardState(input: Input) {
  const downloadKey = makeModelKey(input.modelId, input.file.name);
  const entry = input.downloads.find(row =>
    modelDownloadMatchesFile(row, input.modelId, input.file.name));
  const repair = input.projectorRepairs.find(
    operation => operation.modelId === input.downloadedModel?.id,
  );
  const inProgress = entry ? ['pending', 'queued', 'preparing', 'running', 'downloading', 'verifying', 'processing', 'retrying'].includes(entry.status) : false;
  const hasFailed = entry ? isFailedStatus(entry.status) : false;
  let progress = repair ? {
    progress: (repair.progress?.percent ?? 0) / 100,
    bytesDownloaded: repair.progress?.bytesDownloaded ?? 0,
    totalBytes: repair.progress?.totalBytes ?? input.file.mmProjFile?.size ?? 0,
    bytesPerSecond: repair.progress?.bytesPerSecond,
    status: 'downloading',
  } : entry && (inProgress || hasFailed || entry.status === 'completed') ? {
    progress: entry.totalBytes > 0 ? entry.bytesDownloaded / entry.totalBytes : 0,
    bytesDownloaded: entry.bytesDownloaded,
    totalBytes: entry.totalBytes,
    bytesPerSecond: entry.bytesPerSecond,
    status: entry.status,
  } : undefined;
  if (progress?.status === 'completed' && progress.bytesDownloaded < input.file.size)
    progress = undefined;
  return {
    downloadKey,
    progress,
    downloaded: input.downloaded,
    downloadedModel: input.downloadedModel,
    needsVisionRepair: needsVisionRepair(input.downloadedModel, input.file),
    repairingVision: !!repair || input.locallyRepairing,
    repairOperationId: repair?.operationId,
    canCancel: inProgress || !!repair,
    hasFailed,
    errorMessage: hasFailed ? (entry?.reason ?? 'Download failed') : undefined,
  };
}
