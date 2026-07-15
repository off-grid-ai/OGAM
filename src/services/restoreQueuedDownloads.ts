/**
 * Restore QUEUED (not-yet-started) downloads after an app relaunch.
 *
 * Sibling to downloadHydration.ts, which rebuilds the store from NATIVE rows (downloads that ACTUALLY
 * started). A queued item never started — it was waiting for one of the 3 concurrency slots and lived
 * ONLY in memory (backgroundDownloadService.startQueue + a placeholder store row), so hydrate can't
 * bring it back and it silently vanishes. backgroundDownloadService persists its queue durably on every
 * mutation (queuedDownloadPersistence); this replays that projection on launch so the product rule holds:
 * a download the user asked for NEVER disappears — it survives the kill and auto-resumes.
 *
 * Re-issue goes through the SAME real per-type start path the UI uses (via ModelDownloadService →
 * owning provider.reissue), which re-creates the `pending` store row + completion watch. It does NOT
 * call backgroundDownloadService.startDownload directly (that would skip the store row + watch). As
 * slots are free on a fresh launch, re-issued items auto-start up to the cap; the rest re-queue and
 * re-persist. The persisted queue is CLEARED as items are re-issued so a second relaunch can't
 * double-issue.
 */
import { modelDownloadService } from './modelDownloadService';
import { loadQueuedDownloads, saveQueuedDownloads } from './queuedDownloadPersistence';
import { useDownloadStore } from '../stores/downloadStore';
import { useAppStore } from '../stores';
import { makeModelKey } from '../utils/modelKey';
import logger from '../utils/logger';
import type { QueuedParams } from './queuedDownloadPersistence';

/** The stable per-model key for a persisted queued item — mirrors backgroundDownloadService.keyFor,
 *  and startModelDownload's makeModelKey(modelId, fileName) for text. */
function keyFor(p: QueuedParams): string {
  return p.modelKey ?? (p.modelId && p.fileName ? makeModelKey(p.modelId, p.fileName) : (p.modelId ?? p.fileName ?? p.url));
}

/** Already present as an in-flight/pending store row (a hydrated native row that DID start), or already
 *  a downloaded model on disk. Either way the queued item is stale — skip it (no double). */
function alreadyPresent(key: string): boolean {
  if (useDownloadStore.getState().downloads[key]) return true;
  return useAppStore.getState().downloadedModels.some((m) => m.id === key);
}

export async function restoreQueuedDownloads(): Promise<void> {
  const persisted = await loadQueuedDownloads();
  if (persisted.length === 0) return;

  // Clear the persisted queue BEFORE re-issuing: re-issuing a text start enqueues it again (if the cap
  // is full), which re-persists the still-waiting tail through the queue owner. Clearing first means the
  // rewritten queue reflects only what genuinely re-queued this launch — a second relaunch won't
  // double-issue an item that already started.
  await saveQueuedDownloads([]);

  logger.log(`[DL-SM] restoreQueuedDownloads found=${persisted.length}`);
  for (const params of persisted) {
    const key = keyFor(params);
    if (alreadyPresent(key)) {
      logger.log(`[DL-SM] restoreQueuedDownloads skip ${key}: already present`);
      continue;
    }
    // Dispatch WITHOUT awaiting: a reissue's promise resolves only when the download actually
    // STARTS (gets one of the 3 concurrency slots). On a relaunch where surviving WorkManager
    // transfers already hold every slot, that is minutes away — awaiting it serially hung the
    // app bootstrap ("loading forever") and, worse, items 2..N were never dispatched, so with
    // the persisted queue already cleared they were LOST (device log: found=11 → one dispatch →
    // found=1). The reissue path publishes the `pending` store row synchronously and re-enqueues
    // through the queue owner (which re-persists the waiting tail durably), so fire-and-forget
    // is both visible in the Download Manager immediately and kill-safe again.
    modelDownloadService.reissue(params).catch((e) => {
      logger.log(`[DL-SM] restoreQueuedDownloads reissue failed key=${key} err=${e instanceof Error ? e.message : String(e)}`);
    });
  }
}
