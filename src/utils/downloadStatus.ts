/**
 * Download-status classification + the DownloadEntry shape — the pure, zero-IO core of the
 * download subsystem. Lives here (not in the store) so pure consumers (e.g. downloadAggregate)
 * can use it without importing the store, which would make a util depend on a store (the
 * utils-stay-pure layering violation). The store imports and RE-EXPORTS these for back-compat,
 * so existing `from '../stores/downloadStore'` importers keep working.
 */
import { ModelKey } from './modelKey';

export type DownloadStatus =
  | 'pending'
  | 'running'
  | 'retrying'
  | 'waiting_for_network'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled'

export type ModelType = 'text' | 'image' | 'stt' | 'tts'

export interface DownloadEntry {
  modelKey: ModelKey
  downloadId: string
  modelId: string
  fileName: string
  quantization: string
  modelType: ModelType
  status: DownloadStatus
  bytesDownloaded: number
  totalBytes: number
  combinedTotalBytes: number
  progress: number
  mmProjDownloadId?: string
  mmProjBytesDownloaded?: number
  mmProjStatus?: DownloadStatus
  mmProjFileName?: string
  mmProjFileSize?: number
  errorMessage?: string
  errorCode?: string
  createdAt: number
  metadataJson?: string
}

/**
 * Statuses that count as "an active download is in flight for this modelKey".
 * Use this to guard against duplicate starts (rapid double-tap) so we never
 * have two parallel native downloads racing on the same logical file.
 */
const ACTIVE_STATUSES = new Set<DownloadStatus>([
  'pending', 'running', 'retrying', 'waiting_for_network', 'processing',
]);

export function isActiveStatus(status: DownloadStatus): boolean {
  return ACTIVE_STATUSES.has(status);
}

/**
 * The ONE download-state classification every view must use. `isActiveStatus`
 * lumps queued (`pending`) in with actively-transferring rows; these split that
 * so a queued item renders the clock (not "downloading 0%") and an "active"
 * count can separate the two — consistently across every tab, the card, the
 * Download Manager count, and the badge. Never re-derive `status === 'pending'`
 * inline in a view; call these so the classification can't drift per-surface.
 */
export function isQueuedStatus(status: DownloadStatus): boolean {
  return status === 'pending';
}

export function isDownloadingStatus(status: DownloadStatus): boolean {
  return isActiveStatus(status) && status !== 'pending';
}
