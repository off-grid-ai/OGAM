import { renderMainApp } from '../../harness/appJourney';

const ACTIVE_DOWNLOADS_KEY = '@offgrid/active_downloads';
const CHAT_STORAGE_KEY = 'local-llm-chat-storage';
const PROCESSING_FILE = 'processing-Q4_K_M.gguf';

describe('APP-P2-004/005 full-App storage maintenance', () => {
  it('protects model work, removes only temporary cache, and preserves user data', async () => {
    const app = await renderMainApp({
      boundary: { download: true },
      beforeRender: async ({ boundary, asyncStorage }) => {
        boundary.fs!.seedFile(`/docs/models/${PROCESSING_FILE}`, 2048);
        boundary.fs!.seedFile('/docs/models/actual-orphan.gguf', 1024);
        boundary.fs!.seedFile('/caches/previews/thumb.bin', 4096);
        const row = {
          downloadId: 'processing-native',
          modelId: 'test/processing',
          modelKey: `test/processing/${PROCESSING_FILE}`,
          fileName: PROCESSING_FILE,
          quantization: 'Q4_K_M',
          modelType: 'text',
          status: 'running',
          bytesDownloaded: 1024,
          totalBytes: 2048,
          combinedTotalBytes: 2048,
          progress: 0.5,
          createdAt: 1,
        };
        await asyncStorage.setItem(ACTIVE_DOWNLOADS_KEY, JSON.stringify([row]));
        boundary.download!.seedActive(row);
        await asyncStorage.setItem(
          CHAT_STORAGE_KEY,
          JSON.stringify({
            state: {
              conversations: [
                {
                  id: 'kept-chat',
                  title: 'Keep me',
                  modelId: 'journey',
                  messages: [],
                  createdAt: 1,
                  updatedAt: 1,
                },
              ],
              activeConversationId: null,
            },
            version: 0,
          }),
        );
      },
    });
    const { fireEvent, waitFor } = app.rtl;
    fireEvent.press(app.view.getByTestId('settings-tab'));
    fireEvent.press(await waitFor(() => app.view.getByText('Storage')));

    await waitFor(() => {
      expect(
        app.view.getByTestId('storage-conversation-count'),
      ).toHaveTextContent('1');
      expect(
        app.view.getByTestId('storage-text-model-count'),
      ).toHaveTextContent('1');
      expect(
        app.view.getByTestId('orphaned-file-actual-orphan.gguf'),
      ).toBeTruthy();
      expect(
        app.view.queryByTestId(`orphaned-file-${PROCESSING_FILE}`),
      ).toBeNull();
      expect(app.view.getByTestId('cache-storage-total')).not.toHaveTextContent(
        '0 B',
      );
    });

    fireEvent.press(app.view.getByTestId('clear-cache-button'));
    const clearActions = await waitFor(() =>
      app.view.getAllByText('Clear Cache'),
    );
    fireEvent.press(clearActions[clearActions.length - 1]);
    await waitFor(() =>
      expect(app.view.getByTestId('cache-storage-total')).toHaveTextContent(
        '0 B',
      ),
    );
    expect(
      app.view.getByTestId('storage-conversation-count'),
    ).toHaveTextContent('1');
    expect(app.view.getByTestId('storage-text-model-count')).toHaveTextContent(
      '1',
    );
    const exists = app.boundary.fs!.module.exists as (
      path: string,
    ) => Promise<boolean>;
    expect(await exists('/docs/models/journey-model-Q4_K_M.gguf')).toBe(true);
    expect(await exists('/caches/previews/thumb.bin')).toBe(false);
    app.view.unmount();
  }, 30000);
});
