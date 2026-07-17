/**
 * P1 #20 — killing the process during image archive extraction must not publish a
 * half-ready model or lose the transfer. The journey starts from the rendered
 * catalog, crosses the native download/archive boundaries, then launches a fresh
 * App module graph over only the durable storage + filesystem artifacts a device
 * retains after process death.
 */
import { relaunchMainApp, renderMainApp } from '../../harness/appJourney';
import { GB } from '../../harness/nativeBoundary';

const ACTIVE_DOWNLOADS_KEY = '@offgrid/active_downloads';
const MODEL_ID = 'anythingv5_cpu';
const FILE_NAME = `${MODEL_ID}.zip`;
const ARCHIVE_SIZE = 24 * 1024 * 1024;
const IMAGE_MODELS_DIR = '/docs/image_models';
const MODEL_DIR = `${IMAGE_MODELS_DIR}/${MODEL_ID}`;
const ZIP_PATH = `${IMAGE_MODELS_DIR}/${FILE_NAME}`;
const originalFetch = global.fetch;

function installImageCatalogFixture(): void {
  global.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/api/models/xororz/sd-mnn/tree/main')) {
      return {
        ok: true,
        json: async () => [
          { type: 'file', path: 'AnythingV5.zip', size: ARCHIVE_SIZE },
        ],
      } as Response;
    }
    if (url.endsWith('/api/models/xororz/sd-qnn/tree/main')) {
      return { ok: true, json: async () => [] } as Response;
    }
    return { ok: true, json: async () => [] } as Response;
  }) as typeof fetch;
}

afterEach(() => {
  global.fetch = originalFetch;
});

describe('P1 image extraction process-death recovery', () => {
  it('relaunches to one retriable row and never exposes the partial model as ready', async () => {
    installImageCatalogFixture();
    const first = await renderMainApp({
      boundary: {
        download: true,
        ram: {
          platform: 'android',
          totalBytes: 8 * GB,
          availBytes: 6 * GB,
        },
      },
    });
    const { asyncStorage, boundary, rtl, view } = first;

    rtl.fireEvent.press(view.getByTestId('models-tab'));
    await rtl.waitFor(() =>
      expect(view.getByTestId('models-screen')).toBeTruthy(),
    );
    rtl.fireEvent.press(view.getByText('Image Models'));
    await rtl.waitFor(() =>
      expect(view.getByText('Anything V5 (GPU)')).toBeTruthy(),
    );
    rtl.fireEvent.press(view.getByTestId('image-model-card-0-download'));

    const nativeRow = await rtl.waitFor(() => {
      const rows = boundary.download!.active();
      expect(rows).toHaveLength(1);
      return rows[0];
    });

    // Native owns staging/moving the completed archive. Extraction is also a
    // native package boundary; hold it after writing one partial output file to
    // create the exact process-death window without replacing any Off Grid code.
    boundary.download!.module.moveCompletedDownload.mockImplementation(
      async (_downloadId: string, targetPath: string) => {
        boundary.fs!.seedFile(targetPath, ARCHIVE_SIZE);
        return targetPath;
      },
    );
    let markExtractionStarted!: () => void;
    const extractionStarted = new Promise<void>(resolve => {
      markExtractionStarted = resolve;
    });
    const extractionKilledWithProcess = new Promise<void>(() => {});
    const { unzip } = require('react-native-zip-archive') as {
      unzip: jest.Mock;
    };
    unzip.mockImplementation(async () => {
      boundary.fs!.seedFile(`${MODEL_DIR}/unet.mnn`, 1024);
      markExtractionStarted();
      await extractionKilledWithProcess;
      return MODEL_DIR;
    });

    await rtl.act(async () => {
      boundary.download!.events.emit('DownloadProgress', {
        ...nativeRow,
        bytesDownloaded: ARCHIVE_SIZE,
        totalBytes: ARCHIVE_SIZE,
        status: 'running',
      });
      boundary.download!.events.emit('DownloadComplete', {
        ...nativeRow,
        bytesDownloaded: ARCHIVE_SIZE,
        totalBytes: ARCHIVE_SIZE,
        status: 'completed',
        localUri: ZIP_PATH,
      });
      await extractionStarted;
    });

    expect(unzip).toHaveBeenCalledWith(ZIP_PATH, MODEL_DIR);
    expect(view.getByTestId('image-model-card-0-cancel')).toBeTruthy();
    expect(view.queryByText(/downloaded successfully/i)).toBeNull();
    await rtl.waitFor(async () => {
      const raw = await asyncStorage.getItem(ACTIVE_DOWNLOADS_KEY);
      const persisted = JSON.parse(raw ?? '[]') as Array<{
        fileName: string;
        status: string;
      }>;
      expect(persisted).toEqual([
        expect.objectContaining({ fileName: FILE_NAME, status: 'processing' }),
      ]);
    });

    // Process death discards JS/native in-memory ownership. Recreate only what
    // survives on device: AsyncStorage plus the archive and partial extraction.
    view.unmount();
    const relaunched = await relaunchMainApp({
      boundary: {
        download: true,
        ram: {
          platform: 'android',
          totalBytes: 8 * GB,
          availBytes: 6 * GB,
        },
      },
      beforeRender: ({ boundary: nextBoundary }) => {
        nextBoundary.fs!.seedFile(ZIP_PATH, ARCHIVE_SIZE);
        nextBoundary.fs!.seedFile(`${MODEL_DIR}/unet.mnn`, 1024);
      },
    });
    const next = relaunched;

    next.rtl.fireEvent.press(next.view.getByTestId('models-tab'));
    await next.rtl.waitFor(() =>
      expect(next.view.getByTestId('models-screen')).toBeTruthy(),
    );
    next.rtl.fireEvent.press(next.view.getByTestId('downloads-icon'));
    await next.rtl.waitFor(() => {
      expect(next.view.getAllByTestId('failed-retry-button')).toHaveLength(1);
      expect(next.view.getAllByTestId('failed-remove-button')).toHaveLength(1);
      expect(next.view.getByTestId('dm-active-failed-count')).toHaveTextContent(
        '1 failed',
      );
    });

    // The relaunch did not duplicate a native transfer and did not register the
    // partial extraction as a downloaded image model.
    expect(next.boundary.download!.active()).toHaveLength(0);
    next.rtl.fireEvent.press(next.view.getByText('Image Gen'));
    await next.rtl.waitFor(() =>
      expect(next.view.getByText('No Image Gen models')).toBeTruthy(),
    );
    expect(next.view.queryByText(/downloaded successfully/i)).toBeNull();
    next.view.unmount();
  }, 45000);
});
