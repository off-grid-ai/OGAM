/**
 * RED-FLOW (UI, rendered) — V3 at the pixel: on the REAL DownloadManagerScreen, an interrupted STT
 * download visible before an app-kill VANISHES after relaunch (no retriable card). Mounts the real
 * screen over the download-native + FS fakes.
 */
import { installNativeBoundary, requireRTL } from '../../harness/nativeBoundary';
import type {MobileApplicationFixture} from '../../harness/mobileApplicationFixture';

let applicationFixture: MobileApplicationFixture | null = null;
afterEach(async () => {
  await applicationFixture?.dispose();
  applicationFixture = null;
});

describe('V3 (rendered) — interrupted STT download lost on relaunch', () => {
  it('keeps a retriable STT-download card on the DownloadManager after relaunch', async () => {
    const boundary = installNativeBoundary({ download: true, fs: true });
     
    const React = require('react');
    const { render, waitFor } = requireRTL();
    const {seedMobileDownloadJournal, startMobileApplicationFixture} = require('../../harness/mobileApplicationFixture') as typeof import('../../harness/mobileApplicationFixture');
    const { DownloadManagerScreen } = require('../../../src/screens/DownloadManagerScreen');
     

    boundary.download!.seedActive({ downloadId: 'dl-stt', fileName: 'ggml-base.en.bin', modelId: 'base.en', modelType: 'stt', status: 'running', bytesDownloaded: 40 * 1024 * 1024, totalBytes: 142 * 1024 * 1024 });
    await seedMobileDownloadJournal([{
      manifest: {id: 'dl-stt', modelId: 'base.en', kind: 'transcription', revision: 'main', artifacts: [{id: 'primary', name: 'ggml-base.en.bin', role: 'primary', required: true, localName: 'ggml-base.en.bin', url: 'https://example.com/ggml-base.en.bin'}]},
      phase: 'downloading', artifacts: [{artifactId: 'primary', phase: 'downloading', bytesDownloaded: 40 * 1024 * 1024, totalBytes: 142 * 1024 * 1024, transferId: 'dl-stt'}],
      createdAt: 1, updatedAt: 1, attempt: 1,
    }]);
    applicationFixture = await startMobileApplicationFixture();
    await applicationFixture.refreshModels();

    const before = render(React.createElement(DownloadManagerScreen, {}));
    await waitFor(() => { expect(before.queryByText(/ggml-base\.en\.bin/)).not.toBeNull(); });
    before.unmount();

    boundary.download!.simulateRelaunch();
    await applicationFixture.refreshModels();

    const after = render(React.createElement(DownloadManagerScreen, {}));
    await waitFor(() => { expect(after.queryByText('Download Manager')).not.toBeNull(); });

    // Correct: the interrupted STT download survives as a retriable card. Today it vanishes → RED.
    expect(after.queryByText(/ggml-base\.en\.bin/)).not.toBeNull();
  });
});
