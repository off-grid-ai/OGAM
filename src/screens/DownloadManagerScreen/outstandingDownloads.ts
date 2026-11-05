import type { DownloadEntry } from '../../stores/downloadStore';
import { uniformDownloadId } from '../../services/modelDownloadService/uniformId';
import type { DownloadItem } from './items';
import { entryToActiveItem } from './downloadItemMapping';

/**
 * The ONE rule for "which downloads still need you": the Download Manager's Active list
 * renders these rows and the Models tab's downloads badge counts them, so the two can never
 * disagree (device: badge "4 in progress" over a list of 2 — the badge counted stale failed
 * store rows for models that were already downloaded).
 *
 * Pure: no hooks, no store reads, no IO. Callers pass whatever sources they hold.
 */

/** The uniform id a row routes and dedups on. */
export function downloadItemId(item: Pick<DownloadItem, 'modelType' | 'modelId'>): string {
  return uniformDownloadId(item.modelType, item.modelId);
}

export interface OutstandingDownloadSources {
  /** Download store rows, keyed by modelKey. */
  downloads: Record<string, DownloadEntry>;
  /** Models already on the phone. A downloaded model is authoritative over any leftover row. */
  completed: ReadonlyArray<Pick<DownloadItem, 'modelType' | 'modelId'>>;
  /** Starts waiting for a concurrency slot (no store row yet). */
  queued?: DownloadItem[];
  /** Voice (TTS/STT) rows; only their `active` rows count. */
  voice?: DownloadItem[];
  /** Search (embedding) rows; only their `active` rows count. */
  search?: DownloadItem[];
}

/**
 * One row per model that is downloading, queued, paused or failed and is NOT already
 * downloaded. A model that completed and was then re-started (a stale restore, a
 * re-download) would otherwise show as both a failed download and a downloaded model.
 */
export function outstandingDownloadItems(sources: OutstandingDownloadSources): DownloadItem[] {
  const completedIds = new Set(sources.completed.map(downloadItemId));
  const notDownloaded = (item: DownloadItem) => !completedIds.has(downloadItemId(item));

  const started = Object.values(sources.downloads)
    .filter(e => e.status !== 'completed' && e.status !== 'cancelled')
    .map(entryToActiveItem)
    .filter(notDownloaded);
  // Queued starts: skip any already started or already downloaded.
  const startedKeys = new Set(started.map(i => i.modelKey));
  const queued = (sources.queued ?? []).filter(
    q => !startedKeys.has(q.modelKey) && notDownloaded(q),
  );
  const voice = (sources.voice ?? []).filter(i => i.type === 'active' && notDownloaded(i));
  const search = (sources.search ?? []).filter(i => i.type === 'active');

  return [...started, ...queued, ...voice, ...search];
}
