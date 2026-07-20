/**
 * P1 #241 — an image archive that loses its network mid-transfer remains
 * retriable and finalizes exactly once after connectivity returns.
 *
 * The real App, Models UI, Download Manager, provider routing, download store,
 * archive finalizer, registration, and completed-model projection stay real.
 * HTTP, the native transfer bridge, filesystem, and unzip are device boundaries.
 */
import { renderMainApp } from '../../harness/appJourney';
import { GB } from '../../harness/nativeBoundary';

const MODEL_ID = 'anythingv5_cpu';
const ARCHIVE_SIZE = 24 * 1024 * 1024;
const MODEL_DIR = `/docs/image_models/${MODEL_ID}`;
const ZIP_PATH = `/docs/image_models/${MODEL_ID}.zip`;
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

function seedCompleteExtraction(
  seedFile: (path: string, sizeBytes: number) => void,
): void {
  [
    'pos_emb.bin',
    'token_emb.bin',
    'tokenizer.json',
    'unet.mnn',
    'unet.mnn.weight',
    'clip_v2.mnn',
    'clip_v2.mnn.weight',
    'vae_decoder.mnn',
    'vae_decoder.mnn.weight',
  ].forEach(file => seedFile(`${MODEL_DIR}/${file}`, 1));
}

afterEach(() => {
  global.fetch = originalFetch;
});

describe('P1 full-app image network retry and finalization', () => {
  it('retries the failed transfer and leaves one ready model without stale rows', async () => {
    installImageCatalogFixture();
    const { boundary, rtl, view } = await renderMainApp({
      boundary: {
        download: true,
        ram: {
          platform: 'android',
          totalBytes: 8 * GB,
          availBytes: 6 * GB,
        },
      },
    });
    const { act, fireEvent, waitFor, within } = rtl;

    fireEvent.press(view.getByTestId('models-tab'));
    await waitFor(() => expect(view.getByTestId('models-screen')).toBeTruthy());
    fireEvent.press(view.getByText('Image Models'));
    await waitFor(() =>
      expect(view.getByText('Anything V5 (GPU)')).toBeTruthy(),
    );
    fireEvent.press(view.getByTestId('image-model-card-0-download'));

    const nativeRow = await waitFor(() => {
      const rows = boundary.download!.active();
      expect(rows).toHaveLength(1);
      return rows[0];
    });

    await act(async () => {
      boundary.download!.events.emit('DownloadProgress', {
        ...nativeRow,
        bytesDownloaded: ARCHIVE_SIZE / 4,
        totalBytes: ARCHIVE_SIZE,
        status: 'running',
      });
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    await waitFor(() => {
      const card = view.getByTestId('image-model-card-0');
      expect(within(card).getByText('25%')).toBeTruthy();
      expect(view.getAllByTestId('image-model-card-0-cancel')).toHaveLength(1);
    });

    // Wi-Fi disappears at the native transfer boundary. App-owned listeners
    // must retain one failed logical row and expose a useful Retry action.
    await act(async () => {
      boundary.download!.events.emit('DownloadError', {
        ...nativeRow,
        status: 'failed',
        reason: 'Network connection lost',
        reasonCode: 'network_lost',
      });
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    await waitFor(() => {
      expect(view.getByText('Download Failed')).toBeTruthy();
      expect(
        view.getByText(
          'The connection dropped while downloading. Please try again.',
        ),
      ).toBeTruthy();
    });
    fireEvent.press(view.getByText('OK'));
    fireEvent.press(view.getByTestId('downloads-icon'));
    await waitFor(() => {
      expect(view.getAllByTestId('failed-retry-button')).toHaveLength(1);
      expect(view.getAllByTestId('failed-remove-button')).toHaveLength(1);
      expect(view.getByTestId('dm-active-failed-count')).toHaveTextContent(
        '1 failed',
      );
    });

    boundary.download!.module.moveCompletedDownload.mockImplementation(
      async (_downloadId: string, targetPath: string) => {
        boundary.fs!.seedFile(targetPath, ARCHIVE_SIZE);
        return targetPath;
      },
    );
    const { unzip } = require('react-native-zip-archive') as {
      unzip: jest.Mock;
    };
    unzip.mockImplementation(async () => {
      seedCompleteExtraction(boundary.fs!.seedFile);
      return MODEL_DIR;
    });

    fireEvent.press(view.getByTestId('failed-retry-button'));
    await waitFor(() => {
      expect(view.queryByTestId('failed-retry-button')).toBeNull();
      expect(view.queryByTestId('dm-active-failed-count')).toBeNull();
      expect(view.getByTestId('dm-active-queued-count')).toHaveTextContent(
        '1 queued',
      );
    });

    await act(async () => {
      boundary.download!.events.emit('DownloadProgress', {
        ...nativeRow,
        bytesDownloaded: ARCHIVE_SIZE / 2,
        totalBytes: ARCHIVE_SIZE,
        status: 'running',
      });
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    await waitFor(() => {
      expect(view.getByTestId('dm-active-downloading-count')).toHaveTextContent(
        '1',
      );
      expect(view.queryByTestId('dm-active-queued-count')).toBeNull();
    });

    await act(async () => {
      boundary.download!.events.emit('DownloadComplete', {
        ...nativeRow,
        bytesDownloaded: ARCHIVE_SIZE,
        totalBytes: ARCHIVE_SIZE,
        status: 'completed',
        localUri: ZIP_PATH,
      });
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    await waitFor(
      () => {
        expect(view.getByTestId(`completed-download-${MODEL_ID}`)).toBeTruthy();
        expect(view.queryByTestId(`active-download-${MODEL_ID}`)).toBeNull();
        expect(view.queryByTestId('failed-retry-button')).toBeNull();
        expect(view.queryByText('Active Downloads')).toBeNull();
      },
      { timeout: 5000 },
    );
    fireEvent.press(view.getByText('Image Gen'));
    await waitFor(() => {
      expect(view.getAllByText('Anything V5 (GPU)')).toHaveLength(1);
      expect(view.getByTestId(`completed-download-${MODEL_ID}`)).toBeTruthy();
      expect(view.queryByTestId(`active-download-${MODEL_ID}`)).toBeNull();
      expect(view.queryByTestId('failed-retry-button')).toBeNull();
      expect(view.queryByText('Active Downloads')).toBeNull();
    });
    expect(unzip).toHaveBeenCalledTimes(1);
    view.unmount();
  }, 40000);
});
