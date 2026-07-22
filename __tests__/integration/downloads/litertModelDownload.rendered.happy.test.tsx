/** P1 #14 — download a curated LiteRT model through the real Models screen. */
import { renderMainApp } from '../../harness/appJourney';
import { GB } from '../../harness/nativeBoundary';

const MODEL_ID = 'offgrid/litert-recommended';
const FILE_NAME = 'gemma-4-E2B-it.litertlm';
const FILE_SIZE = 2588147712;
const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
});

describe('P1 LiteRT-model download journey', () => {
  it('downloads the curated artifact and renders it as a downloaded model', async () => {
    // Recommended GGUF metadata refreshes are incidental to the curated LiteRT
    // catalog, whose pinned files are owned locally and require no discovery HTTP.
    global.fetch = (async () => ({
      ok: false,
      json: async () => ({}),
    })) as unknown as typeof fetch;

    const { boundary, rtl, view } = await renderMainApp({
      boundary: {
        download: true,
        ram: { platform: 'android', totalBytes: 8 * GB, availBytes: 6 * GB },
      },
    });
    const { act, fireEvent, waitFor } = rtl;

    await act(async () => {
      fireEvent.press(view.getByTestId('models-tab'));
    });
    await waitFor(() => expect(view.getByText('Gemma 4 LiteRT')).toBeTruthy());

    await act(async () => {
      fireEvent.press(view.getByText('Gemma 4 LiteRT'));
    });
    await waitFor(() => expect(view.getByText('Gemma 4 E2B')).toBeTruthy());

    await act(async () => {
      fireEvent.press(view.getByTestId('file-card-0-download'));
    });
    await waitFor(() => expect(boundary.download!.active()).toHaveLength(1));

    const nativeRow = boundary.download!.active()[0];
    expect(nativeRow.fileName).toBe(FILE_NAME);
    expect(nativeRow.modelId).toBe(MODEL_ID);

    await act(async () => {
      // The device boundary reports the durable artifact exists. A small in-memory
      // payload avoids allocating the curated model's real 2.4 GiB in Jest; product
      // metadata and native completion still carry the exact declared byte count.
      boundary.fs!.seedFile(`/docs/models/${FILE_NAME}`, 1024);
      boundary.download!.events.emit('DownloadProgress', {
        downloadId: nativeRow.downloadId,
        fileName: FILE_NAME,
        modelId: MODEL_ID,
        bytesDownloaded: FILE_SIZE,
        totalBytes: FILE_SIZE,
        status: 'running',
      });
      boundary.download!.events.emit('DownloadComplete', {
        downloadId: nativeRow.downloadId,
        fileName: FILE_NAME,
        modelId: MODEL_ID,
        bytesDownloaded: FILE_SIZE,
        totalBytes: FILE_SIZE,
        status: 'completed',
        localUri: `/docs/models/${FILE_NAME}`,
      });
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    await waitFor(() => {
      expect(view.getAllByText('Success').length).toBeGreaterThan(0);
      expect(
        view.getAllByText(/downloaded successfully/i).length,
      ).toBeGreaterThan(0);
    });
    expect(view.queryByTestId('file-card-0-download')).toBeNull();
    expect(view.queryByTestId('file-card-0-cancel')).toBeNull();
  }, 30000);
});
