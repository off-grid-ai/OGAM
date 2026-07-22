/** P2 #35 — the CPU-thread setting reaches the native text-model load. */
import {
  openChatWithJourneyModel,
  renderMainApp,
  sendChatMessage,
} from '../../harness/appJourney';

describe('P2 full-app CPU threads journey', () => {
  it('loads and generates with the thread count chosen in Settings', async () => {
    const { boundary, rtl, view } = await renderMainApp({
      boundary: { llama: true },
    });

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
    rtl.fireEvent.press(
      await rtl.waitFor(() =>
        view.getByTestId('cpu-threads-stepper-value-button'),
      ),
    );
    const threadInput = await rtl.waitFor(() =>
      view.getByTestId('cpu-threads-stepper-input'),
    );
    rtl.fireEvent.changeText(threadInput, '7');
    rtl.fireEvent(threadInput, 'submitEditing');
    await rtl.waitFor(() =>
      expect(view.getByTestId('cpu-threads-stepper-value')).toHaveTextContent(
        '7',
      ),
    );

    rtl.fireEvent.press(view.getByTestId('back-button'));
    rtl.fireEvent.press(await rtl.waitFor(() => view.getByTestId('home-tab')));
    boundary.llama!.scriptCompletion({
      text: 'Seven-thread generation completed.',
    });
    await openChatWithJourneyModel(rtl, view);
    sendChatMessage(rtl, view, 'confirm the configured inference path');

    await rtl.waitFor(() =>
      expect(view.getByText('Seven-thread generation completed.')).toBeTruthy(),
    );
    const initRequests = boundary.llama!.module.initLlama.mock.calls.map(
      call => call[0],
    );
    expect(initRequests).toEqual(
      expect.arrayContaining([expect.objectContaining({ n_threads: 7 })]),
    );

    view.unmount();
  });
});
