/**
 * Regression: choosing an image-intent classifier must not make that private
 * sidecar the user's default text model when a new chat opens.
 */
import type { DownloadedModel } from '../../../src/types';
import {
  renderMainApp,
  seedDownloadedMnnImageModel,
} from '../../harness/appJourney';

const CHAT_MODEL: DownloadedModel = {
  id: 'test/chat-model/chat-Q4_K_M.gguf',
  name: 'Chosen Chat Model',
  author: 'test',
  fileName: 'chat-Q4_K_M.gguf',
  filePath: '/docs/models/chat-Q4_K_M.gguf',
  fileSize: 128 * 1024 * 1024,
  quantization: 'Q4_K_M',
  downloadedAt: '2026-07-17T00:00:00.000Z',
  engine: 'llama',
};

const CLASSIFIER_MODEL: DownloadedModel = {
  id: 'test/classifier/classifier-Q4_K_M.gguf',
  name: 'Private Image Classifier',
  author: 'test',
  fileName: 'classifier-Q4_K_M.gguf',
  filePath: '/docs/models/classifier-Q4_K_M.gguf',
  fileSize: 64 * 1024 * 1024,
  quantization: 'Q4_K_M',
  downloadedAt: '2026-07-17T00:00:00.000Z',
  engine: 'llama',
};

describe('classifier model selection isolation', () => {
  it('keeps the user-selected text model when a new chat mounts', async () => {
    let imageModelId = '';
    const { rtl, view } = await renderMainApp({
      boundary: { llama: true },
      downloadedModels: [CHAT_MODEL, CLASSIFIER_MODEL],
      persistedAppState: {
        activeModelId: CHAT_MODEL.id,
        settings: {
          imageGenerationMode: 'auto',
          autoDetectMethod: 'llm',
          classifierModelId: CLASSIFIER_MODEL.id,
        },
      },
      beforeRender: async ({ boundary, asyncStorage }) => {
        const image = await seedDownloadedMnnImageModel(boundary, asyncStorage);
        imageModelId = image.id;
        const raw = await asyncStorage.getItem('local-llm-app-storage');
        const persisted = JSON.parse(raw ?? '{}');
        persisted.state.activeImageModelId = imageModelId;
        await asyncStorage.setItem(
          'local-llm-app-storage',
          JSON.stringify(persisted),
        );
      },
    });

    rtl.fireEvent.press(view.getByTestId('new-chat-button'));
    await rtl.waitFor(() =>
      expect(view.getByTestId('chat-screen')).toBeTruthy(),
    );

    // Allow the chat-mount effects to settle, then inspect the same model manager
    // the user opens. The classifier must remain an implementation detail.
    await rtl.act(async () => Promise.resolve());
    rtl.fireEvent.press(view.getByTestId('model-selector'));
    const textRow = await rtl.waitFor(() =>
      view.getByTestId('models-row-text'),
    );
    expect(rtl.within(textRow).getByText(CHAT_MODEL.name)).toBeTruthy();
    expect(rtl.within(textRow).queryByText(CLASSIFIER_MODEL.name)).toBeNull();

    view.unmount();
  }, 30000);
});
