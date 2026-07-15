/**
 * RED-FLOW (integration) — V3: an interrupted STT download is unrecoverable after relaunch.
 *
 * downloadStore is a plain create() (not persisted) and hydrateDownloadStore rebuilds it ONLY from the
 * native active rows (downloadHydration.ts:137). An app-kill drops the native row, and nothing scans disk
 * for the partial — so after relaunch the interrupted STT download vanishes from the Download Manager
 * (no failed entry, no retry). Integration boundary: only the background-download native (stateful,
 * relaunch-droppable) + filesystem are faked; the REAL hydrate + sttProvider.reconcile run.
 */
import { installNativeBoundary } from '../../harness/nativeBoundary';

describe('V3 — interrupted STT download lost on relaunch (red-flow)', () => {
  it('surfaces an interrupted STT download as a retriable entry after relaunch', async () => {
    const boundary = installNativeBoundary({ download: true, fs: true });
    /* eslint-disable @typescript-eslint/no-var-requires */
    const { hydrateDownloadStore } = require('../../../src/services/downloadHydration');
    const { sttProvider } = require('../../../src/services/modelDownloadService/providers/sttProvider');
    const { useDownloadStore } = require('../../../src/stores/downloadStore');
    /* eslint-enable @typescript-eslint/no-var-requires */

    // base.en is mid-download: a native row + a partial file on disk.
    boundary.download!.seedActive({ downloadId: 'dl-stt', fileName: 'ggml-base.en.bin', modelId: 'base.en', modelType: 'stt', status: 'running', bytesDownloaded: 40 * 1024 * 1024, totalBytes: 142 * 1024 * 1024 });
    boundary.fs!.seedFile('/docs/whisper-models/ggml-base.en.bin', 40 * 1024 * 1024);
    await hydrateDownloadStore();
    // Precondition: while running, the DM shows it.
    expect(Object.values(useDownloadStore.getState().downloads).some((e) => (e as { modelType: string }).modelType === 'stt')).toBe(true);

    // App is force-quit mid-download: the native row is lost (iOS URLSession semantics); disk survives.
    boundary.download!.simulateRelaunch();
    await hydrateDownloadStore();
    await sttProvider.reconcile();

    // Correct: the interrupted STT download is still visible (failed/retriable). Today it vanishes —
    // store not persisted + nothing scans disk → RED.
    const hasStt = Object.values(useDownloadStore.getState().downloads).some((e) => (e as { modelType: string }).modelType === 'stt');
    expect(hasStt).toBe(true);
  });
});
