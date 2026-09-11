import type {PublicDownloadInfo} from '@offgrid/models';
import {applicationFacade} from '../applicationFacade';
import {modelDownloadProjection, type DownloadEntry} from '../../stores/downloadStore';
import {makeModelKey} from '../../utils/modelKey';

/** Translate the canonical Shared download snapshot into Mobile's presentation record. */
function mobileDownloadEntry(row: PublicDownloadInfo): DownloadEntry {
  const totalBytes = row.totalBytes || 0;
  return {
    modelKey: row.modelKey ?? makeModelKey(row.modelId, row.fileName),
    downloadId: row.downloadId,
    modelId: row.modelId,
    fileName: row.fileName,
    quantization: '',
    modelType: row.modelType ?? 'text',
    status: row.status,
    bytesDownloaded: row.bytesDownloaded,
    totalBytes,
    bytesPerSecond: row.bytesPerSecond,
    combinedTotalBytes: totalBytes,
    progress: totalBytes > 0 ? Math.min(1, row.bytesDownloaded / totalBytes) : 0,
    currentFileRole: row.currentFileRole,
    errorMessage: row.reason,
    errorCode: row.reasonCode,
    createdAt: row.startedAt,
    metadataJson: row.metadataJson,
  };
}

/**
 * Keep the legacy Zustand rendering port as a projection of Shared, never as a lifecycle owner.
 * Shared `ModelsSnapshot.control.downloads` is the only source of truth.
 */
export function registerSharedDownloadProjection(): () => void {
  const models = applicationFacade().models;
  const project = (rows: readonly PublicDownloadInfo[]) => {
    modelDownloadProjection.replace(rows.map(mobileDownloadEntry));
  };
  project(models.snapshot().control.downloads);
  return models.watch(snapshot => snapshot.control.downloads, project);
}
