/** P0 #167/#168/#171 — durable user data is visible after a real App boot. */
import { relaunchMainApp, renderMainApp } from '../../harness/appJourney';

const CHAT_STORAGE_KEY = 'local-llm-chat-storage';
const ACTIVE_DOWNLOADS_KEY = '@offgrid/active_downloads';

async function seedPersistedChat(
  asyncStorage: typeof import('@react-native-async-storage/async-storage').default,
) {
  await asyncStorage.setItem(
    CHAT_STORAGE_KEY,
    JSON.stringify({
      state: {
        conversations: [
          {
            id: 'persisted-chat',
            title: 'Offline planning',
            modelId: 'test/journey-model/journey-model-Q4_K_M.gguf',
            createdAt: '2026-07-15T10:00:00.000Z',
            updatedAt: '2026-07-15T10:01:00.000Z',
            messages: [
              {
                id: 'u1',
                role: 'user',
                content: 'Plan my offline trip',
                timestamp: 1,
              },
              {
                id: 'a1',
                role: 'assistant',
                content: 'Pack maps and a power bank.',
                timestamp: 2,
              },
            ],
          },
        ],
        activeConversationId: null,
      },
      version: 0,
    }),
  );
}

describe('P0 relaunch persistence journeys', () => {
  it('restores chat history and opens the persisted messages', async () => {
    const { rtl, view } = await renderMainApp({
      beforeRender: ({ asyncStorage }) => seedPersistedChat(asyncStorage),
    });

    rtl.fireEvent.press(view.getByTestId('chats-tab'));
    await rtl.waitFor(() => {
      expect(view.getByText('Offline planning')).toBeTruthy();
      expect(view.getByText('Pack maps and a power bank.')).toBeTruthy();
    });
    rtl.fireEvent.press(view.getByTestId('conversation-item-0'));
    await rtl.waitFor(() => {
      expect(view.getByText('Plan my offline trip')).toBeTruthy();
      expect(view.getByText('Pack maps and a power bank.')).toBeTruthy();
    });
  });

  it('restores downloaded models into Download Manager without re-downloading', async () => {
    const { rtl, view } = await renderMainApp();

    rtl.fireEvent.press(view.getByTestId('models-tab'));
    await rtl.waitFor(() =>
      expect(view.getByTestId('models-screen')).toBeTruthy(),
    );
    rtl.fireEvent.press(view.getByTestId('downloads-icon'));
    await rtl.waitFor(() => {
      expect(view.getByText('Downloaded Models')).toBeTruthy();
      expect(view.getByText('journey-model-Q4_K_M.gguf')).toBeTruthy();
    });
  });

  it('keeps the selected active model for a new chat after relaunch', async () => {
    const firstLaunch = await renderMainApp();

    firstLaunch.rtl.fireEvent.press(
      firstLaunch.view.getByTestId('browse-models-button'),
    );
    const modelRows = await firstLaunch.rtl.waitFor(() => {
      const rows = firstLaunch.view.queryAllByTestId('model-item');
      expect(rows.length).toBeGreaterThan(0);
      return rows;
    });
    firstLaunch.rtl.fireEvent.press(modelRows[0]);
    await firstLaunch.rtl.waitFor(async () => {
      const raw = await firstLaunch.asyncStorage.getItem(
        'local-llm-app-storage',
      );
      expect(JSON.parse(raw ?? '{}').state?.activeModelId).toBe(
        'test/journey-model/journey-model-Q4_K_M.gguf',
      );
    });
    firstLaunch.view.unmount();

    const relaunched = await relaunchMainApp();
    relaunched.rtl.fireEvent.press(
      relaunched.view.getByTestId('new-chat-button'),
    );
    await relaunched.rtl.waitFor(() => {
      expect(relaunched.view.getByTestId('chat-input')).toBeTruthy();
      expect(
        relaunched.view.getByText(
          'Type a message below to begin chatting with Journey Model.',
        ),
      ).toBeTruthy();
    });
    relaunched.view.unmount();
  });

  it('restores an interrupted download as a visible retriable entry', async () => {
    const { rtl, view } = await renderMainApp({
      boundary: { download: true },
      beforeRender: async ({ asyncStorage }) => {
        await asyncStorage.setItem(
          ACTIVE_DOWNLOADS_KEY,
          JSON.stringify([
            {
              modelKey: 'offline/recovery/recovery-Q4_K_M.gguf',
              downloadId: 'lost-native-row',
              modelId: 'offline/recovery',
              fileName: 'recovery-Q4_K_M.gguf',
              quantization: 'Q4_K_M',
              modelType: 'text',
              status: 'running',
              bytesDownloaded: 50,
              totalBytes: 100,
              combinedTotalBytes: 100,
              progress: 0.5,
              createdAt: 1,
            },
          ]),
        );
      },
    });

    rtl.fireEvent.press(view.getByTestId('models-tab'));
    await rtl.waitFor(() =>
      expect(view.getByTestId('models-screen')).toBeTruthy(),
    );
    rtl.fireEvent.press(view.getByTestId('downloads-icon'));
    await rtl.waitFor(() => {
      expect(view.getByText('recovery-Q4_K_M.gguf')).toBeTruthy();
      expect(view.getByTestId('failed-retry-button')).toBeTruthy();
    });
  });

  it('keeps user data and loading mode when booting over an existing install', async () => {
    const { rtl, view } = await renderMainApp({
      persistedAppState: {
        settings: { modelLoadingMode: 'aggressive' },
      },
      beforeRender: ({ asyncStorage }) => seedPersistedChat(asyncStorage),
    });

    rtl.fireEvent.press(view.getByTestId('chats-tab'));
    await rtl.waitFor(() =>
      expect(view.getByText('Offline planning')).toBeTruthy(),
    );

    rtl.fireEvent.press(view.getByTestId('models-tab'));
    await rtl.waitFor(() =>
      expect(view.getByTestId('models-screen')).toBeTruthy(),
    );
    rtl.fireEvent.press(view.getByTestId('downloads-icon'));
    await rtl.waitFor(() =>
      expect(view.getByText('journey-model-Q4_K_M.gguf')).toBeTruthy(),
    );

    rtl.fireEvent.press(view.getByTestId('back-button'));
    rtl.fireEvent.press(view.getByTestId('settings-tab'));
    rtl.fireEvent.press(
      await rtl.waitFor(() => view.getByText('Model Settings')),
    );
    rtl.fireEvent.press(
      await rtl.waitFor(() => view.getByTestId('text-generation-accordion')),
    );
    rtl.fireEvent.press(
      await rtl.waitFor(() => view.getByTestId('text-advanced-toggle')),
    );
    await rtl.waitFor(() => {
      expect(
        view.getByTestId('model-loading-mode-aggressive-button').props
          .accessibilityState.selected,
      ).toBe(true);
    });
  });
});
