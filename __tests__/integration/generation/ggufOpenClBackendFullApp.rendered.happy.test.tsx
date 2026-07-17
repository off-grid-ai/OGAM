/** P1 #25 — the rendered App loads and answers with the selected OpenCL backend. */
import {
  openChatWithJourneyModel,
  renderMainApp,
  sendChatMessage,
} from '../../harness/appJourney';

describe('P1 full-App GGUF OpenCL backend journey', () => {
  it('selects OpenCL in Settings and visibly completes on offloaded GPU layers', async () => {
    const journey = await renderMainApp({
      boundary: { llama: true },
      beforeRender: () => {
        // Native SoC discovery is outside the app. Qualcomm is a supported
        // Android OpenCL family, so the real capability policy accepts it.
        const DeviceInfo = require('react-native-device-info');
        (DeviceInfo.getHardware as jest.Mock).mockResolvedValue('qcom');
      },
    });
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
    rtl.fireEvent.press(
      await rtl.waitFor(() => view.getByTestId('backend-opencl-button')),
    );
    rtl.fireEvent.press(view.getByTestId('show-gen-details-on-button'));
    await rtl.waitFor(() => {
      expect(
        view.getByTestId('backend-opencl-button').props.accessibilityState
          .selected,
      ).toBe(true);
      expect(
        view.getByTestId('show-gen-details-on-button').props.accessibilityState
          .selected,
      ).toBe(true);
    });

    rtl.fireEvent.press(view.getByTestId('back-button'));
    rtl.fireEvent.press(await rtl.waitFor(() => view.getByTestId('home-tab')));
    await openChatWithJourneyModel(rtl, view);

    boundary.llama!.scriptCompletion({
      text: 'The OpenCL-backed model answered successfully.',
    });
    sendChatMessage(rtl, view, 'Confirm GPU acceleration');

    await rtl.waitFor(
      () => {
        expect(
          view.getByText('The OpenCL-backed model answered successfully.'),
        ).toBeTruthy();
        const meta = view.getByTestId('generation-meta');
        expect(rtl.within(meta).getByText(/OpenCL \(\d+L\)/)).toBeTruthy();
        expect(rtl.within(meta).queryByText('CPU')).toBeNull();
        expect(view.getByTestId('chat-input').props.value).toBe('');
        expect(view.queryByTestId('stop-button')).toBeNull();
        expect(view.queryByTestId('queue-indicator')).toBeNull();
      },
      { timeout: 12000 },
    );

    const textLoads = boundary
      .llama!.module.initLlama.mock.calls.map(
        call => call[0] as { embedding?: boolean; n_gpu_layers?: number },
      )
      .filter(request => !request.embedding);
    expect(textLoads.length).toBeGreaterThan(0);
    expect(textLoads.at(-1)?.n_gpu_layers).toBeGreaterThan(0);

    view.unmount();
  }, 30000);
});
