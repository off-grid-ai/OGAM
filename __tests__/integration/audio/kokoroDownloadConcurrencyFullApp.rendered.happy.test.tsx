/** P2 #189 — Kokoro shares the global three-download admission cap. */
import { renderMainApp } from '../../harness/appJourney';
import { GB } from '../../harness/nativeBoundary';

describe('P2 full-App Kokoro download admission', () => {
  it('shows Voice queued behind three active native downloads, then starts after one completes', async () => {
    const { rtl, view } = await renderMainApp({
      boundary: {
        download: true,
        ram: { platform: 'android', totalBytes: 16 * GB, availBytes: 14 * GB },
      },
      beforeRender: ({ boundary: native }) => {
        for (let index = 1; index <= 3; index += 1) {
          native.download!.seedActive({
            downloadId: `active-${index}`,
            fileName: `model-${index}.gguf`,
            modelId: `test/model-${index}`,
            modelType: 'text',
            status: 'running',
            bytesDownloaded: 100,
            totalBytes: 1000,
          });
        }
      },
    });

    rtl.fireEvent.press(view.getByTestId('models-tab'));
    await rtl.waitFor(() =>
      expect(view.getByTestId('models-screen')).toBeTruthy(),
    );
    rtl.fireEvent.press(view.getByTestId('voice-models-tab'));
    rtl.fireEvent.press(
      await rtl.waitFor(() => view.getByText('Download voice')),
    );

    const {
      BareResourceFetcher,
    } = require('react-native-executorch-bare-resource-fetcher');
    const fetchResources = BareResourceFetcher.fetch as jest.Mock;
    await rtl.act(async () => {
      await new Promise(resolve => setTimeout(resolve, 100));
    });
    expect(fetchResources).toHaveBeenCalledTimes(0);

    rtl.fireEvent.press(view.getByTestId('downloads-icon'));
    await rtl.waitFor(() => {
      expect(
        rtl
          .within(view.getByTestId('active-download-kokoro'))
          .getByLabelText('Queued'),
      ).toBeTruthy();
      expect(view.getByTestId('dm-active-queued-count')).toHaveTextContent(
        /1 queued/,
      );
      expect(view.getByTestId('dm-active-downloading-count')).toHaveTextContent(
        '3',
      );
    });

    // Native terminal boundary: one transfer frees its real service slot. The
    // queued Pro fetch must be admitted immediately; it never bypasses the cap.
    const {
      backgroundDownloadService,
    } = require('../../../src/services/backgroundDownloadService');
    await backgroundDownloadService.cancelDownload('active-1');
    await rtl.waitFor(() => expect(fetchResources).toHaveBeenCalledTimes(1));
    view.unmount();
  }, 30000);
});
