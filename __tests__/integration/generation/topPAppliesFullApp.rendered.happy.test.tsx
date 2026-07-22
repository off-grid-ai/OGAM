/** P2 #32 — the Top P selected in Settings reaches the next native generation. */
import {
  openChatWithJourneyModel,
  renderMainApp,
  sendChatMessage,
} from '../../harness/appJourney';

describe('P2 Top P generation setting journey', () => {
  it('applies the rendered Settings value to a successful chat turn', async () => {
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
      expect(view.getByTestId('llama-top-p-value-button')).toBeTruthy(),
    );

    await act(async () => {
      fireEvent.press(view.getByTestId('llama-top-p-value-button'));
    });
    const input = view.getByTestId('llama-top-p-input');
    fireEvent.changeText(input, '0.42');
    fireEvent(input, 'submitEditing');
    await waitFor(() =>
      expect(view.getByTestId('llama-top-p-value')).toHaveTextContent('0.42'),
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
    boundary.llama!.scriptCompletion({ text: 'Top P was applied.' });
    sendChatMessage(rtl, view, 'use my sampling settings');
    await waitFor(() =>
      expect(view.getByText('Top P was applied.')).toBeTruthy(),
    );

    const completions = boundary.llama!.calls.completion;
    expect(completions).not.toHaveLength(0);
    expect(completions[completions.length - 1][0]).toEqual(
      expect.objectContaining({ top_p: 0.42 }),
    );
    view.unmount();
  }, 30000);
});
