/** P1 #17 — an offline model download fails clearly and recovers through Retry. */
import { renderMainApp } from '../../harness/appJourney';
import { GB } from '../../harness/nativeBoundary';

const MODEL_ID = 'offgrid-tests/network-retry-model';
const FILE_NAME = 'network-retry-model-Q4_K_M.gguf';
const FILE_SIZE = 16 * 1024 * 1024;
const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
});

describe('P1 network-failure download journey', () => {
  it('shows an actionable network error and completes after the user retries', async () => {
    const model = {
      id: MODEL_ID,
      author: 'offgrid-tests',
      downloads: 1,
      likes: 1,
      tags: ['gguf'],
      lastModified: '2026-07-17T00:00:00.000Z',
      siblings: [],
    };
    global.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/models?')) {
        return {
          ok: true,
          json: async () =>
            url.includes('search=network-retry') ? [model] : [],
        } as Response;
      }
      if (url.endsWith(`/models/${MODEL_ID}/tree/main`)) {
        return {
          ok: true,
          json: async () => [
            { type: 'file', path: FILE_NAME, size: FILE_SIZE },
          ],
        } as Response;
      }
      return { ok: true, json: async () => model } as Response;
    }) as typeof fetch;

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
    await waitFor(() => expect(view.getByTestId('models-screen')).toBeTruthy());
    await act(async () => {
      fireEvent.changeText(view.getByTestId('search-input'), 'network-retry');
      fireEvent(view.getByTestId('search-input'), 'submitEditing');
      await new Promise(resolve => setTimeout(resolve, 600));
    });
    await waitFor(() =>
      expect(view.getByText('network-retry-model')).toBeTruthy(),
    );
    await act(async () => {
      fireEvent.press(view.getByText('network-retry-model'));
    });
    await waitFor(() =>
      expect(view.getByText('network-retry-model-Q4_K_M')).toBeTruthy(),
    );

    await act(async () => {
      fireEvent.press(view.getByTestId('file-card-0-download'));
    });
    await waitFor(() => expect(boundary.download!.active()).toHaveLength(1));
    const nativeRow = boundary.download!.active()[0];

    await act(async () => {
      boundary.download!.events.emit('DownloadError', {
        downloadId: nativeRow.downloadId,
        fileName: FILE_NAME,
        modelId: MODEL_ID,
        reason: 'network is unreachable',
        reasonCode: 'network_lost',
      });
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    await waitFor(() => {
      expect(
        view.getByText('Connection lost. Check your network and try again.'),
      ).toBeTruthy();
      expect(view.getByText('Retry')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(view.getByText('Retry'));
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    await waitFor(() => expect(view.queryByText('Retry')).toBeNull());

    await act(async () => {
      boundary.fs!.seedFile(`/docs/models/${FILE_NAME}`, FILE_SIZE);
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
      expect(view.queryByTestId('file-card-0-download')).toBeNull();
      expect(view.queryByTestId('file-card-0-cancel')).toBeNull();
    });
  }, 30000);
});
