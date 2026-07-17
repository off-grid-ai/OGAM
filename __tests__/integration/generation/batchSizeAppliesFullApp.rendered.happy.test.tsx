/** P2 #36 — the Batch Size selected in Settings reaches native model loading. */
import {
  openChatWithJourneyModel,
  renderMainApp,
  sendChatMessage,
} from '../../harness/appJourney';

describe('P2 Batch Size generation setting journey', () => {
  it('loads the model with the rendered Settings value and answers', async () => {
    const { boundary, rtl, view } = await renderMainApp({
      boundary: { llama: true },
    });
    const { act, fireEvent, waitFor } = rtl;

    await act(async () => {
      fireEvent.press(view.getByTestId('settings-tab'));
    });
    await waitFor(() => expect(view.getByText('Model Settings')).toBeTruthy());
    await act(async () => {
      fireEvent.press(view.getByText('Model Settings'));
    });
    await waitFor(() =>
      expect(view.getByTestId('text-generation-accordion')).toBeTruthy(),
    );
    await act(async () => {
      fireEvent.press(view.getByTestId('text-generation-accordion'));
    });
    await waitFor(() =>
      expect(view.getByTestId('text-advanced-toggle')).toBeTruthy(),
    );
    await act(async () => {
      fireEvent.press(view.getByTestId('text-advanced-toggle'));
    });
    await waitFor(() =>
      expect(view.getByTestId('batch-size-stepper-value-button')).toBeTruthy(),
    );

    await act(async () => {
      fireEvent.press(view.getByTestId('batch-size-stepper-value-button'));
    });
    const input = view.getByTestId('batch-size-stepper-input');
    fireEvent.changeText(input, '256');
    fireEvent(input, 'submitEditing');
    await waitFor(() =>
      expect(view.getByTestId('batch-size-stepper-value')).toHaveTextContent(
        '256',
      ),
    );

    await act(async () => {
      fireEvent.press(view.getByTestId('back-button'));
    });
    await waitFor(() => expect(view.getByTestId('home-tab')).toBeTruthy());
    await act(async () => {
      fireEvent.press(view.getByTestId('home-tab'));
    });
    await waitFor(() => expect(view.getByTestId('home-screen')).toBeTruthy());

    await openChatWithJourneyModel(rtl, view);
    boundary.llama!.scriptCompletion({ text: 'Batch size was applied.' });
    sendChatMessage(rtl, view, 'use my load settings');
    await waitFor(() =>
      expect(view.getByText('Batch size was applied.')).toBeTruthy(),
    );

    const initCalls = boundary.llama!.module.initLlama.mock.calls as Array<
      [Record<string, unknown>]
    >;
    expect(initCalls).not.toHaveLength(0);
    expect(initCalls[initCalls.length - 1][0]).toEqual(
      expect.objectContaining({ n_batch: 256, n_ubatch: 256 }),
    );
    view.unmount();
  }, 30000);
});
