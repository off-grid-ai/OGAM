/** P1 #28 — the rendered GPU Layers control reaches the native load and visible reply metadata. */
import {
  openChatWithJourneyModel,
  renderMainApp,
  sendChatMessage,
} from '../../harness/appJourney';

describe('P1 full-App GGUF GPU layers journey', () => {
  it('applies the selected OpenCL layer count to the lazy native load', async () => {
    const journey = await renderMainApp({
      boundary: { llama: true },
      beforeRender: () => {
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
    rtl.fireEvent.press(view.getByTestId('backend-opencl-button'));
    rtl.fireEvent(
      view.getByTestId('gpu-layers-stepper-slider'),
      'slidingComplete',
      7,
    );
    rtl.fireEvent.press(view.getByTestId('show-gen-details-on-button'));
    await rtl.waitFor(() => {
      expect(view.getByTestId('gpu-layers-stepper-value').props.children).toBe(
        '7',
      );
      expect(
        view.getByTestId('show-gen-details-on-button').props.accessibilityState
          .selected,
      ).toBe(true);
    });

    rtl.fireEvent.press(view.getByTestId('back-button'));
    rtl.fireEvent.press(await rtl.waitFor(() => view.getByTestId('home-tab')));
    await openChatWithJourneyModel(rtl, view);

    boundary.llama!.scriptCompletion({
      text: 'The seven-layer model answered successfully.',
    });
    sendChatMessage(rtl, view, 'Use my selected GPU layer count');

    await rtl.waitFor(
      () => {
        expect(
          view.getByText('The seven-layer model answered successfully.'),
        ).toBeTruthy();
        expect(
          rtl
            .within(view.getByTestId('generation-meta'))
            .getByText('OpenCL (7L)'),
        ).toBeTruthy();
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
    expect(textLoads.at(-1)).toEqual(
      expect.objectContaining({ n_gpu_layers: 7 }),
    );

    view.unmount();
  }, 30000);
});
