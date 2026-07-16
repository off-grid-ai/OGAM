/**
 * RED-FLOW (integration) — D4: an iOS interrupted download leaves NO failed entry after app-kill.
 *
 * iOS URLSession discards its native row on app-kill; hydrate rebuilds the (non-persisted) store from
 * the native rows only, so a gone row = a vanished download with no user-visible failed/retriable entry.
 * Same non-persistence root as V3/D1, on the iOS text-model path. Integration boundary: only the
 * background-download native (relaunch-droppable) is faked; the REAL hydrate runs, Platform.OS = ios.
 */
import { installNativeBoundary } from '../../harness/nativeBoundary';

describe('D4 — iOS interrupted download leaves no failed entry (red-flow)', () => {
  it('surfaces an interrupted iOS download as a failed/retriable entry after app-kill', async () => {
    const boundary = installNativeBoundary({ download: true, ram: { platform: 'ios', totalBytes: 8 * 1024 ** 3, availBytes: 4 * 1024 ** 3 } });
    /* eslint-disable @typescript-eslint/no-var-requires */
    const { hydrateDownloadStore } = require('../../../src/services/downloadHydration');
    const { useDownloadStore } = require('../../../src/stores/downloadStore');
    /* eslint-enable @typescript-eslint/no-var-requires */

    boundary.download!.seedActive({ downloadId: 'dl-txt', fileName: 'gemma-4b.gguf', modelId: 'gemma-4b', modelType: 'text', status: 'running', bytesDownloaded: 2 * 1024 ** 3, totalBytes: 6 * 1024 ** 3 });
    await hydrateDownloadStore();
    expect(Object.keys(useDownloadStore.getState().downloads).length).toBe(1); // precondition: shown while running

    // iOS force-quit: URLSession drops the row entirely.
    boundary.download!.simulateRelaunch();
    await hydrateDownloadStore();

    // Correct: the stranded download survives as a failed/retriable entry. Today the store is empty →
    // the download silently vanished with no way to retry or remove → RED.
    expect(Object.keys(useDownloadStore.getState().downloads).length).toBeGreaterThan(0);
  });
});
