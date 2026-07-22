/**
 * P0 regression — choosing the first local text model from Chats → New must
 * enter Chat without eagerly initializing the native runtime. The first send
 * owns lazy loading and must still complete the real local-generation journey.
 */
import { renderMainApp, sendChatMessage } from '../../harness/appJourney';

describe('P0 Chats new-chat model selection', () => {
  it('opens Chat immediately, then lazy-loads the selected model on first send', async () => {
    const { boundary, rtl, view } = await renderMainApp({
      boundary: { llama: true },
    });

    // A native initialization failure at selection time reproduces the
    // production dead tap. Selection must not touch that boundary at all.
    boundary.llama!.scriptInitFailure(true);

    rtl.fireEvent.press(view.getByTestId('chats-tab'));
    rtl.fireEvent.press(await rtl.waitFor(() => view.getByText('New')));
    await rtl.waitFor(() =>
      expect(view.getByText('Select Model')).toBeTruthy(),
    );

    rtl.fireEvent.press(
      view.getByTestId(
        'text-model-row-test/journey-model/journey-model-Q4_K_M.gguf',
      ),
    );

    await rtl.waitFor(() =>
      expect(view.getByTestId('chat-screen')).toBeTruthy(),
    );
    expect(boundary.llama!.module.initLlama).not.toHaveBeenCalled();

    // The selected model remains usable: Send crosses the real lazy-load path,
    // initializes the native boundary once, and renders the generated reply.
    boundary.llama!.scriptInitFailure(false);
    boundary.llama!.scriptCompletion({
      text: 'The selected local model answered.',
    });
    sendChatMessage(rtl, view, 'Can you hear me?');

    await rtl.waitFor(
      () => {
        expect(
          view.getByText('The selected local model answered.'),
        ).toBeTruthy();
        expect(view.queryByTestId('stop-button')).toBeNull();
      },
      { timeout: 8000 },
    );
    expect(boundary.llama!.module.initLlama).toHaveBeenCalledTimes(1);

    view.unmount();
  }, 30000);
});
