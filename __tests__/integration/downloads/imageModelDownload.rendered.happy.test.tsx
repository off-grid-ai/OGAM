/**
 * P1 #12 — download and extract an image model through the real Models screen.
 *
 * HTTP supplies the repository listing and the native boundary supplies the zip
 * download/filesystem. The real image catalog, download state machine, extraction
 * integrity gate, registration, persistence, and rendered UI run above them.
 */
import { renderMainApp } from '../../harness/appJourney';
import { GB } from '../../harness/nativeBoundary';

const MODEL_ID = 'anythingv5_cpu';
const ARCHIVE_SIZE = 24 * 1024 * 1024;
const MODEL_DIR = `/docs/image_models/${MODEL_ID}`;
const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
});

describe('P1 image-model download journey', () => {
  it('keeps the model unavailable until its downloaded archive passes extraction', async () => {
    global.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/models/xororz/sd-mnn/tree/main')) {
        return {
          ok: true,
          json: async () => [
            {
              type: 'file',
              path: 'AnythingV5.zip',
              size: ARCHIVE_SIZE,
            },
          ],
        } as Response;
      }
      if (url.endsWith('/api/models/xororz/sd-qnn/tree/main')) {
        return { ok: true, json: async () => [] } as Response;
      }
      return { ok: true, json: async () => [] } as Response;
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
      fireEvent.press(view.getByText('Image Models'));
    });
    await waitFor(() =>
      expect(view.getByText('Anything V5 (GPU)')).toBeTruthy(),
    );

    await act(async () => {
      fireEvent.press(view.getByTestId('image-model-card-0-download'));
    });
    await waitFor(() => expect(boundary.download!.active()).toHaveLength(1));

    const nativeRow = boundary.download!.active()[0];
    expect(nativeRow.fileName).toBe(`${MODEL_ID}.zip`);

    let finishExtraction!: () => void;
    const extractionGate = new Promise<void>(resolve => {
      finishExtraction = resolve;
    });
    const { unzip } = require('react-native-zip-archive') as {
      unzip: jest.Mock;
    };
    unzip.mockImplementation(async () => {
      // Device-shaped successful MNN extraction. The production integrity owner
      // validates this exact on-disk layout before it writes `_ready`.
      boundary.fs!.seedFile(`${MODEL_DIR}/pos_emb.bin`, 1);
      boundary.fs!.seedFile(`${MODEL_DIR}/token_emb.bin`, 1);
      boundary.fs!.seedFile(`${MODEL_DIR}/tokenizer.json`, 1);
      boundary.fs!.seedFile(`${MODEL_DIR}/unet.mnn`, 1);
      boundary.fs!.seedFile(`${MODEL_DIR}/unet.mnn.weight`, 1);
      boundary.fs!.seedFile(`${MODEL_DIR}/clip_v2.mnn`, 1);
      boundary.fs!.seedFile(`${MODEL_DIR}/clip_v2.mnn.weight`, 1);
      boundary.fs!.seedFile(`${MODEL_DIR}/vae_decoder.mnn`, 1);
      boundary.fs!.seedFile(`${MODEL_DIR}/vae_decoder.mnn.weight`, 1);
      await extractionGate;
      return MODEL_DIR;
    });

    await act(async () => {
      boundary.download!.events.emit('DownloadProgress', {
        downloadId: nativeRow.downloadId,
        fileName: nativeRow.fileName,
        modelId: nativeRow.modelId,
        bytesDownloaded: ARCHIVE_SIZE,
        totalBytes: ARCHIVE_SIZE,
        status: 'running',
      });
      boundary.download!.events.emit('DownloadComplete', {
        downloadId: nativeRow.downloadId,
        fileName: nativeRow.fileName,
        modelId: nativeRow.modelId,
        bytesDownloaded: ARCHIVE_SIZE,
        totalBytes: ARCHIVE_SIZE,
        status: 'completed',
        localUri: `/docs/image_models/${MODEL_ID}.zip`,
      });
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    // Native bytes are complete, but the card remains active and no success is shown
    // while extraction is still in flight: the archive is not yet a usable model.
    expect(view.getByTestId('image-model-card-0-cancel')).toBeTruthy();
    expect(view.queryByText(/downloaded successfully/i)).toBeNull();

    await act(async () => {
      finishExtraction();
      await extractionGate;
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    await waitFor(() => {
      expect(view.getAllByText('Success').length).toBeGreaterThan(0);
      expect(
        view.getAllByText(/downloaded successfully/i).length,
      ).toBeGreaterThan(0);
    });
    expect(view.queryByText('Anything V5 (GPU)')).toBeNull();
    expect(view.queryByTestId('image-model-card-0-download')).toBeNull();
  }, 30000);
});
