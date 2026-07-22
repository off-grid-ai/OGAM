/** P1 #107 — an ejected model reloads automatically on its next real use. */
import {
  openChatWithJourneyModel,
  renderMainApp,
  sendChatMessage,
} from '../../harness/appJourney';
import { GB } from '../../harness/nativeBoundary';

describe('P1 lazy reload after eject journey', () => {
  it('reloads ejected Text on the next send and renders its answer', async () => {
    const { boundary, rtl, view } = await renderMainApp({
      boundary: {
        llama: true,
        ram: { platform: 'android', totalBytes: 12 * GB, availBytes: 10 * GB },
      },
    });
    const { act, fireEvent, waitFor } = rtl;

    await openChatWithJourneyModel(rtl, view);
    boundary.llama!.scriptCompletion({ text: 'The model is warm.' });
    sendChatMessage(rtl, view, 'warm up');
    await waitFor(() =>
      expect(view.getByText('The model is warm.')).toBeTruthy(),
    );

    // The real manager surface proves Text is resident, then the user ejects
    // exactly that row without changing the selected model.
    await act(async () => {
      fireEvent.press(view.getByTestId('model-selector'));
    });
    await waitFor(() => {
      expect(view.getByTestId('models-row-text-ram')).toBeTruthy();
      expect(view.getByTestId('models-row-text-eject')).toBeTruthy();
      expect(view.getByTestId('models-row-text')).toHaveTextContent(
        /Journey Model/,
      );
    });
    await act(async () => {
      fireEvent.press(view.getByTestId('models-row-text-eject'));
    });
    await waitFor(() => {
      expect(view.queryByTestId('models-row-text-ram')).toBeNull();
      expect(view.queryByTestId('models-row-text-eject')).toBeNull();
      expect(view.getByTestId('models-row-text')).toHaveTextContent(
        /Journey Model/,
      );
    });
    await act(async () => {
      fireEvent.press(view.getByText('Done'));
    });
    await waitFor(() => expect(view.getByTestId('chat-input')).toBeTruthy());

    // No re-selection or load control: the next owning Text action is a normal
    // send. Its rendered reply proves the native engine was reloaded and used.
    boundary.llama!.scriptCompletion({ text: 'Lazy reload succeeded.' });
    sendChatMessage(rtl, view, 'answer after eject');
    await waitFor(
      () => expect(view.getByText('Lazy reload succeeded.')).toBeTruthy(),
      { timeout: 8000 },
    );

    // Reopen the product residency surface to verify the successful turn put
    // the still-selected Text model back in memory.
    await act(async () => {
      fireEvent.press(view.getByTestId('model-selector'));
    });
    await waitFor(() => {
      expect(view.getByTestId('models-row-text-ram')).toBeTruthy();
      expect(view.getByTestId('models-row-text-eject')).toBeTruthy();
      expect(view.getByTestId('models-row-text')).toHaveTextContent(
        /Journey Model/,
      );
    });

    view.unmount();
  }, 30000);
});
