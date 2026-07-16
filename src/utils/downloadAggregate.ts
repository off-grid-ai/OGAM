/**
 * Aggregate a model's in-flight downloads into ONE progress view for its card.
 *
 * A model card can front several concurrent download entries: a vision GGUF's main
 * file + mmproj sidecar, or a grouped/curated parent (e.g. the LiteRT parent covering
 * E2B + E4B). The card must show CUMULATIVE bytes/progress and how many downloads are
 * running — not just the first entry. Pure + testable; the card component is unchanged
 * and just consumes these fields.
 */
import { DownloadEntry, isActiveStatus, isQueuedStatus } from './downloadStatus';

export interface AggregatedDownload {
  /** At least one entry is actively transferring (not just queued). */
  downloading: boolean;
  /** Entries exist but all are still queued (waiting for a slot). */
  queued: boolean;
  /** Number of actively-transferring entries (for the "N downloads" indicator). */
  count: number;
  /** Cumulative progress 0..1 across all matched entries. */
  progress: number;
  /** Cumulative bytes across all matched entries, or undefined when total is unknown. */
  bytes?: { downloaded: number; total: number };
}

/** All active download entries whose modelKey belongs to `modelId` (its files). */
function entriesForModel(downloads: Record<string, DownloadEntry>, modelId: string): DownloadEntry[] {
  return Object.values(downloads).filter(
    e => e.modelKey.startsWith(`${modelId}/`) && isActiveStatus(e.status),
  );
}

export function aggregateActiveDownloads(
  downloads: Record<string, DownloadEntry>,
  modelId: string,
): AggregatedDownload {
  const active = entriesForModel(downloads, modelId);
  if (active.length === 0) {
    return { downloading: false, queued: false, count: 0, progress: 0 };
  }
  const transferring = active.filter(e => !isQueuedStatus(e.status));
  const downloaded = active.reduce((s, e) => s + e.bytesDownloaded + (e.mmProjBytesDownloaded ?? 0), 0);
  const total = active.reduce((s, e) => s + (e.combinedTotalBytes || e.totalBytes || 0), 0);
  return {
    downloading: transferring.length > 0,
    queued: transferring.length === 0, // entries exist but none transferring yet
    count: transferring.length,
    progress: total > 0 ? Math.min(1, downloaded / total) : (active[0].progress ?? 0),
    bytes: total > 0 ? { downloaded, total } : undefined,
  };
}
