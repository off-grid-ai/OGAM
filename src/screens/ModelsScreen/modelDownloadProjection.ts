import { isModelDownloadInProgress, type ModelsSnapshot } from '@offgrid/application';
import { hideAlert, showAlert, type AlertState } from '../../components/CustomAlert';
import type { DownloadedModel } from '../../types';
import { isPausedStatus } from '../../utils/downloadStatus';

export function downloadedModelMatchesFile(
  model: DownloadedModel,
  repositoryId: string,
  fileName: string,
): boolean {
  return model.fileName === fileName || model.id === `${repositoryId}/${fileName}`;
}

/** Match one Shared download projection to the exact repository artifact selected in the UI. */
export function modelDownloadMatchesFile(
  download: ModelsSnapshot['control']['downloads'][number],
  repositoryId: string,
  fileName: string,
): boolean {
  return (download.repositoryId ?? download.modelId) === repositoryId
    && download.fileName === fileName;
}

export function buildFileDownloadHandler(input: {
  state: { downloaded: boolean; progress: unknown; hasFailed: boolean };
  fileName: string;
  sizeBytes: number;
  ramGB: number;
  warning: (fileName: string, sizeBytes: number, ramGB: number) => { title: string; message: string } | null;
  proceed: () => void;
  setAlertState: (state: AlertState) => void;
}): (() => void) | undefined {
  if (input.state.downloaded || input.state.progress || input.state.hasFailed) return undefined;
  return () => {
    const warning = input.warning(input.fileName, input.sizeBytes, input.ramGB);
    if (!warning) return input.proceed();
    input.setAlertState(showAlert(warning.title, warning.message, [
      { text: 'Cancel', style: 'cancel', onPress: () => input.setAlertState(hideAlert()) },
      { text: 'Download anyway', style: 'default', onPress: () => {
        input.setAlertState(hideAlert());
        input.proceed();
      } },
    ]));
  };
}

export function aggregateTextModelDownloads(downloads: ModelsSnapshot['control']['downloads'], repositoryId: string) {
  const active = downloads.filter(row =>
    row.modelType === 'text'
    && row.modelId.startsWith(`${repositoryId}/`)
    && isModelDownloadInProgress(row.status));
  const downloaded = active.reduce((sum, row) => sum + row.bytesDownloaded, 0);
  const total = active.reduce((sum, row) => sum + row.totalBytes, 0);
  return {
    downloading: active.some(row => row.status === 'downloading'),
    queued: active.some(row => row.status === 'queued'),
    // Paused is its own answer. It is neither downloading nor queued, so without this a paused
    // row leaves every flag false and the card reads as idle while bytes sit on disk.
    paused: active.some(row => isPausedStatus(row.status)),
    progress: total > 0 ? downloaded / total : 0,
    bytes: { downloaded, total },
    count: active.length,
  };
}
