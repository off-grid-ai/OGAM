/**
 * P1 #7 — download a vision GGUF and its projector through the real Models screen.
 *
 * The test keeps Hugging Face discovery, projector pairing, download orchestration,
 * model registration, stores, persistence, and rendered state real. Only HTTP and
 * native device boundaries (background download, filesystem, and RAM) are faked.
 */
import { renderMainApp } from '../../harness/appJourney';
import { GB } from '../../harness/nativeBoundary';

const MODEL_ID = 'offgrid-tests/vision-model';
const MAIN_FILE = 'vision-model-Q4_K_M.gguf';
const MAIN_SIZE = 16 * 1024 * 1024;
const PROJECTOR_SOURCE_FILE = 'mmproj-F16.gguf';
const PROJECTOR_SIZE = 4 * 1024 * 1024;
const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
});

describe('P1 vision-model download journey', () => {
  it('downloads the GGUF and matching mmproj before rendering the model as downloaded', async () => {
    const model = {
      id: MODEL_ID,
      author: 'offgrid-tests',
      downloads: 1,
      likes: 1,
      tags: ['gguf', 'vision'],
      lastModified: '2026-07-16T00:00:00.000Z',
      siblings: [],
    };

    global.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/models?')) {
        return {
          ok: true,
          json: async () =>
            url.includes('search=vision-model') ? [model] : [],
        } as Response;
      }
      if (url.endsWith(`/models/${MODEL_ID}/tree/main`)) {
        return {
          ok: true,
          json: async () => [
            { type: 'file', path: MAIN_FILE, size: MAIN_SIZE },
            {
              type: 'file',
              path: PROJECTOR_SOURCE_FILE,
              size: PROJECTOR_SIZE,
            },
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
      fireEvent.changeText(view.getByTestId('search-input'), 'vision-model');
      fireEvent(view.getByTestId('search-input'), 'submitEditing');
      await new Promise(resolve => setTimeout(resolve, 600));
    });
    await waitFor(() => expect(view.getByText('vision-model')).toBeTruthy());

    await act(async () => {
      fireEvent.press(view.getByText('vision-model'));
    });
    await waitFor(() => {
      expect(view.getByText('vision-model-Q4_K_M')).toBeTruthy();
      expect(view.getByText(/Vision files include mmproj/)).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(view.getByTestId('file-card-0-download'));
    });
    await waitFor(() => expect(boundary.download!.active()).toHaveLength(2));

    const rows = boundary.download!.active();
    const projectorRow = rows.find(row => /mmproj/i.test(row.fileName ?? ''));
    const mainRow = rows.find(row => row.fileName === MAIN_FILE);
    expect(projectorRow).toBeTruthy();
    expect(mainRow).toBeTruthy();

    await act(async () => {
      boundary.fs!.seedFile(
        `/docs/models/${projectorRow!.fileName}`,
        PROJECTOR_SIZE,
      );
      boundary.download!.events.emit('DownloadProgress', {
        downloadId: projectorRow!.downloadId,
        fileName: projectorRow!.fileName,
        modelId: MODEL_ID,
        bytesDownloaded: PROJECTOR_SIZE,
        totalBytes: PROJECTOR_SIZE,
        status: 'running',
      });
      boundary.download!.events.emit('DownloadComplete', {
        downloadId: projectorRow!.downloadId,
        fileName: projectorRow!.fileName,
        modelId: MODEL_ID,
        bytesDownloaded: PROJECTOR_SIZE,
        totalBytes: PROJECTOR_SIZE,
        status: 'completed',
        localUri: `/docs/models/${projectorRow!.fileName}`,
      });
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    // Finishing the sidecar alone must not present the logical model download as complete.
    expect(view.queryByText(/downloaded successfully/i)).toBeNull();

    await act(async () => {
      boundary.fs!.seedFile(`/docs/models/${MAIN_FILE}`, MAIN_SIZE);
      boundary.download!.events.emit('DownloadProgress', {
        downloadId: mainRow!.downloadId,
        fileName: MAIN_FILE,
        modelId: MODEL_ID,
        bytesDownloaded: MAIN_SIZE,
        totalBytes: MAIN_SIZE,
        status: 'running',
      });
      boundary.download!.events.emit('DownloadComplete', {
        downloadId: mainRow!.downloadId,
        fileName: MAIN_FILE,
        modelId: MODEL_ID,
        bytesDownloaded: MAIN_SIZE,
        totalBytes: MAIN_SIZE,
        status: 'completed',
        localUri: `/docs/models/${MAIN_FILE}`,
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
