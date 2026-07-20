import { renderMainApp } from '../../harness/appJourney';

// G5 (docs/RELEASE_571_GAP_FINDINGS.md): a multi-file image download (HuggingFace/CoreML) is driven
// by an in-process JS loop via per-file transfers — its synthetic key `image:<id>` has NO native
// download row. On a foreground resume hydrateDownloadStore -> strandInterruptedEntries sees an
// active entry whose key is absent from the native snapshot and rewrites it to "failed", even though
// the transfer is still running. The user's live download shows "failed — tap retry"; tapping Remove
// then abandons the running transfer and deletes the partial tree.

const ACTIVE_DOWNLOADS_KEY = '@offgrid/active_downloads';
const MODEL_ID = 'offgrid/sdxl-multifile';
const MODEL_KEY = `image:${MODEL_ID}`; // makeImageModelKey — synthetic, no native row

describe('G5 multi-file image download survives a foreground resume', () => {
  it('keeps a live multi-file image download in progress across background/foreground, not failed', async () => {
    const { boundary, rtl, view } = await renderMainApp({
      boundary: { download: true },
      beforeRender: async ({ asyncStorage }) => {
        // A multi-file image download that is actively running THIS session: its per-file transfers
        // are in flight (no native parent row) and its progress is persisted as it runs.
        await asyncStorage.setItem(
          ACTIVE_DOWNLOADS_KEY,
          JSON.stringify([
            {
              downloadId: `image-multi:${MODEL_ID}`,
              modelId: MODEL_ID,
              modelKey: MODEL_KEY,
              fileName: 'sdxl-multifile',
              modelType: 'image',
              status: 'running',
              bytesDownloaded: 400,
              totalBytes: 1000,
              combinedTotalBytes: 1000,
              progress: 0.4,
              createdAt: 100,
            },
          ]),
        );
        // The in-process JS loop is live (the real downloadHuggingFaceModel loop marks this on start).
        // require() post-resetModules so we touch the SAME registry instance the app will read.
        require('../../../src/services/inProcessDownloadRegistry').markDownloadInProcess(
          MODEL_KEY,
        );
      },
    });

    rtl.fireEvent.press(view.getByTestId('models-tab'));
    await rtl.waitFor(() =>
      expect(view.getByTestId('models-screen')).toBeTruthy(),
    );
    rtl.fireEvent.press(view.getByTestId('downloads-icon'));
    await rtl.waitFor(() =>
      expect(view.getByTestId(`active-download-${MODEL_ID}`)).toBeTruthy(),
    );

    // Background then foreground — the resume that triggers hydrateDownloadStore.
    await rtl.act(async () => {
      boundary.emitAppStateChange('background');
      boundary.emitAppStateChange('active');
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    // The live transfer must still be present and downloading — NOT flipped to a failed/retry card.
    await rtl.waitFor(() => {
      expect(view.getByTestId(`active-download-${MODEL_ID}`)).toBeTruthy();
      expect(view.queryByTestId('failed-retry-button')).toBeNull();
      expect(view.queryByTestId('failed-remove-button')).toBeNull();
      expect(view.queryByText('Needs attention')).toBeNull();
    });
  }, 30000);
});
