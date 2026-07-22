/** P1 #72 — a text request stays on the text pipeline while an image model is active. */
import {
  renderMainApp,
  seedDownloadedMnnImageModel,
  sendChatMessage,
} from '../../harness/appJourney';

describe('P1 non-draw routing full-App journey', () => {
  it('answers a factual prompt as text while keeping the selected image model available', async () => {
    const { boundary, rtl, view } = await renderMainApp({
      boundary: { llama: true },
      beforeRender: async ({ boundary: native, asyncStorage }) => {
        await seedDownloadedMnnImageModel(native, asyncStorage);
      },
    });

    rtl.fireEvent.press(view.getByTestId('models-summary'));
    rtl.fireEvent.press(
      await rtl.waitFor(() => view.getByTestId('models-row-image')),
    );
    rtl.fireEvent.press(
      await rtl.waitFor(() => view.getByText('Journey Image')),
    );
    rtl.fireEvent.press(await rtl.waitFor(() => view.getByText('Done')));
    rtl.fireEvent.press(
      await rtl.waitFor(() => view.getByTestId('new-chat-button')),
    );
    await rtl.waitFor(() =>
      expect(view.getByTestId('chat-screen')).toBeTruthy(),
    );

    boundary.llama!.scriptCompletion({
      text: 'Blue light scatters more strongly in the atmosphere.',
    });
    sendChatMessage(rtl, view, 'Explain why the sky appears blue.');
    rtl.fireEvent.press(
      await rtl.waitFor(() =>
        view.getByTestId(
          'text-model-row-test/journey-model/journey-model-Q4_K_M.gguf',
        ),
      ),
    );
    await rtl.waitFor(
      () => {
        expect(
          view.getByText(
            'Blue light scatters more strongly in the atmosphere.',
          ),
        ).toBeTruthy();
        expect(view.queryByTestId('generated-image')).toBeNull();
        expect(view.queryByTestId('stop-button')).toBeNull();
      },
      { timeout: 10000 },
    );

    view.unmount();
  }, 30000);
});
