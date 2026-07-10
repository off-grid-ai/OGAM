/**
 * RED-FLOW (integration) — D1 (=B7): a failed image-model extraction is lost on relaunch.
 *
 * An image download completes natively, then JS-side extraction fails; the same session shows a
 * retriable card. But downloadStore isn't persisted and hydrateDownloadStore rebuilds only from native
 * active rows — a completed-then-failed transfer has no active row on relaunch (and imageProvider.list
 * doesn't scan disk for the incomplete dir), so the model disappears with no retry/remove. Integration
 * boundary: only the background-download native (relaunch-droppable) + filesystem are faked.
 */
import { installNativeBoundary } from '../../harness/nativeBoundary';

describe('D1 — failed image extraction lost on relaunch (red-flow)', () => {
  it('keeps a failed/incomplete image model visible + retriable after relaunch', async () => {
    const boundary = installNativeBoundary({ download: true, fs: true });
    /* eslint-disable @typescript-eslint/no-var-requires */
    const { hydrateDownloadStore } = require('../../../src/services/downloadHydration');
    const { useDownloadStore } = require('../../../src/stores/downloadStore');
    /* eslint-enable @typescript-eslint/no-var-requires */

    // The image zip downloaded (native 'completed'); a partially-extracted dir sits on disk.
    boundary.download!.seedActive({ downloadId: 'dl-img', fileName: 'anythingv5.zip', modelId: 'anythingv5', modelType: 'image', status: 'completed', bytesDownloaded: 900 * 1024 * 1024, totalBytes: 900 * 1024 * 1024 });
    boundary.fs!.seedFile('/docs/image-models/anythingv5/unet.bin', 300 * 1024 * 1024);
    await hydrateDownloadStore();
    // Precondition: the completed-needs-extraction image download is shown (mapped to 'processing').
    expect(Object.values(useDownloadStore.getState().downloads).some((e) => (e as { modelType: string }).modelType === 'image')).toBe(true);

    // Force-quit + relaunch: WorkManager pruned the completed row; the partial dir survives on disk.
    boundary.download!.simulateRelaunch();
    await hydrateDownloadStore();

    // Correct: the incomplete image model is still surfaced (retriable/removable). Today it vanishes —
    // store not persisted + imageProvider.list/hydrate never scan disk → RED.
    const hasImage = Object.values(useDownloadStore.getState().downloads).some((e) => (e as { modelType: string }).modelType === 'image');
    expect(hasImage).toBe(true);
  });
});
