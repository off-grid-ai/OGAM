/**
 * The download a row stands for until it reaches the native downloader, so Retry can start it again.
 *
 * Every start publishes its row before the native start (which may wait for a slot, or be refused up
 * front: no space). Refused there, the row has no native download behind it, so there is nothing to
 * resume: a native retry of its id did nothing and the row sat at "pending" for good. Each start
 * remembers how to make itself here; the native start forgets it once a transfer exists (from then
 * on Retry resumes). Retry of a row that never started clears it and makes the same start again,
 * exactly as the first tap did. One owner for every model type: text and vision, zip and multi-file
 * image.
 *
 * In memory only: a row that never started has no native row, so it does not outlive the app either.
 */
import { useDownloadStore, type DownloadEntry } from '../stores/downloadStore';
import logger from '../utils/logger';

const starts = new Map<string, () => Promise<void>>();

/** The placeholder id of the row a start publishes before the native download exists. */
export const queuedPlaceholderId = (modelKey: string): string => `queued:${modelKey}`;

/** Remember how to make this start again, until a transfer for it exists. */
export function rememberStart(modelKey: string, start: () => Promise<void>): void {
  starts.set(modelKey, start);
}

/** A native transfer for this download now exists: Retry resumes it from here on. */
export function startReachedDownloader(modelKey: string | undefined): void {
  if (modelKey) starts.delete(modelKey);
}

/**
 * Retry of a row whose download never reached the downloader: clear the failed row and make the
 * start again (it runs on; Retry does not wait for the download). Returns false when a transfer
 * exists (the caller resumes it) or no start is known.
 */
export async function restartNeverStarted(entry: DownloadEntry): Promise<boolean> {
  const start = starts.get(entry.modelKey);
  if (!start) return false;
  useDownloadStore.getState().remove(entry.modelKey);
  // Not awaited: a start can run until the whole download is done (an image's separate files). It
  // records its own failure on its row (a phone still full says so again), as the first tap did.
  start().catch(err => logger.log(`[DL-SM] ${entry.modelKey} restart failed err=${err instanceof Error ? err.message : String(err)}`));
  return true;
}
