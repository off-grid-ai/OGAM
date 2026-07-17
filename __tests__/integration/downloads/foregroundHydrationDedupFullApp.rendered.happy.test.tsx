import { renderMainApp } from '../../harness/appJourney';

const ACTIVE_DOWNLOADS_KEY = '@offgrid/active_downloads';
const MODEL_ID = 'offgrid/hydration-model';
const FILE_NAME = 'hydration-model-Q4_K_M.gguf';
const MODEL_KEY = `${MODEL_ID}/${FILE_NAME}`;

describe('APP-P1-004 foreground download hydration', () => {
  it('deduplicates native and persisted rows without regressing newer visible progress', async () => {
    const { boundary, rtl, view } = await renderMainApp({
      boundary: { download: true },
      beforeRender: async ({ boundary: device, asyncStorage }) => {
        await asyncStorage.setItem(
          ACTIVE_DOWNLOADS_KEY,
          JSON.stringify([
            {
              downloadId: 'persisted-old',
              modelId: MODEL_ID,
              modelKey: MODEL_KEY,
              fileName: FILE_NAME,
              quantization: 'Q4_K_M',
              modelType: 'text',
              status: 'running',
              bytesDownloaded: 100,
              totalBytes: 1000,
              combinedTotalBytes: 1000,
              progress: 0.1,
              createdAt: 50,
            },
          ]),
        );
        device.download!.seedActive({
          downloadId: 'native-old',
          modelId: MODEL_ID,
          modelKey: MODEL_KEY,
          fileName: FILE_NAME,
          modelType: 'text',
          status: 'running',
          bytesDownloaded: 150,
          totalBytes: 1000,
          combinedTotalBytes: 1000,
          createdAt: 100,
        });
        device.download!.seedActive({
          downloadId: 'native-current',
          modelId: MODEL_ID,
          modelKey: MODEL_KEY,
          fileName: FILE_NAME,
          modelType: 'text',
          status: 'running',
          bytesDownloaded: 300,
          totalBytes: 1000,
          combinedTotalBytes: 1000,
          createdAt: 200,
        });
      },
    });

    rtl.fireEvent.press(view.getByTestId('models-tab'));
    await rtl.waitFor(() =>
      expect(view.getByTestId('models-screen')).toBeTruthy(),
    );
    rtl.fireEvent.press(view.getByTestId('downloads-icon'));
    await rtl.waitFor(() => {
      expect(view.getAllByTestId('remove-download-button')).toHaveLength(1);
      expect(view.getByText(FILE_NAME)).toBeTruthy();
      expect(view.getByText('300 B / 1000 B')).toBeTruthy();
    });

    await rtl.act(async () => {
      boundary.download!.events.emit('DownloadProgress', {
        downloadId: 'native-current',
        modelId: MODEL_ID,
        modelKey: MODEL_KEY,
        fileName: FILE_NAME,
        status: 'running',
        bytesDownloaded: 700,
        totalBytes: 1000,
      });
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    await rtl.waitFor(() =>
      expect(view.getByText('700 B / 1000 B')).toBeTruthy(),
    );

    await rtl.act(async () => {
      boundary.emitAppStateChange('background');
      boundary.emitAppStateChange('active');
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    await rtl.waitFor(() => {
      expect(view.getAllByTestId('remove-download-button')).toHaveLength(1);
      expect(view.getByText('700 B / 1000 B')).toBeTruthy();
      expect(view.queryByText('300 B / 1000 B')).toBeNull();
    });
  }, 30000);
});
