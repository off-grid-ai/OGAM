import { backgroundDownloadService } from './backgroundDownloadService';
import { useDownloadStore, DownloadEntry, DownloadStatus, ModelType, isActiveStatus } from '../stores/downloadStore';
import { makeModelKey, ModelKey } from '../utils/modelKey';
import { BackgroundDownloadStatus } from '../types';
import { isMMProjFile } from './mmproj';
import { loadActiveDownloads } from './activeDownloadPersistence';
import logger from '../utils/logger';

type NativeDownloadRow = {
  downloadId: string;
  modelId?: string;
  modelKey?: string;
  fileName: string;
  quantization?: string;
  modelType?: ModelType;
  status: BackgroundDownloadStatus;
  bytesDownloaded?: number;
  totalBytes?: number;
  combinedTotalBytes?: number;
  mmProjDownloadId?: string;
  reason?: string;
  reasonCode?: string;
  createdAt?: number;
  metadataJson?: string;
};

/**
 * Is this download-row filename a multimodal projector (mmproj) rather than a model weights file?
 * Delegates to the single source of truth (src/services/mmproj.ts) so "is this a projector" is defined
 * once — the previous local copy matched only 'mmproj' and missed 'projector'/'clip' names. Re-exported so
 * modelManager/restore.ts's orphaned-sidecar filter shares the exact same rule (DRY).
 */
export function isMmProjFileName(fileName: string): boolean {
  return isMMProjFile(fileName);
}

function mapNativeStatus(status: BackgroundDownloadStatus): DownloadStatus {
  switch (status) {
    case 'running': return 'running';
    case 'retrying': return 'failed';
    case 'waiting_for_network': return 'waiting_for_network';
    case 'completed': return 'completed';
    case 'failed': return 'failed';
    case 'cancelled': return 'cancelled';
    default: return 'pending';
  }
}

function computeProgress(
  downloadedBytes: number,
  totalBytes: number,
  combinedTotalBytes: number,
): number {
  const denom = combinedTotalBytes || totalBytes;
  if (denom <= 0) return 0;
  return downloadedBytes / denom;
}

function getMmProjIds(rows: NativeDownloadRow[]): Set<string> {
  return new Set<string>(
    rows.flatMap(r => r.mmProjDownloadId ? [r.mmProjDownloadId] : []),
  );
}

function isImageRow(r: NativeDownloadRow): boolean {
  return r.modelType === 'image' || (r.modelId?.startsWith('image:') ?? false);
}

function getParentRows(rows: NativeDownloadRow[], mmProjIds: Set<string>): NativeDownloadRow[] {
  return rows.filter(r =>
    !mmProjIds.has(r.downloadId) &&
    !isMmProjFileName(r.fileName) &&
    r.status !== 'cancelled' &&
    // Keep COMPLETED image rows — native finished but JS finalization (unzip+register)
    // may not have run. Text COMPLETED rows are safe to drop (already in AsyncStorage).
    !(r.status === 'completed' && !isImageRow(r)),
  );
}

function getLatestRowsByKey(rows: NativeDownloadRow[]): Map<ModelKey, NativeDownloadRow> {
  const latestByKey = new Map<ModelKey, NativeDownloadRow>();
  for (const row of rows) {
    const key: ModelKey = row.modelKey ?? makeModelKey(row.modelId ?? '', row.fileName);
    const existing = latestByKey.get(key);
    if (!existing || (row.createdAt ?? 0) > (existing.createdAt ?? 0)) {
      latestByKey.set(key, row);
    }
  }
  return latestByKey;
}

function resolveMmProj(row: NativeDownloadRow, rows: NativeDownloadRow[]) {
  const mmProjRow = row.mmProjDownloadId
    ? rows.find(r => r.downloadId === row.mmProjDownloadId)
    : undefined;
  return {
    mmProjRow,
    mmProjBytes: mmProjRow?.bytesDownloaded ?? 0,
    mmProjDownloadId: row.mmProjDownloadId ?? undefined,
    mmProjBytesDownloaded: mmProjRow ? (mmProjRow.bytesDownloaded ?? 0) : undefined,
    mmProjStatus: mmProjRow ? mapNativeStatus(mmProjRow.status) : undefined,
  };
}

function toDownloadEntry(
  modelKey: ModelKey,
  row: NativeDownloadRow,
  rows: NativeDownloadRow[],
): DownloadEntry {
  const { mmProjBytes, mmProjDownloadId, mmProjBytesDownloaded, mmProjStatus } = resolveMmProj(row, rows);
  const combinedTotal = row.combinedTotalBytes || row.totalBytes || 0;
  const downloadedBytes = (row.bytesDownloaded ?? 0) + mmProjBytes;

  // COMPLETED image rows need JS-side finalization — surface as 'processing'
  // so the UI shows them and restoreProcessingImageDownloads can re-finalize.
  const imageCompleted = isImageRow(row) && row.status === 'completed';
  const status = imageCompleted ? 'processing' : mapNativeStatus(row.status);

  return {
    modelKey,
    downloadId: row.downloadId,
    modelId: row.modelId ?? '',
    fileName: row.fileName,
    quantization: row.quantization ?? 'Unknown',
    modelType: row.modelType ?? 'text',
    status,
    bytesDownloaded: row.bytesDownloaded ?? 0,
    totalBytes: row.totalBytes ?? 0,
    combinedTotalBytes: combinedTotal,
    progress: computeProgress(downloadedBytes, row.totalBytes ?? 0, combinedTotal),
    mmProjDownloadId,
    mmProjBytesDownloaded,
    mmProjStatus,
    errorMessage: row.reason || undefined,
    errorCode: row.reasonCode || undefined,
    createdAt: row.createdAt ?? 0,
    metadataJson: row.metadataJson ?? undefined,
  };
}

/**
 * An in-flight entry we already knew about whose native download row is GONE from the
 * fresh snapshot was interrupted by an app-kill (iOS URLSession drops its task on
 * force-quit; a foreground STT/multi-file transfer dies with the process; Android
 * WorkManager instead SURVIVES and reappears in the snapshot, so it is never here).
 *
 * The relaxed product rule: we do not need to resume the actual bytes across a kill —
 * we must NEVER let the download silently vanish. Carry the prior entry forward as a
 * `failed`/retriable entry so the Download Manager keeps a card (with Retry/Remove),
 * rather than a phantom "downloading" or nothing at all. This is the single native-row
 * reconcile path for every model type (text/image/stt) — no per-type fork.
 *
 * A prior entry that had already `completed`/`cancelled` is intentionally dropped (a
 * clean finish moved it to its domain store; nothing to strand).
 */
function strandInterruptedEntries(
  hydratedKeys: Set<ModelKey>,
  persistedPrior: DownloadEntry[],
): DownloadEntry[] {
  // Prior in-flight entries come from TWO sources, so an interrupted download is caught after a
  // FOREGROUND resume (in-memory store still populated) AND a cold app-kill (in-memory gone, only the
  // durably-persisted snapshot survives). In-memory wins on conflict (it's the more recent truth).
  const priors = new Map<ModelKey, DownloadEntry>();
  for (const e of persistedPrior) priors.set(e.modelKey, e);
  for (const e of Object.values(useDownloadStore.getState().downloads)) priors.set(e.modelKey, e);

  const stranded: DownloadEntry[] = [];
  for (const prior of priors.values()) {
    if (hydratedKeys.has(prior.modelKey)) continue; // still has a live native row (Android WorkManager survives → never stranded)
    if (!isActiveStatus(prior.status)) continue;     // already completed/failed/cancelled
    logger.log(
      `[DL-SM] ${prior.modelType}:${prior.modelId} hydrate: native row gone (app-kill) → failed/retriable`,
    );
    stranded.push({
      ...prior,
      status: 'failed',
      errorMessage: prior.errorMessage ?? 'Interrupted — app closed. Tap retry.',
    });
  }
  return stranded;
}

export async function hydrateDownloadStore(): Promise<void> {
  if (!backgroundDownloadService.isAvailable()) return;

  const rows = await backgroundDownloadService.getActiveDownloads() as NativeDownloadRow[];
  const mmProjIds = getMmProjIds(rows);
  const parentRows = getParentRows(rows, mmProjIds);
  const latestByKey = getLatestRowsByKey(parentRows);
  const entries: DownloadEntry[] = [];

  for (const [modelKey, row] of latestByKey.entries()) {
    try {
      entries.push(toDownloadEntry(modelKey, row, rows));
    } catch (error) {
      // One malformed native row should not make the whole Download Manager disappear.
      logger.error('[DownloadHydration] Failed to hydrate download row', {
        downloadId: row.downloadId,
        modelId: row.modelId,
        fileName: row.fileName,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Native rows are the source of truth for what is genuinely in flight; but a row that
  // VANISHED (vs one that reports a new status) means an interrupted transfer whose task
  // the OS discarded. Preserve the prior in-flight entry as failed/retriable so it never
  // silently disappears from the Download Manager — including across a cold app-kill, where
  // the prior entry survives only in the durably-persisted snapshot (loadActiveDownloads).
  const hydratedKeys = new Set(entries.map(e => e.modelKey));
  const persistedPrior = await loadActiveDownloads();
  entries.push(...strandInterruptedEntries(hydratedKeys, persistedPrior));

  useDownloadStore.getState().hydrate(entries);
}
