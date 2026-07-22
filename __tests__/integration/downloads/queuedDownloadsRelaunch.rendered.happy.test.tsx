/** P0 #187 — queued downloads survive a kill and return through the real Download Manager. */
import { renderMainApp } from '../../harness/appJourney';

const QUEUED_DOWNLOADS_KEY = '@offgrid/queued_downloads';

describe('P0 queued-download relaunch journey', () => {
  it('restores every requested model and keeps overflow queued behind the concurrency cap', async () => {
    const queued = ['a', 'b', 'c', 'd'].map(name => ({
      url: `https://example.com/offline/${name}.gguf`,
      fileName: `${name}.gguf`,
      modelId: `offline/${name}`,
      modelKey: `offline/${name}/${name}.gguf`,
      modelType: 'text' as const,
      quantization: 'Q4_K_M',
      totalBytes: 100,
      combinedTotalBytes: 100,
    }));

    const { boundary, rtl, view } = await renderMainApp({
      boundary: { download: true },
      beforeRender: async ({ asyncStorage }) => {
        await asyncStorage.setItem(
          QUEUED_DOWNLOADS_KEY,
          JSON.stringify(queued),
        );
      },
    });

    rtl.fireEvent.press(view.getByTestId('models-tab'));
    await rtl.waitFor(() =>
      expect(view.getByTestId('models-screen')).toBeTruthy(),
    );
    rtl.fireEvent.press(view.getByTestId('downloads-icon'));

    await rtl.waitFor(() =>
      expect(boundary.download!.active()).toHaveLength(3),
    );
    await rtl.act(async () => {
      for (const row of boundary.download!.active()) {
        boundary.download!.events.emit('DownloadProgress', {
          ...row,
          bytesDownloaded: 10,
          totalBytes: 100,
          status: 'running',
        });
      }
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    await rtl.waitFor(() => {
      for (const item of queued)
        expect(view.getByText(item.fileName)).toBeTruthy();
      expect(
        view.getByTestId('dm-active-downloading-count').props.children,
      ).toBe(3);
      expect(view.getByTestId('dm-active-queued-count').props.children).toEqual(
        [1, ' queued'],
      );
    });
  });
});
