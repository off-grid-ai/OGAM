import { renderMainApp, sendChatMessage } from '../../harness/appJourney';
import { createDownloadedModel } from '../../utils/factories';

const MODEL_A_ID = 'test/active-a/active-a-Q4_K_M.gguf';
const MODEL_B_ID = 'test/fallback-b/fallback-b-Q4_K_M.gguf';

describe('APP-P1-005 active resident deletion', () => {
  it('unloads the deleted resident and selects the surviving model as a coherent fallback', async () => {
    const models = [
      createDownloadedModel({
        id: MODEL_A_ID,
        name: 'Active Alpha',
        fileName: 'active-a-Q4_K_M.gguf',
        filePath: '/docs/models/active-a-Q4_K_M.gguf',
      }),
      createDownloadedModel({
        id: MODEL_B_ID,
        name: 'Fallback Bravo',
        fileName: 'fallback-b-Q4_K_M.gguf',
        filePath: '/docs/models/fallback-b-Q4_K_M.gguf',
      }),
    ];
    const { boundary, rtl, view } = await renderMainApp({
      downloadedModels: models,
      persistedAppState: { activeModelId: MODEL_A_ID },
      boundary: { llama: true },
    });
    boundary.llama!.scriptCompletion({ text: 'Alpha is resident.' });

    rtl.fireEvent.press(view.getByTestId('new-chat-button'));
    await rtl.waitFor(() =>
      expect(view.getByTestId('chat-input')).toBeTruthy(),
    );
    sendChatMessage(rtl, view, 'Load the selected alpha model');
    await rtl.waitFor(
      () => {
        expect(view.getByText('Alpha is resident.')).toBeTruthy();
        expect(view.queryByTestId('stop-button')).toBeNull();
      },
      { timeout: 8000 },
    );

    rtl.fireEvent.press(view.getByTestId('chat-back-button'));
    rtl.fireEvent.press(view.getByTestId('models-tab'));
    await rtl.waitFor(() =>
      expect(view.getByTestId('models-screen')).toBeTruthy(),
    );
    rtl.fireEvent.press(view.getByTestId('downloads-icon'));
    const alphaCard = await rtl.waitFor(() =>
      view.getByTestId(`completed-download-${MODEL_A_ID}`),
    );
    rtl.fireEvent.press(
      rtl.within(alphaCard).getByTestId('delete-model-button'),
    );
    await rtl.waitFor(() =>
      expect(view.getByText('Delete Model')).toBeTruthy(),
    );
    rtl.fireEvent.press(view.getByText('Delete'));
    await rtl.waitFor(
      () => {
        expect(
          view.queryByTestId(`completed-download-${MODEL_A_ID}`),
        ).toBeNull();
        expect(
          view.getByTestId(`completed-download-${MODEL_B_ID}`),
        ).toBeTruthy();
      },
      { timeout: 8000 },
    );

    rtl.fireEvent.press(view.getByTestId('back-button'));
    rtl.fireEvent.press(view.getByTestId('home-tab'));
    rtl.fireEvent.press(view.getByTestId('new-chat-button'));
    await rtl.waitFor(() =>
      expect(view.getByTestId('model-selector')).toBeTruthy(),
    );
    rtl.fireEvent.press(view.getByTestId('model-selector'));
    await rtl.waitFor(() => {
      expect(view.getByTestId('models-row-text')).toBeTruthy();
      expect(view.getByText('Fallback Bravo')).toBeTruthy();
    });
    rtl.fireEvent.press(view.getByTestId('models-row-text'));
    await rtl.waitFor(() => {
      expect(view.queryByTestId('currently-loaded-model')).toBeNull();
      expect(view.getByText('Switch Model')).toBeTruthy();
      expect(view.getByTestId(`text-model-row-${MODEL_B_ID}`)).toBeTruthy();
      expect(view.queryByTestId(`text-model-row-${MODEL_A_ID}`)).toBeNull();
    });
  }, 30000);
});
