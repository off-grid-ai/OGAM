/**
 * P1 #21 — retrying a failed image extraction must reconcile persisted transfer
 * state with the artifacts that actually remain on disk. The journey uses the
 * real App, catalog, download state machine, Download Manager retry action,
 * extraction integrity owner, registration, and Image Gen model picker. Only
 * the HTTP/native download, filesystem, and unzip boundaries are controlled.
 */
import { renderMainApp } from '../../harness/appJourney';
import { GB } from '../../harness/nativeBoundary';

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

function seedCompleteMnnExtraction(
  seedFile: (path: string, sizeBytes: number) => void,
): void {
  seedFile(`${MODEL_DIR}/pos_emb.bin`, 1);
  seedFile(`${MODEL_DIR}/token_emb.bin`, 1);
  seedFile(`${MODEL_DIR}/tokenizer.json`, 1);
  seedFile(`${MODEL_DIR}/unet.mnn`, 1);
  seedFile(`${MODEL_DIR}/unet.mnn.weight`, 1);
  seedFile(`${MODEL_DIR}/clip_v2.mnn`, 1);
  seedFile(`${MODEL_DIR}/clip_v2.mnn.weight`, 1);
  seedFile(`${MODEL_DIR}/vae_decoder.mnn`, 1);
  seedFile(`${MODEL_DIR}/vae_decoder.mnn.weight`, 1);
}

afterEach(() => {
  global.fetch = originalFetch;
});

describe('P1 failed image extraction retry', () => {
  it('discards mismatched artifacts, re-downloads once, and exposes only the complete model', async () => {
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

    rtl.fireEvent.press(view.getByTestId('models-tab'));
    await rtl.waitFor(() =>
      expect(view.getByTestId('models-screen')).toBeTruthy(),
    );
    rtl.fireEvent.press(view.getByText('Image Models'));
    await rtl.waitFor(() =>
      expect(view.getByText('Anything V5 (GPU)')).toBeTruthy(),
    );
    rtl.fireEvent.press(view.getByTestId('image-model-card-0-download'));

    const firstRow = await rtl.waitFor(() => {
      const rows = boundary.download!.active();
      expect(rows).toHaveLength(1);
      return rows[0];
    });

    let moveAttempt = 0;
    boundary.download!.module.moveCompletedDownload.mockImplementation(
      async (_downloadId: string, targetPath: string) => {
        moveAttempt += 1;
        if (moveAttempt === 2) {
          throw new Error('Native completed archive no longer exists');
        }
        boundary.fs!.seedFile(targetPath, ARCHIVE_SIZE);
        return targetPath;
      },
    );
    const { unzip } = require('react-native-zip-archive') as {
      unzip: jest.Mock;
    };
    unzip
      .mockImplementationOnce(async () => {
        boundary.fs!.seedFile(`${MODEL_DIR}/unet.mnn`, 1024);
        throw new Error('Archive extraction interrupted');
      })
      .mockImplementationOnce(async () => {
        seedCompleteMnnExtraction(boundary.fs!.seedFile);
        return MODEL_DIR;
      });

    await rtl.act(async () => {
      boundary.download!.events.emit('DownloadProgress', {
        ...firstRow,
        bytesDownloaded: ARCHIVE_SIZE,
        totalBytes: ARCHIVE_SIZE,
        status: 'running',
      });
      boundary.download!.events.emit('DownloadComplete', {
        ...firstRow,
        bytesDownloaded: ARCHIVE_SIZE,
        totalBytes: ARCHIVE_SIZE,
        status: 'completed',
        localUri: ZIP_PATH,
      });
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    await rtl.waitFor(() =>
      expect(view.getByText('Download Failed')).toBeTruthy(),
    );
    rtl.fireEvent.press(view.getByText('OK'));
    rtl.fireEvent.press(view.getByTestId('downloads-icon'));
    await rtl.waitFor(() =>
      expect(view.getAllByTestId('failed-retry-button')).toHaveLength(1),
    );

    // The persisted row says all archive bytes completed, but only a partial model
    // directory and truncated archive survived. Retry must trust disk integrity,
    // discard both, and fall back when native no longer owns the completed archive.
    boundary.fs!.seedFile(`${MODEL_DIR}/unet.mnn`, 1024);
    boundary.fs!.seedFile(ZIP_PATH, 512);
    boundary.download!.module.retryDownload.mockRejectedValueOnce(
      new Error('Download not found'),
    );

    rtl.fireEvent.press(view.getByTestId('failed-retry-button'));

    const retryRow = await rtl.waitFor(() => {
      expect(boundary.download!.module.startDownload).toHaveBeenCalledTimes(2);
      const rows = boundary.download!.active();
      expect(rows).toHaveLength(1);
      return rows[0];
    });

    await rtl.act(async () => {
      boundary.download!.events.emit('DownloadComplete', {
        ...retryRow,
        bytesDownloaded: ARCHIVE_SIZE,
        totalBytes: ARCHIVE_SIZE,
        status: 'completed',
        localUri: ZIP_PATH,
      });
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    await rtl.waitFor(() => {
      expect(view.getByText('Success')).toBeTruthy();
      expect(view.getByText(/downloaded successfully/i)).toBeTruthy();
    });
    rtl.fireEvent.press(view.getByText('OK'));
    rtl.fireEvent.press(view.getByText('Image Gen'));
    await rtl.waitFor(() =>
      expect(view.queryByText('No Image Gen models')).toBeNull(),
    );
    expect(view.queryByTestId('failed-retry-button')).toBeNull();
    expect(unzip).toHaveBeenCalledTimes(2);
    view.unmount();
  }, 45000);
});
