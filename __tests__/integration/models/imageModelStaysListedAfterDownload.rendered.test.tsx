/**
 * A downloaded image model stays on the Image tab, marked downloaded (a0dc4baa0).
 *
 * The tab used to drop downloaded models from its only list, so finishing a download made the card
 * vanish. The user downloads an image model from the Image tab and still sees it there afterwards,
 * now showing as downloaded instead of offering another download.
 *
 * Real ModelsScreen, Image tab, card, image download actions, background download service, finalize
 * (move, unzip, integrity check, register) and stores. Fakes only at the device boundary: the Hugging
 * Face catalog (fetch), the native download module, the file system and the unzip module.
 */
import { installNativeBoundary, requireRTL, GB } from '../../harness/nativeBoundary';
import { installImageZipPackage, sdMnnTree } from '../../harness/imageModelPackage';

const ZIP_NAME = 'AnythingV5.zip';
const MODEL_NAME = 'Anything V5 (GPU)';
const ZIP_SIZE = 900 * 1024 * 1024;

describe('Image tab after a download', () => {
  it('keeps the downloaded image model listed, now marked downloaded', async () => {
    const boundary = installNativeBoundary({
      download: true,
      fs: true,
      ram: { platform: 'android', totalBytes: 12 * GB, availBytes: 8 * GB },
    });
    installImageZipPackage(boundary);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'https://huggingface.co/api/models/xororz/sd-mnn/tree/main') {
        return new Response(JSON.stringify(sdMnnTree(ZIP_NAME, ZIP_SIZE)), { status: 200 });
      }
      if (url === 'https://huggingface.co/api/models/xororz/sd-qnn/tree/main') {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      return new Response('[]', { status: 200 });
    }) as typeof fetch;

    try {
      const React = require('react');
      const { render, fireEvent, waitFor, act } = requireRTL();
      const AsyncStorage =
        require('@react-native-async-storage/async-storage').default ??
        require('@react-native-async-storage/async-storage');
      await AsyncStorage.clear();
      const { ModelsScreen } = require('../../../src/screens/ModelsScreen');

      const models = render(React.createElement(ModelsScreen));
      fireEvent.press(models.getByText('Image'));

      // BEFORE: the model is listed and offers a download; it is not marked downloaded.
      await waitFor(() => expect(models.getByText(MODEL_NAME)).toBeTruthy(), { timeout: 4000 });
      expect(models.queryByText(/downloaded successfully/)).toBeNull();
      expect(models.getByTestId('image-model-card-0-download')).toBeTruthy();
      expect(models.queryByTestId('image-model-card-0-downloaded')).toBeNull();

      fireEvent.press(models.getByTestId('image-model-card-0-download'));

      await waitFor(() => expect(boundary.download!.active()).toHaveLength(1));
      const row = boundary.download!.active()[0];
      await act(async () => {
        boundary.download!.events.emit('DownloadComplete', {
          downloadId: row.downloadId,
          fileName: row.fileName,
          modelId: row.modelId,
          bytesDownloaded: ZIP_SIZE,
          totalBytes: ZIP_SIZE,
          status: 'completed',
          localUri: `/docs/${row.fileName}`,
        });
        await new Promise(resolve => setTimeout(resolve, 0));
        await new Promise(resolve => setTimeout(resolve, 0));
      });

      // AFTER: the same model is still on the Image tab, marked downloaded, with no download offer.
      await waitFor(() => expect(models.getByTestId('image-model-card-0-downloaded')).toBeTruthy(), { timeout: 4000 });
      expect(models.getAllByText(MODEL_NAME)).toHaveLength(1);
      expect(models.getByText(/downloaded successfully/)).toBeTruthy();
      expect(models.queryByTestId('image-model-card-0-download')).toBeNull();
      expect(models.queryByText('No models available')).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
