/**
 * The SINGLE owner of "is this STT (Whisper) model downloading right now, and how far".
 *
 * Two surfaces render Whisper model rows — the Models screen's Transcription tab and the Home
 * "Speech" picker sheet — and they MUST agree. Previously each derived its own answer: the tab
 * read the canonical download tracker (downloadStore) with a whisper-store fallback, while the
 * picker read ONLY whisperStore.downloadProgressById. So a download tracked in the canonical store
 * (started elsewhere, or rehydrated after a relaunch) was invisible to the picker — it showed the
 * plain "download" icon with no progress while the tab showed the live bar (device 2026-07-15).
 *
 * This is that derivation, defined ONCE. The pure `deriveSttDownloadState` is zero-IO (unit-testable);
 * the hook wraps it over the two live stores. Both surfaces call the hook, so they can never disagree.
 */
import { useMemo } from 'react';
import { useWhisperStore } from '../stores/whisperStore';
import { useDownloadStore } from '../stores/downloadStore';
import { isActiveStatus, isQueuedStatus, isDownloadingStatus, type DownloadEntry } from '../utils/downloadStatus';

interface SttDownloadEntry {
  /** 0..1 transfer progress. */
  progress: number;
  /** In flight (downloading OR queued) — the row is busy and not tappable. */
  active: boolean;
  /** Bytes are transferring right now (show the percentage). */
  downloading: boolean;
  /** Waiting for a concurrency slot (show a clock, not 0%). */
  queued: boolean;
}

/** Whisper download-store ids are prefixed `whisper-`; the model ids the UI uses are bare. */
const bareWhisperId = (modelId: string): string =>
  modelId.startsWith('whisper-') ? modelId.slice('whisper-'.length) : modelId;

/**
 * PURE, zero-IO: merge the canonical download tracker with the whisper-store fallback into a
 * per-model in-flight map. The canonical store wins (it survives relaunch and reports failed as
 * inactive); the whisper store covers the RNFS URL-import path, which never creates a canonical
 * entry. A fallback entry still at 0% is WAITING for a slot → queued; once a byte lands (p>0) it
 * is transferring (without this, queued STT models rendered "0%" instead of "Queued").
 */
function deriveSttDownloadState(
  downloads: Record<string, DownloadEntry>,
  downloadProgressById: Record<string, number>,
): { byId: Record<string, SttDownloadEntry>; anyDownloading: boolean } {
  const byId: Record<string, SttDownloadEntry> = {};
  for (const e of Object.values(downloads)) {
    if (e.modelType !== 'stt') continue;
    byId[bareWhisperId(e.modelId)] = {
      progress: e.progress ?? 0,
      active: isActiveStatus(e.status),
      downloading: isDownloadingStatus(e.status),
      queued: isQueuedStatus(e.status),
    };
  }
  for (const [id, p] of Object.entries(downloadProgressById)) {
    if (id in byId) continue; // canonical entry wins
    byId[id] = { progress: p, active: true, downloading: p > 0, queued: p === 0 };
  }
  const anyDownloading = Object.values(byId).some((s) => s.active);
  return { byId, anyDownloading };
}

export interface UseSttDownloadState {
  /** In-flight state for one whisper model id, or undefined when not downloading. */
  stateFor: (whisperModelId: string) => SttDownloadEntry | undefined;
  /** True while any transcription model is actively downloading. */
  anyDownloading: boolean;
}

/** Subscribe both stores and expose the single derivation. */
export function useSttDownloadState(): UseSttDownloadState {
  const downloads = useDownloadStore((s) => s.downloads);
  const downloadProgressById = useWhisperStore((s) => s.downloadProgressById);
  const { byId, anyDownloading } = useMemo(
    () => deriveSttDownloadState(downloads, downloadProgressById),
    [downloads, downloadProgressById],
  );
  return useMemo(() => ({ stateFor: (id: string) => byId[id], anyDownloading }), [byId, anyDownloading]);
}
