/** A failed STT download is removed through the real App and provider routing. */
import { renderMainApp } from '../../harness/appJourney';

describe('rendered STT download removal routing', () => {
  it('removes the canonical Whisper row and cancels its native transfer', async () => {
    const { boundary, rtl, view } = await renderMainApp({
      boundary: { download: true },
      beforeRender: ({ boundary: device }) => {
        device.download!.seedActive({
          downloadId: 'dl-stt-medium',
          fileName: 'ggml-medium.en.bin',
          modelId: 'whisper-medium.en',
          modelType: 'stt',
          status: 'failed',
          bytesDownloaded: 48 * 1024 * 1024,
          totalBytes: 1536 * 1024 * 1024,
        });
      },
    });
    const { useDownloadStore } = require('../../../src/stores/downloadStore');

    rtl.fireEvent.press(view.getByTestId('models-tab'));
    await rtl.waitFor(() =>
      expect(view.getByTestId('models-screen')).toBeTruthy(),
    );
    rtl.fireEvent.press(view.getByTestId('downloads-icon'));
    await rtl.waitFor(() => {
      expect(view.getByTestId('downloaded-models-screen')).toBeTruthy();
      expect(view.getByText('ggml-medium.en.bin')).toBeTruthy();
      expect(view.getByTestId('failed-remove-button')).toBeTruthy();
    });

    rtl.fireEvent.press(view.getByTestId('failed-remove-button'));
    await rtl.waitFor(() =>
      expect(view.getByText('Remove Download')).toBeTruthy(),
    );
    await rtl.act(async () => {
      rtl.fireEvent.press(view.getByText('Yes'));
      await Promise.resolve();
    });

    await rtl.waitFor(() => {
      expect(boundary.download!.module.cancelDownload).toHaveBeenCalledWith(
        'dl-stt-medium',
      );
      expect(boundary.download!.active()).toHaveLength(0);
      expect(Object.keys(useDownloadStore.getState().downloads)).toHaveLength(
        0,
      );
    });
    await rtl.waitFor(() =>
      expect(view.queryByText('ggml-medium.en.bin')).toBeNull(),
    );

    view.unmount();
  });
});
