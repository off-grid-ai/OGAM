import { installNativeBoundary, requireRTL, MB } from '../../harness/nativeBoundary';

const MODEL_ID = 'test/Auto-Select-1B-GGUF';
const FILE_NAME = 'auto-select-q4_k_m.gguf';
const FILE_SIZE = 64 * MB;

describe('Downloaded text model selection', () => {
  it('selects the completed model for chat without loading it into memory', async () => {
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
      const { HomeScreen } = require('../../../src/screens/HomeScreen');
      const { ResidentsProbe } = require('../../harness/ResidentsProbe');

      const models = render(
        React.createElement(
          React.Fragment,
          null,
          React.createElement(ModelsScreen),
          React.createElement(ResidentsProbe),
        ),
      );

      fireEvent.changeText(models.getByTestId('search-input'), 'Auto Select');
      fireEvent(models.getByTestId('search-input'), 'submitEditing');
      await waitFor(() => expect(models.getByText('Auto-Select-1B-GGUF')).toBeTruthy());
      fireEvent.press(models.getByText('Auto-Select-1B-GGUF'));
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

      await waitFor(() => expect(models.getByTestId('file-card-0-delete')).toBeTruthy());
      expect(models.getByTestId('probe-residents').props.children).toBe('(none)');
      models.unmount();

      const navigation = {
        navigate: () => undefined,
        goBack: () => undefined,
        setOptions: () => undefined,
        addListener: () => () => undefined,
      };
      const home = render(React.createElement(HomeScreen, { navigation }));
      await waitFor(() => expect(home.getByTestId('new-chat-button')).toBeTruthy());
      expect(home.getByTestId('model-summary-text').props.accessibilityState).toEqual({
        selected: true,
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
