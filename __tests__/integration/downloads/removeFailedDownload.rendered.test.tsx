import { installNativeBoundary, requireRTL, MB } from '../../harness/nativeBoundary';

describe('failed download removal', () => {
  it('removes a failed partial transfer after confirmation', async () => {
    const boundary = installNativeBoundary({ download: true, fs: true });
    const React = require('react');
    const { render, fireEvent, waitFor } = requireRTL();
    const { hydrateDownloadStore } = require('../../../src/services/downloadHydration');
    const { registerCoreDownloadProviders } = require('../../../src/services/modelDownloadService/registerProviders');
    const { DownloadManagerScreen } = require('../../../src/screens/DownloadManagerScreen');

    registerCoreDownloadProviders();
    boundary.download!.seedActive({
      downloadId: 'failed-partial', modelId: 'model-download:image:%5B%22example%22%5D',
      fileName: '0-gemma-4-E2B-it.litertlm', modelType: 'artifact', status: 'failed',
      bytesDownloaded: 1100 * MB, totalBytes: 2400 * MB, reason: 'Connection timed out.',
    });
    await hydrateDownloadStore();

    const screen = render(React.createElement(DownloadManagerScreen));
    fireEvent.press(await waitFor(() => screen.getByLabelText(/^Remove /)));
    fireEvent.press(await waitFor(() => screen.getByText('Yes')));

    await waitFor(() => expect(screen.queryByText('0-gemma-4-E2B-it.litertlm')).toBeNull(), { timeout: 5000 });
    expect(boundary.download!.active()).toHaveLength(0);
  });
});
