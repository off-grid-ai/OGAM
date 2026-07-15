/**
 * RED-FLOW (UI, rendered) — D4 at the pixel: on the REAL DownloadManagerScreen (iOS), a running text-
 * model download visible before an app-kill leaves NO failed/retriable card after relaunch (URLSession
 * drops its row). Mounts the real screen over the download-native fake, Platform.OS = ios.
 */
import { installNativeBoundary, requireRTL } from '../../harness/nativeBoundary';

describe('D4 (rendered) — iOS interrupted download leaves no failed card', () => {
  it('keeps a failed/retriable download card on the DownloadManager after an iOS app-kill', async () => {
    const boundary = installNativeBoundary({ download: true, ram: { platform: 'ios', totalBytes: 8 * 1024 ** 3, availBytes: 4 * 1024 ** 3 } });
    /* eslint-disable @typescript-eslint/no-var-requires */
    const React = require('react');
    const { render, waitFor } = requireRTL();
    const { hydrateDownloadStore } = require('../../../src/services/downloadHydration');
    const { DownloadManagerScreen } = require('../../../src/screens/DownloadManagerScreen');
    /* eslint-enable @typescript-eslint/no-var-requires */

    boundary.download!.seedActive({ downloadId: 'dl-txt', fileName: 'gemma-4b.gguf', modelId: 'gemma-4b', modelType: 'text', status: 'running', bytesDownloaded: 2 * 1024 ** 3, totalBytes: 6 * 1024 ** 3 });
    await hydrateDownloadStore();

    const before = render(React.createElement(DownloadManagerScreen, {}));
    await waitFor(() => { expect(before.queryByText(/gemma-4b\.gguf/)).not.toBeNull(); });
    before.unmount();

    boundary.download!.simulateRelaunch(); // iOS URLSession drops the row
    await hydrateDownloadStore();

    const after = render(React.createElement(DownloadManagerScreen, {}));
    await waitFor(() => { expect(after.queryByText('Download Manager')).not.toBeNull(); });

    // Correct: the stranded download survives as a failed/retriable card. Today it vanishes → RED.
    expect(after.queryByText(/gemma-4b\.gguf/)).not.toBeNull();
  });
});
