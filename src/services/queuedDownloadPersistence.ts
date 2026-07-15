/**
 * Durable persistence for the QUEUED (not-yet-started) download FIFO.
 *
 * Why this exists: a queued download — a start waiting for one of the 3 concurrency slots — lives ONLY
 * in memory (backgroundDownloadService.startQueue + a `pending` placeholder row in useDownloadStore).
 * Nothing durable is written for it, because the native Room DB (Android) / URLSession (iOS) only gets a
 * row once a download ACTUALLY starts. So an app kill drops every queued item and, on relaunch,
 * hydrateDownloadStore() (which rebuilds ONLY from native rows) can't bring them back → they vanish.
 *
 * The queue's OWNER (backgroundDownloadService) persists a SERIALIZABLE projection of its queue on every
 * mutation, and restoreQueuedDownloads() replays it on launch. The serialize is a PURE function (zero-IO,
 * unit-testable); the AsyncStorage read/write is a thin adapter here.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { DownloadParams } from './backgroundDownloadTypes';
import logger from '../utils/logger';

const QUEUED_DOWNLOADS_KEY = '@offgrid/queued_downloads';

/** The serializable projection of one queued start — JUST its DownloadParams (never the
 *  promise/resolve/reject, which are runtime-only and cannot survive a process restart). */
export type QueuedParams = DownloadParams;

/**
 * PURE: project the in-memory queue (records carrying a `params` field) to the serializable array a
 * relaunch can replay. Zero-IO — takes the queue, returns the params list. Sidecars are dependent
 * sub-downloads that never sit in the admission-controlled queue, so this only ever sees mains; it
 * defensively drops any isSidecar entry so restore can never re-issue an orphaned sidecar.
 */
export function serializeQueue(queue: ReadonlyArray<{ params: DownloadParams }>): QueuedParams[] {
  return queue.map((q) => q.params).filter((p) => !p.isSidecar);
}

/** Thin adapter: write the projection durably. Best-effort — never throws (a failed write must not
 *  wedge the queue), logged under [DL-SM] so a lost queue is diagnosable. */
export async function saveQueuedDownloads(params: QueuedParams[]): Promise<void> {
  try {
    if (params.length === 0) {
      await AsyncStorage.removeItem(QUEUED_DOWNLOADS_KEY);
    } else {
      await AsyncStorage.setItem(QUEUED_DOWNLOADS_KEY, JSON.stringify(params));
    }
  } catch (e) {
    logger.log(`[DL-SM] persist queued downloads failed err=${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Thin adapter: read the persisted projection. Returns [] on absence or a corrupt payload. */
export async function loadQueuedDownloads(): Promise<QueuedParams[]> {
  try {
    const stored = await AsyncStorage.getItem(QUEUED_DOWNLOADS_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? (parsed as QueuedParams[]) : [];
  } catch (e) {
    logger.log(`[DL-SM] load queued downloads failed err=${e instanceof Error ? e.message : String(e)}`);
    return [];
  }
}
