/**
 * RED-FLOW (UI, rendered) — V3 at the pixel: on the REAL DownloadManagerScreen, an interrupted STT
 * download visible before an app-kill VANISHES after relaunch (no retriable card). Mounts the real
 * screen over the download-native + FS fakes.
 */
import { installNativeBoundary, requireRTL } from '../../harness/nativeBoundary';

describe('V3 (rendered) — interrupted STT download lost on relaunch', () => {
  it('keeps a retriable STT-download card on the DownloadManager after relaunch', async () => {
    const boundary = installNativeBoundary({ download: true, fs: true });
    /* eslint-disable @typescript-eslint/no-var-requires */
    const React = require('react');
    const { render, waitFor } = requireRTL();
    const { hydrateDownloadStore } = require('../../../src/services/downloadHydration');
    const { DownloadManagerScreen } = require('../../../src/screens/DownloadManagerScreen');
    /* eslint-enable @typescript-eslint/no-var-requires */

    boundary.download!.seedActive({ downloadId: 'dl-stt', fileName: 'ggml-base.en.bin', modelId: 'base.en', modelType: 'stt', status: 'running', bytesDownloaded: 40 * 1024 * 1024, totalBytes: 142 * 1024 * 1024 });
    await hydrateDownloadStore();

    const before = render(React.createElement(DownloadManagerScreen, {}));
    await waitFor(() => { expect(before.queryByText(/ggml-base\.en\.bin/)).not.toBeNull(); });
    before.unmount();

    boundary.download!.simulateRelaunch();
    await hydrateDownloadStore();

    const after = render(React.createElement(DownloadManagerScreen, {}));
    await waitFor(() => { expect(after.queryByText('Download Manager')).not.toBeNull(); });

    // Correct: the interrupted STT download survives as a retriable card. Today it vanishes → RED.
    expect(after.queryByText(/ggml-base\.en\.bin/)).not.toBeNull();
  });
});
