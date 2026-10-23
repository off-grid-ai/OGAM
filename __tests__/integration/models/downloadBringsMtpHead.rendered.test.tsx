/**
 * One tap downloads everything a model needs: a GGUF whose MTP head is published separately gets the
 * head too, right after the weights, with its checksum, beside the model.
 *
 * SPEC (the user's view): on the Models screen I find a Gemma 4 E4B upload and tap its download. The
 * weights download; then the model's MTP head downloads by itself, with nothing else to tap. Once both
 * finish, the head sits next to the model.
 *
 * Real ModelsScreen, startModelDownload, ensureMtpHead, performSidecarDownload, backgroundDownloadService
 * and stores. Faked at the device line only: the network (Hugging Face listing), the in-memory disk and
 * the native background downloader.
 */
import { installNativeBoundary, requireRTL, MB } from '../../harness/nativeBoundary';

const MODEL_ID = 'test/Head-Test-GGUF';
const FILE_NAME = 'gemma-4-E4B-it-Q4_K_M.gguf';
const FILE_SIZE = 64 * MB;
const HEAD_FILE = 'mtp-gemma-4-E4B-it-Q8_0.gguf';
const HEAD_BYTES = 98653248;

describe('one-tap download', () => {
  it('a model with a published MTP head gets the head after the weights, with nothing more to tap', async () => {
    const boundary = installNativeBoundary({ download: true, fs: true });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/tree/main')) {
        return {
          ok: true,
          status: 200,
          json: async () => [
            {
              type: 'file',
              path: FILE_NAME,
              size: FILE_SIZE,
              lfs: { size: FILE_SIZE },
            },
          ],
        } as Response;
      }
      if (url.pathname === '/api/models') {
        return {
          ok: true,
          status: 200,
          json: async () => [
            {
              id: MODEL_ID,
              author: 'test',
              downloads: 1,
              likes: 0,
              tags: ['gguf'],
              siblings: [],
            },
          ],
        } as Response;
      }
      if (url.pathname.startsWith('/api/models/')) {
        const id = decodeURIComponent(url.pathname.slice('/api/models/'.length));
        return {
          ok: true,
          status: 200,
          json: async () => ({
            id,
            author: id.split('/')[0],
            downloads: 1,
            likes: 0,
            tags: ['gguf'],
            // A model's files come from its listing with blob sizes (`?blobs=true`).
            siblings: id === MODEL_ID && url.searchParams.get('blobs') === 'true'
              ? [{ rfilename: FILE_NAME, size: FILE_SIZE, lfs: { size: FILE_SIZE } }]
              : [],
          }),
        } as Response;
      }
      throw new Error(`Unexpected network request: ${url.toString()}`);
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

      fireEvent.changeText(models.getByTestId('search-input'), 'Head Test');
      fireEvent(models.getByTestId('search-input'), 'submitEditing');
      await waitFor(() => expect(models.getByText('Head-Test-GGUF')).toBeTruthy());
      fireEvent.press(models.getByText('Head-Test-GGUF'));
      await waitFor(() => expect(models.getByTestId('file-card-0-download')).toBeTruthy());
      fireEvent.press(models.getByTestId('file-card-0-download'));

      await waitFor(() => expect(boundary.download!.active()).toHaveLength(1));
      const row = boundary.download!.active()[0];
      await act(async () => {
        boundary.fs!.seedFile(`/docs/models/${FILE_NAME}`, FILE_SIZE);
        boundary.download!.events.emit('DownloadComplete', {
          downloadId: row.downloadId,
          fileName: row.fileName,
          modelId: row.modelId,
          bytesDownloaded: FILE_SIZE,
          totalBytes: FILE_SIZE,
          status: 'completed',
          localUri: `/docs/models/${FILE_NAME}`,
        });
        await new Promise(resolve => setTimeout(resolve, 0));
        await new Promise(resolve => setTimeout(resolve, 0));
      });


      // The head starts by itself once the weights are in: the published file, its checksum, its size.
      const headRow = await waitFor(() => {
        const rows = boundary.download!.active().filter(r => r.fileName === HEAD_FILE);
        expect(rows).toHaveLength(1);
        return rows[0] as typeof rows[0] & { url?: string; sha256?: string };
      });
      expect(headRow.totalBytes).toBe(HEAD_BYTES);
      expect(headRow.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(headRow.url).toMatch(/^https:\/\/huggingface\.co\/.+\/mtp-gemma-4-E4B-it-Q8_0\.gguf$/);

      const headPath = `/docs/models/${HEAD_FILE}`;
      await act(async () => {
        boundary.fs!.seedFile(headPath, HEAD_BYTES);
        boundary.download!.events.emit('DownloadComplete', {
          downloadId: headRow.downloadId, fileName: headRow.fileName, modelId: headRow.modelId,
          bytesDownloaded: HEAD_BYTES, totalBytes: HEAD_BYTES, status: 'completed', localUri: `file://${headPath}`,
        });
      });
      expect(await boundary.fs!.exists(headPath)).toBe(true);
      expect(await boundary.fs!.exists(`/docs/models/${FILE_NAME}`)).toBe(true);
      models.unmount();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
