/**
 * Map the internal downloadStore status (text/image/stt all flow through that
 * store) to the uniform ModelDownloadStatus the service's state machine speaks.
 * One place this mapping lives, so every store-backed provider agrees.
 */
import type { DownloadStatus } from '../../stores/downloadStore';
import type { ModelDownloadStatus } from './types';

/**
 * The ONE "is this download in progress?" predicate in the service's vocabulary —
 * the service-layer twin of the store's isActiveStatus. Any surface that reads the
 * ModelDownloadService projection (Voice panel, future screens) MUST use this instead
 * of comparing against a single literal like `=== 'downloading'`, which silently
 * misses `queued` (accepted, not yet transferring) and `paused` (interrupted /
 * kill-resumable) — so a queued or interrupted download would render as idle.
 */
export function isModelDownloadInProgress(s: ModelDownloadStatus): boolean {
  return s === 'queued' || s === 'downloading' || s === 'paused';
}

export function mapStoreStatus(s: DownloadStatus): ModelDownloadStatus {
  switch (s) {
    case 'pending':
      return 'queued';
    case 'running':
    case 'retrying':
    case 'processing':
      return 'downloading';
    case 'waiting_for_network':
      return 'paused';
    case 'completed':
      return 'completed';
    case 'failed':
    case 'cancelled':
    default:
      return 'error';
  }
}
