import { useCallback, useMemo } from 'react';
import {
  isModelDownloadInProgress,
  type TranscriptionModelsSnapshot,
} from '@offgrid/application';

export interface SttDownloadEntry {
  readonly progress: number;
  readonly active: boolean;
  readonly downloading: boolean;
  readonly queued: boolean;
  readonly currentBytes?: number;
  readonly totalBytes?: number;
  readonly bytesPerSecond?: number;
}

export interface UseSttDownloadState {
  stateFor: (whisperModelId: string) => SttDownloadEntry | undefined;
  anyDownloading: boolean;
}

/**
 * The Models facade is the only download projection. No Mobile store merges or repairs a second
 * progress record. Every transcription surface therefore sees the same row and phase.
 */
export function useSttDownloadState(
  projection: TranscriptionModelsSnapshot,
): UseSttDownloadState {
  const byId = useMemo(() => Object.fromEntries(
    projection.models.flatMap(row => {
      const download = row.download;
      if (!download) return [];
      const active = isModelDownloadInProgress(download.status);
      return [[row.catalog.id, {
        progress: download.totalBytes > 0
          ? download.bytesDownloaded / download.totalBytes
          : 0,
        active,
        downloading: download.status === 'downloading',
        queued: download.status === 'queued',
        currentBytes: download.bytesDownloaded,
        totalBytes: download.totalBytes || undefined,
      } satisfies SttDownloadEntry]];
    }),
  ), [projection.models]);
  const stateFor = useCallback(
    (modelId: string) => byId[modelId],
    [byId],
  );
  return useMemo(() => ({
    stateFor,
    anyDownloading: Object.values(byId).some(state => state.active),
  }), [byId, stateFor]);
}
