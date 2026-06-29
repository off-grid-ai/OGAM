/**
 * Map the internal downloadStore status (text/image/stt all flow through that
 * store) to the uniform ModelDownloadStatus the service's state machine speaks.
 * One place this mapping lives, so every store-backed provider agrees.
 */
import type { DownloadStatus } from '../../stores/downloadStore';
import type { ModelDownloadStatus } from './types';

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
