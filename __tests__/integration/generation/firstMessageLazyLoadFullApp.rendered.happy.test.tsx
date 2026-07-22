/** P0 #23 — the first GGUF message lazy-loads the selected model and renders its reply. */
import {
  openChatWithJourneyModel,
  renderMainApp,
  sendChatMessage,
} from '../../harness/appJourney';
import { GB } from '../../harness/nativeBoundary';

describe('P0 first-message lazy-load journey', () => {
  it('keeps the selected model unloaded until send, then renders its reply and residency', async () => {
    const { boundary, rtl, view } = await renderMainApp({
      boundary: {
        llama: true,
        ram: { platform: 'android', totalBytes: 8 * GB, availBytes: 6 * GB },
      },
    });
    const { act, fireEvent, waitFor } = rtl;

    await openChatWithJourneyModel(rtl, view);

    // Selecting a downloaded model and opening Chat must not eagerly consume
    // memory. The real model manager is the user-visible source of truth.
    await act(async () => {
      fireEvent.press(view.getByTestId('model-selector'));
    });
    await waitFor(() => {
      expect(view.getByTestId('models-row-text')).toHaveTextContent(
        /Journey Model/,
      );
      expect(view.queryByTestId('models-row-text-ram')).toBeNull();
      expect(view.queryByTestId('models-row-text-eject')).toBeNull();
    });
    await act(async () => {
      fireEvent.press(view.getByText('Done'));
    });
    await waitFor(() => expect(view.getByTestId('chat-input')).toBeTruthy());

    boundary.llama!.scriptCompletion({
      text: 'Paris is the capital of France.',
    });
    sendChatMessage(rtl, view, 'What is the capital of France?');

    await waitFor(
      () => {
        expect(
          view.getAllByText('What is the capital of France?').length,
        ).toBeGreaterThan(0);
        expect(view.getByText('Paris is the capital of France.')).toBeTruthy();
        expect(view.queryByTestId('stop-button')).toBeNull();
      },
      { timeout: 8000 },
    );

    // The successful first turn must leave the same selected model visibly
    // resident, proving send crossed the real lazy-load path.
    await act(async () => {
      fireEvent.press(view.getByTestId('model-selector'));
    });
    await waitFor(() => {
      expect(view.getByTestId('models-row-text')).toHaveTextContent(
        /Journey Model/,
      );
      expect(view.getByTestId('models-row-text-ram')).toBeTruthy();
      expect(view.getByTestId('models-row-text-eject')).toBeTruthy();
    });

    view.unmount();
  }, 30000);
});
