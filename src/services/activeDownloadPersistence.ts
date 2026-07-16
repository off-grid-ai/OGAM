/**
 * Durable persistence for IN-FLIGHT downloads (running/processing), so a cold app-kill can strand
 * them as failed/retriable cards instead of letting them vanish.
 *
 * Why this exists (device 2026-07-15): downloadStore is not persisted, and hydrateDownloadStore()
 * rebuilds only from native rows. On iOS a hard app-kill drops the URLSession task, so an in-flight
 * download has no native row on relaunch AND no in-memory entry — strandInterruptedEntries (which read
 * only the in-memory store) had nothing to carry forward, so the download disappeared entirely.
 * (Android's WorkManager row SURVIVES a kill and reappears in the native snapshot, so nothing is ever
 * stranded there — this persistence is platform-neutral and changes no Android behaviour.)
 *
 * Scope: only ACTIVE-but-NOT-QUEUED entries. Queued (pending) starts are already persisted+replayed by
 * queuedDownloadPersistence/restoreQueuedDownloads; persisting them here too would double-handle them.
 * Written on SET/STATUS change only (never on byte-progress ticks), the same low cadence as the queue.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useDownloadStore } from '../stores/downloadStore';
import { isActiveStatus, isQueuedStatus, type DownloadEntry } from '../utils/downloadStatus';
import type { ModelKey } from '../utils/modelKey';
import logger from '../utils/logger';

const ACTIVE_DOWNLOADS_KEY = '@offgrid/active_downloads';

/** PURE: the in-flight subset worth persisting — active (running/processing) but NOT queued (the
 *  queue owns its own persistence) and not terminal (completed/failed/cancelled). Zero-IO. */
function serializeActiveDownloads(downloads: Record<ModelKey, DownloadEntry>): DownloadEntry[] {
  return Object.values(downloads).filter((e) => isActiveStatus(e.status) && !isQueuedStatus(e.status));
}

/** Thin adapter: write the projection durably. Best-effort — never throws (a failed write must not
 *  wedge downloads), logged under [DL-SM] so a lost snapshot is diagnosable. */
export async function saveActiveDownloads(entries: DownloadEntry[]): Promise<void> {
  try {
    if (entries.length === 0) await AsyncStorage.removeItem(ACTIVE_DOWNLOADS_KEY);
    else await AsyncStorage.setItem(ACTIVE_DOWNLOADS_KEY, JSON.stringify(entries));
  } catch (e) {
    logger.log(`[DL-SM] persist active downloads failed err=${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Thin adapter: read the persisted projection. Returns [] on absence or a corrupt payload. */
export async function loadActiveDownloads(): Promise<DownloadEntry[]> {
  try {
    const stored = await AsyncStorage.getItem(ACTIVE_DOWNLOADS_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? (parsed as DownloadEntry[]) : [];
  } catch (e) {
    logger.log(`[DL-SM] load active downloads failed err=${e instanceof Error ? e.message : String(e)}`);
    return [];
  }
}

let subscribed = false;
let lastSignature = '';

/**
 * Subscribe the download store and persist the in-flight set whenever its membership/status changes —
 * NOT on byte-progress ticks (the signature is keys+status only, so a running download's progress
 * updates don't churn AsyncStorage). Idempotent; call once at launch.
 */
export function initActiveDownloadPersistence(): void {
  if (subscribed) return;
  subscribed = true;
  useDownloadStore.subscribe((state) => {
    const active = serializeActiveDownloads(state.downloads);
    const signature = active.map((e) => `${e.modelKey}:${e.status}`).sort().join('|');
    if (signature === lastSignature) return;
    lastSignature = signature;
    saveActiveDownloads(active).catch(() => { /* saveActiveDownloads already logs; never throws */ });
  });
}
