/**
 * Download-status classification + the DownloadEntry shape — the pure, zero-IO core of the
 * download subsystem. Lives here (not in the store) so pure consumers (e.g. downloadAggregate)
 * can use it without importing the store, which would make a util depend on a store (the
 * utils-stay-pure layering violation). The store imports and RE-EXPORTS these for back-compat,
 * so existing `from '../stores/downloadStore'` importers keep working.
 */
import { ModelKey } from './modelKey';
import type { ProgressRateSample } from '@offgrid/ui';
import {
  decodeDownloadLifecyclePhase,
  isActiveDownloadStatus,
  isFailedDownloadStatus,
  isQueuedDownloadStatus,
  isTransferringDownloadStatus,
  type DownloadLifecyclePhase,
  type PublicDownloadInfo,
} from '@offgrid/models';

/** Shared owns the durable lifecycle vocabulary stored by Mobile. */
export type DownloadStatus = DownloadLifecyclePhase

type ModelType = 'text' | 'image' | 'stt' | 'tts'

export interface DownloadEntry {
  modelKey: ModelKey
  downloadId: string
  modelId: string
  fileName: string
  quantization: string
  modelType: ModelType
  status: PublicDownloadInfo['status']
  bytesDownloaded: number
  totalBytes: number
  combinedTotalBytes: number
  progress: number
  /** Last valid byte observation. The canonical store owns rate sampling, not each view. */
  rateSample?: ProgressRateSample
  /** Live byte rate measured between canonical progress events. */
  bytesPerSecond?: number
  mmProjDownloadId?: string
  mmProjBytesDownloaded?: number
  mmProjStatus?: DownloadStatus
  /** The role of the file currently transferring, as Shared publishes it. Never name-inferred. */
  currentFileRole?: PublicDownloadInfo['currentFileRole']
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
export function isActiveStatus(status?: string | null): boolean {
  return isActiveDownloadStatus(status);
}

/**
 * A failed/retriable download. It is NOT active, but it still NEEDS the user (retry or
 * remove) — so surfaces that answer "is there download work outstanding?" (the Download
 * Manager badge + count) must include it. Device 2026-07-15: failed downloads never showed
 * on the icon badge, so a stuck download had no signal to open the manager.
 */
export function isFailedStatus(status?: string | null): boolean {
  return isFailedDownloadStatus(status);
}

/**
 * The ONE download-state classification every view must use. `isActiveStatus`
 * lumps queued (`pending`) in with actively-transferring rows; these split that
 * so a queued item renders the clock (not "downloading 0%") and an "active"
 * count can separate the two — consistently across every tab, the card, the
 * Download Manager count, and the badge. Never re-derive `status === 'pending'`
 * inline in a view; call these so the classification can't drift per-surface.
 */
export function isQueuedStatus(status?: string | null): boolean {
  return isQueuedDownloadStatus(status);
}

export function isDownloadingStatus(status?: string | null): boolean {
  return isTransferringDownloadStatus(status);
}

/**
 * A download a PERSON paused. Distinct from queued and from failed, and it must render as its
 * own thing: Shared classifies `paused` as active (so a paused row still blocks a duplicate
 * start) but neither queued nor transferring nor failed, so without this a paused row falls
 * through every branch and reads as a stalled download the user cannot explain.
 *
 * Decoded through Shared rather than compared to a literal here, so the vocabulary stays in one
 * place and legacy spellings (`waiting_for_network` -> `paused`) map the same way everywhere.
 */
export function isPausedStatus(status?: string | null): boolean {
  return decodeDownloadLifecyclePhase(status) === 'paused';
}

/** The role Shared publishes for the file currently transferring. Shared's type, not a copy. */
export type DownloadFileRole = PublicDownloadInfo['currentFileRole'];

/**
 * What to call the file a multi-file model is currently fetching.
 *
 * The ROLE is data Shared publishes; this never inspects the file NAME. A filename regex is
 * exactly the guessing this replaced - it broke on every renamed or unconventional projector,
 * and it silently mislabelled files it half-matched. An unknown or absent role falls back to
 * the real file name rather than inventing a description of it.
 */
export function downloadFileRoleLabel(role: DownloadFileRole, fileName: string): string {
  return role === 'mmproj' ? 'Vision support' : fileName;
}
