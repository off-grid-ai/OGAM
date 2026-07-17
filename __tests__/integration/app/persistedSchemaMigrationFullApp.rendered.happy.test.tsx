/** APP-P0-002 — legacy persisted schemas retain every durable user asset. */
import type { DownloadedModel } from '../../../src/types';
import {
  relaunchMainApp,
  renderMainApp,
  type RenderedAppJourney,
} from '../../harness/appJourney';

const APP_STORAGE_KEY = 'local-llm-app-storage';
const CHAT_STORAGE_KEY = 'local-llm-chat-storage';
const PROJECT_STORAGE_KEY = 'local-llm-project-storage';
const MODEL_ID = 'legacy/models/legacy-Q4_K_M.gguf';

const legacyModel: DownloadedModel = {
  id: MODEL_ID,
  name: 'Legacy Model',
  author: 'legacy-user',
  fileName: 'legacy-Q4_K_M.gguf',
  filePath: '/docs/models/legacy-Q4_K_M.gguf',
  fileSize: 128 * 1024 * 1024,
  quantization: 'Q4_K_M',
  downloadedAt: '2024-01-01T00:00:00.000Z',
  engine: 'llama',
};

async function assertLegacySurfaces({ rtl, view }: RenderedAppJourney) {
  const { fireEvent, waitFor } = rtl;

  await waitFor(() => expect(view.getByTestId('home-screen')).toBeTruthy());
  fireEvent.press(view.getByTestId('models-summary'));
  await waitFor(() =>
    expect(view.getByTestId('models-row-text')).toHaveTextContent(
      /Legacy Model/,
    ),
  );
  fireEvent.press(view.getByText('Done'));

  fireEvent.press(view.getByTestId('chats-tab'));
  await waitFor(() => {
    expect(view.getByText('Legacy migration chat')).toBeTruthy();
    expect(view.getByText('Your saved chat survived.')).toBeTruthy();
  });
  fireEvent.press(view.getByTestId('conversation-item-0'));
  await waitFor(() => {
    expect(view.getByText('Keep all my old data')).toBeTruthy();
    expect(view.getByText('Your saved chat survived.')).toBeTruthy();
  });
  fireEvent.press(view.getByTestId('chat-back-button'));

  fireEvent.press(view.getByTestId('projects-tab'));
  await waitFor(() => expect(view.getByText('Legacy Research')).toBeTruthy());

  fireEvent.press(view.getByTestId('settings-tab'));
  fireEvent.press(await waitFor(() => view.getByText('Model Settings')));
  fireEvent.press(
    await waitFor(() => view.getByTestId('text-generation-accordion')),
  );
  await waitFor(() =>
    expect(view.getByTestId('llama-temperature-value')).toHaveTextContent(
      '1.15',
    ),
  );
}

describe('APP-P0-002 persisted schema migration', () => {
  it('hydrates version-0 chats, projects, models, and settings and retains them after relaunch', async () => {
    const firstLaunch = await renderMainApp({
      downloadedModels: [legacyModel],
      beforeRender: async ({ asyncStorage }) => {
        await asyncStorage.setItem(
          APP_STORAGE_KEY,
          JSON.stringify({
            state: {
              hasCompletedOnboarding: true,
              activeModelId: MODEL_ID,
              settings: {
                temperature: 1.15,
                enabledTools: ['calculator'],
              },
            },
            version: 0,
          }),
        );
        await asyncStorage.setItem(
          CHAT_STORAGE_KEY,
          JSON.stringify({
            state: {
              conversations: [
                {
                  id: 'legacy-chat',
                  title: 'Legacy migration chat',
                  modelId: MODEL_ID,
                  projectId: 'legacy-project',
                  createdAt: '2024-01-01T00:00:00.000Z',
                  updatedAt: '2024-01-01T00:01:00.000Z',
                  messages: [
                    {
                      id: 'legacy-user-message',
                      role: 'user',
                      content: 'Keep all my old data',
                      timestamp: 1,
                    },
                    {
                      id: 'legacy-assistant-message',
                      role: 'assistant',
                      content: 'Your saved chat survived.',
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
        await asyncStorage.setItem(
          PROJECT_STORAGE_KEY,
          JSON.stringify({
            state: {
              projects: [
                {
                  id: 'legacy-project',
                  name: 'Legacy Research',
                  description: 'Saved before store versioning',
                  systemPrompt: 'Keep legacy project context.',
                  icon: '#6366F1',
                  createdAt: '2024-01-01T00:00:00.000Z',
                  updatedAt: '2024-01-01T00:00:00.000Z',
                },
              ],
            },
            version: 0,
          }),
        );
      },
    });

    await assertLegacySurfaces(firstLaunch);
    firstLaunch.view.unmount();

    const relaunched = await relaunchMainApp();
    await assertLegacySurfaces(relaunched);
    relaunched.view.unmount();
  }, 30000);
});
