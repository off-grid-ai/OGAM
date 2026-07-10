/**
 * RED-FLOW (UI, rendered) — D1 at the pixel: on the REAL DownloadManagerScreen, a failed image
 * extraction that was visible before an app-kill VANISHES after relaunch (no retriable card).
 *
 * Mounts the real screen over the download-native + FS fakes. Deterministic: the pre-relaunch render
 * shows the image card; simulateRelaunch() drops the native row + a fresh hydrate leaves the store empty,
 * so a re-render shows NO card — asserting the (correct) retriable card is present then fails → RED.
 */
import { installNativeBoundary, requireRTL } from '../../harness/nativeBoundary';

describe('D1 (rendered) — failed image extraction lost on relaunch', () => {
  it('keeps a retriable image-download card on the DownloadManager after relaunch', async () => {
    const boundary = installNativeBoundary({ download: true, fs: true });
    /* eslint-disable @typescript-eslint/no-var-requires */
    const React = require('react');
    const { render, waitFor } = requireRTL();
    const { hydrateDownloadStore } = require('../../../src/services/downloadHydration');
    const { DownloadManagerScreen } = require('../../../src/screens/DownloadManagerScreen');
    /* eslint-enable @typescript-eslint/no-var-requires */

    // Image zip downloaded (native 'completed', needs JS extraction); partial dir on disk.
    boundary.download!.seedActive({ downloadId: 'dl-img', fileName: 'anythingv5.zip', modelId: 'anythingv5', modelType: 'image', status: 'completed', bytesDownloaded: 900 * 1024 * 1024, totalBytes: 900 * 1024 * 1024 });
    boundary.fs!.seedFile('/docs/image-models/anythingv5/unet.bin', 300 * 1024 * 1024);
    await hydrateDownloadStore();

    // Before the kill: the DM shows the image download.
    const before = render(React.createElement(DownloadManagerScreen, {}));
    await waitFor(() => { expect(before.queryByText(/anythingv5\.zip/)).not.toBeNull(); });
    before.unmount();

    // Force-quit + relaunch: WorkManager pruned the completed row; disk survives; store rebuilt empty.
    boundary.download!.simulateRelaunch();
    await hydrateDownloadStore();

    const after = render(React.createElement(DownloadManagerScreen, {}));
    await waitFor(() => { expect(after.queryByText('Download Manager')).not.toBeNull(); }); // re-render proof

    // Correct: the incomplete image model is still surfaced (retriable). Today it vanishes → RED.
    expect(after.queryByText(/anythingv5/)).not.toBeNull();
  });
});
