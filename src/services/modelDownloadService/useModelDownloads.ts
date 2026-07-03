/**
 * useModelDownloads — the one reactive hook over ModelDownloadService that ANY
 * screen (Home, Chat, Settings, Download Manager) uses to reflect download state
 * live. It subscribes to the service (which is notified by every provider's own
 * reactive source — downloadStore / ttsStore) and re-lists on change, so a download
 * starting / progressing / completing / failing updates every screen at once from a
 * single source. No screen reads a per-type store for this any more.
 *
 * Notifies are coalesced (a short debounce) so rapid progress ticks don't re-scan
 * disk on every byte; the re-list still runs within ~200ms of any change.
 */
import { useEffect, useState } from 'react';
import { modelDownloadService } from './index';
import type { ModelDownload } from './types';

const COALESCE_MS = 200;

export function useModelDownloads(): ModelDownload[] {
  const [downloads, setDownloads] = useState<ModelDownload[]>([]);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const refresh = () => {
      modelDownloadService.list().then(list => { if (alive) setDownloads(list); }).catch(() => {});
    };
    const scheduleRefresh = () => {
      if (timer) return; // already a refresh pending — coalesce
      timer = setTimeout(() => { timer = null; refresh(); }, COALESCE_MS);
    };

    refresh(); // initial
    const unsub = modelDownloadService.subscribe(scheduleRefresh);
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      unsub();
    };
  }, []);

  return downloads;
}

/** Convenience: the active (in-progress) downloads only. */
export function useActiveModelDownloads(): ModelDownload[] {
  return useModelDownloads().filter(d => d.status === 'downloading' || d.status === 'queued' || d.status === 'paused');
}
