/** P2 #26 — the rendered GGUF CPU backend reaches native model initialization. */
import {
  openChatWithJourneyModel,
  renderMainApp,
  sendChatMessage,
} from '../../harness/appJourney';

describe('P2 full-App GGUF CPU backend journey', () => {
  it('initializes with zero GPU layers and completes a visible reply', async () => {
    const journey = await renderMainApp({ boundary: { llama: true } });
    const { boundary, rtl, view } = journey;

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
    const cpu = await rtl.waitFor(() => view.getByTestId('backend-cpu-button'));
    rtl.fireEvent.press(cpu);
    await rtl.waitFor(() =>
      expect(
        view.getByTestId('backend-cpu-button').props.accessibilityState
          .selected,
      ).toBe(true),
    );

    rtl.fireEvent.press(view.getByTestId('back-button'));
    rtl.fireEvent.press(await rtl.waitFor(() => view.getByTestId('home-tab')));
    await rtl.waitFor(() =>
      expect(view.getByTestId('home-screen')).toBeTruthy(),
    );

    await openChatWithJourneyModel(rtl, view);
    boundary.llama!.scriptCompletion({
      text: 'The CPU-backed model answered successfully.',
    });
    sendChatMessage(rtl, view, 'Confirm the selected backend');

    await rtl.waitFor(
      () => {
        expect(
          view.getByText('The CPU-backed model answered successfully.'),
        ).toBeTruthy();
        expect(view.getByTestId('chat-input').props.value).toBe('');
        expect(view.queryByTestId('stop-button')).toBeNull();
        expect(view.queryByTestId('queue-indicator')).toBeNull();
      },
      { timeout: 8000 },
    );

    const textLoads = boundary
      .llama!.module.initLlama.mock.calls.map(
        call => call[0] as { embedding?: boolean; n_gpu_layers?: number },
      )
      .filter(request => !request.embedding);
    expect(textLoads.length).toBeGreaterThan(0);
    expect(textLoads.at(-1)).toEqual(
      expect.objectContaining({ n_gpu_layers: 0 }),
    );

    view.unmount();
  }, 30000);
});
