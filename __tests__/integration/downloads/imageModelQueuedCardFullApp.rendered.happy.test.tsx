/**
 * Full-App regression: an image-model download queued behind the global native
 * concurrency cap must remain visibly queued, start once, process, and become ready.
 *
 * The real App, navigation, Models screen, download admission service, stores,
 * image finalizer, and ModelCard run unchanged. HTTP, the native download bridge,
 * filesystem, and unzip are the only device boundaries supplied by the harness.
 */
import { renderMainApp } from '../../harness/appJourney';
import { GB } from '../../harness/nativeBoundary';

const TEXT_FILE_SIZE = 16 * 1024 * 1024;
const IMAGE_ARCHIVE_SIZE = 24 * 1024 * 1024;
const IMAGE_MODEL_ID = 'anythingv5_cpu';
const IMAGE_MODEL_DIR = `/docs/image_models/${IMAGE_MODEL_ID}`;
const originalFetch = global.fetch;

const TEXT_MODELS = ['alpha', 'bravo', 'charlie'].map(name => ({
  id: `offgrid-tests/image-queue-${name}`,
  name: `image-queue-${name}`,
  fileName: `image-queue-${name}-Q4_K_M.gguf`,
}));

function installCatalogFixture(): void {
  global.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    const textModel = TEXT_MODELS.find(model => url.includes(model.name));

    if (url.includes('/models?')) {
      return {
        ok: true,
        json: async () =>
          textModel
            ? [
                {
                  id: textModel.id,
                  author: 'offgrid-tests',
                  downloads: 1,
                  likes: 1,
                  tags: ['gguf'],
                  lastModified: '2026-07-20T00:00:00.000Z',
                  siblings: [],
                },
              ]
            : [],
      } as Response;
    }

    if (textModel && url.endsWith(`/models/${textModel.id}/tree/main`)) {
      return {
        ok: true,
        json: async () => [
          {
            type: 'file',
            path: textModel.fileName,
            size: TEXT_FILE_SIZE,
          },
        ],
      } as Response;
    }

    if (url.endsWith('/api/models/xororz/sd-mnn/tree/main')) {
      return {
        ok: true,
        json: async () => [
          {
            type: 'file',
            path: 'AnythingV5.zip',
            size: IMAGE_ARCHIVE_SIZE,
          },
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

describe('full-App queued image-model card lifecycle', () => {
  it('shows Queued until a slot frees, then starts once, processes, and becomes ready', async () => {
    installCatalogFixture();
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

    // Fill all three admission slots through the real text-model browse UI.
    for (const model of TEXT_MODELS) {
      await act(async () => {
        fireEvent.changeText(view.getByTestId('search-input'), model.name);
        fireEvent(view.getByTestId('search-input'), 'submitEditing');
        await new Promise(resolve => setTimeout(resolve, 600));
      });
      fireEvent.press(await waitFor(() => view.getByText(model.name)));
      await waitFor(() =>
        expect(
          view.getByText(model.fileName.replace(/\.gguf$/, '')),
        ).toBeTruthy(),
      );
      await act(async () => {
        fireEvent.press(view.getByTestId('file-card-0-download'));
        await new Promise(resolve => setTimeout(resolve, 0));
      });
      await waitFor(() => {
        const card = view.getByTestId('file-card-0');
        expect(within(card).getByText('Queued')).toBeTruthy();
        expect(view.queryByTestId('file-card-0-download')).toBeNull();
      });
      fireEvent.press(view.getByTestId('model-detail-back'));
      await waitFor(() =>
        expect(view.getByTestId('models-screen')).toBeTruthy(),
      );
    }
    await waitFor(() => expect(boundary.download!.active()).toHaveLength(3));

    fireEvent.press(view.getByText('Image Models'));
    await waitFor(() =>
      expect(view.getByText('Anything V5 (GPU)')).toBeTruthy(),
    );

    const originalDownloadAction = view.getByTestId(
      'image-model-card-0-download',
    );
    await act(async () => {
      // Repeat the gesture before React can redraw. The real image download owner
      // must coalesce this to one queued item and one later native start.
      fireEvent.press(originalDownloadAction);
      fireEvent.press(originalDownloadAction);
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    const queuedCard = await waitFor(() =>
      view.getByTestId('image-model-card-0'),
    );
    await waitFor(() => {
      expect(within(queuedCard).getByText('Queued')).toBeTruthy();
      expect(view.queryByTestId('image-model-card-0-download')).toBeNull();
    });
    expect(
      boundary.download!.active().filter(row => row.modelType === 'image'),
    ).toEqual([]);

    // No slot has freed: the card must remain queued instead of reverting to a
    // duplicate Download affordance or claiming that bytes are transferring.
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 20));
    });
    expect(within(queuedCard).getByText('Queued')).toBeTruthy();
    expect(view.queryByTestId('image-model-card-0-download')).toBeNull();

    // A native terminal event frees exactly one slot and pumps the FIFO queue.
    const releasedTextRow = boundary.download!.active()[0];
    await act(async () => {
      boundary.download!.events.emit('DownloadError', {
        downloadId: releasedTextRow.downloadId,
        fileName: releasedTextRow.fileName,
        modelId: releasedTextRow.modelId,
        status: 'failed',
        reason: 'Fixture released the occupied slot',
      });
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    const imageRow = await waitFor(() => {
      const rows = boundary
        .download!.active()
        .filter(row => row.modelType === 'image');
      expect(rows).toHaveLength(1);
      return rows[0];
    });
    expect(imageRow.fileName).toBe(`${IMAGE_MODEL_ID}.zip`);

    await act(async () => {
      boundary.download!.events.emit('DownloadProgress', {
        ...imageRow,
        bytesDownloaded: IMAGE_ARCHIVE_SIZE / 4,
        totalBytes: IMAGE_ARCHIVE_SIZE,
        status: 'running',
      });
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    await waitFor(() => {
      const runningCard = view.getByTestId('image-model-card-0');
      expect(within(runningCard).queryByText('Queued')).toBeNull();
      expect(within(runningCard).getByText('25%')).toBeTruthy();
      expect(view.queryByTestId('image-model-card-0-download')).toBeNull();
      expect(view.getAllByTestId('image-model-card-0-cancel')).toHaveLength(1);
    });

    let finishExtraction!: () => void;
    const extractionGate = new Promise<void>(resolve => {
      finishExtraction = resolve;
    });
    const { unzip } = require('react-native-zip-archive') as {
      unzip: jest.Mock;
    };
    unzip.mockImplementation(async () => {
      boundary.fs!.seedFile(`${IMAGE_MODEL_DIR}/pos_emb.bin`, 1);
      boundary.fs!.seedFile(`${IMAGE_MODEL_DIR}/token_emb.bin`, 1);
      boundary.fs!.seedFile(`${IMAGE_MODEL_DIR}/tokenizer.json`, 1);
      boundary.fs!.seedFile(`${IMAGE_MODEL_DIR}/unet.mnn`, 1);
      boundary.fs!.seedFile(`${IMAGE_MODEL_DIR}/unet.mnn.weight`, 1);
      boundary.fs!.seedFile(`${IMAGE_MODEL_DIR}/clip_v2.mnn`, 1);
      boundary.fs!.seedFile(`${IMAGE_MODEL_DIR}/clip_v2.mnn.weight`, 1);
      boundary.fs!.seedFile(`${IMAGE_MODEL_DIR}/vae_decoder.mnn`, 1);
      boundary.fs!.seedFile(`${IMAGE_MODEL_DIR}/vae_decoder.mnn.weight`, 1);
      await extractionGate;
      return IMAGE_MODEL_DIR;
    });

    await act(async () => {
      boundary.download!.events.emit('DownloadProgress', {
        ...imageRow,
        bytesDownloaded: IMAGE_ARCHIVE_SIZE,
        totalBytes: IMAGE_ARCHIVE_SIZE,
        status: 'running',
      });
      boundary.download!.events.emit('DownloadComplete', {
        ...imageRow,
        bytesDownloaded: IMAGE_ARCHIVE_SIZE,
        totalBytes: IMAGE_ARCHIVE_SIZE,
        status: 'completed',
        localUri: `/docs/image_models/${IMAGE_MODEL_ID}.zip`,
      });
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    // Bytes are complete but extraction is still gated: the same card stays active
    // at 100%, with no second Download action, until it is actually usable.
    await waitFor(() => {
      const processingCard = view.getByTestId('image-model-card-0');
      expect(within(processingCard).getByText('100%')).toBeTruthy();
      expect(within(processingCard).queryByText('Queued')).toBeNull();
      expect(view.queryByTestId('image-model-card-0-download')).toBeNull();
      expect(view.getAllByTestId('image-model-card-0-cancel')).toHaveLength(1);
    });

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
      expect(view.queryByText('Anything V5 (GPU)')).toBeNull();
      expect(view.queryByTestId('image-model-card-0-download')).toBeNull();
      expect(view.queryByTestId('image-model-card-0-cancel')).toBeNull();
    });
  }, 40000);
});
