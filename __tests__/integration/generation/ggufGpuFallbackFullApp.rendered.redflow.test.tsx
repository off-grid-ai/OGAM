/** P1 #191 — accelerator init failure visibly falls back to CPU in the real App. */
import { Platform } from 'react-native';
import {
  openChatWithJourneyModel,
  renderMainApp,
  sendChatMessage,
} from '../../harness/appJourney';
import type { NativeBoundary } from '../../harness/nativeBoundary';

async function openAcceleratedChat(
  configureBoundary: (boundary: NativeBoundary) => void,
) {
  const journey = await renderMainApp({
    boundary: { llama: true },
    beforeRender: () => {
      // Native SoC discovery is the uncontrollable boundary. A Qualcomm device
      // makes the real capability policy accept OpenCL before init is exercised.
      const DeviceInfo = require('react-native-device-info');
      (DeviceInfo.getHardware as jest.Mock).mockResolvedValue('qcom');
    },
  });
  const { boundary, rtl, view } = journey;
  const backend = Platform.OS === 'ios' ? 'metal' : 'opencl';

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
    await rtl.waitFor(() => view.getByTestId(`backend-${backend}-button`)),
  );
  await rtl.waitFor(() =>
    expect(
      view.getByTestId(`backend-${backend}-button`).props.accessibilityState
        .selected,
    ).toBe(true),
  );

  rtl.fireEvent.press(view.getByTestId('back-button'));
  rtl.fireEvent.press(await rtl.waitFor(() => view.getByTestId('home-tab')));
  configureBoundary(boundary);
  await openChatWithJourneyModel(rtl, view);
  return journey;
}

describe('P1 full-App GGUF accelerator fallback journey', () => {
  it('reports the CPU downgrade and completes after native GPU init fails', async () => {
    const journey = await openAcceleratedChat(boundary => {
      boundary.llama!.scriptGpuInitFailure();
      boundary.llama!.scriptCompletion({
        text: 'The CPU fallback answered successfully.',
      });
    });
    const { boundary, rtl, view } = journey;

    sendChatMessage(rtl, view, 'Recover from accelerator initialization');

    await rtl.waitFor(
      () =>
        expect(
          view.getByText('The CPU fallback answered successfully.'),
        ).toBeTruthy(),
      { timeout: 12000 },
    );

    const textLoads = boundary
      .llama!.module.initLlama.mock.calls.map(
        call => call[0] as { embedding?: boolean; n_gpu_layers?: number },
      )
      .filter(request => !request.embedding);
    expect(textLoads.some(request => (request.n_gpu_layers ?? 0) > 0)).toBe(
      true,
    );
    expect(textLoads.at(-1)).toEqual(
      expect.objectContaining({ n_gpu_layers: 0 }),
    );
    await rtl.waitFor(
      () => {
        expect(view.getByText(/running on CPU/i)).toBeTruthy();
        expect(
          view.getByText('The CPU fallback answered successfully.'),
        ).toBeTruthy();
        expect(view.getByTestId('chat-input').props.value).toBe('');
        expect(view.queryByTestId('stop-button')).toBeNull();
        expect(view.queryByTestId('queue-indicator')).toBeNull();
      },
      { timeout: 12000 },
    );
    expect(view.getAllByText(/running on CPU/i)).toHaveLength(1);

    view.unmount();
  }, 30000);

  it('trusts a successful native init that reports zero offloaded layers', async () => {
    const journey = await openAcceleratedChat(boundary => {
      boundary.llama!.scriptGpuNativeRefusal();
      boundary.llama!.scriptCompletion({
        text: 'The native-refusal fallback answered successfully.',
      });
    });
    const { boundary, rtl, view } = journey;

    sendChatMessage(rtl, view, 'Handle a silent native offload refusal');

    await rtl.waitFor(
      () => {
        expect(view.getByText(/running on CPU/i)).toBeTruthy();
        expect(
          view.getByText('The native-refusal fallback answered successfully.'),
        ).toBeTruthy();
        expect(view.queryByTestId('stop-button')).toBeNull();
        expect(view.queryByTestId('queue-indicator')).toBeNull();
      },
      { timeout: 12000 },
    );
    expect(view.getAllByText(/running on CPU/i)).toHaveLength(1);

    const textLoads = boundary
      .llama!.module.initLlama.mock.calls.map(
        call => call[0] as { embedding?: boolean; n_gpu_layers?: number },
      )
      .filter(request => !request.embedding);
    expect(textLoads.at(-1)?.n_gpu_layers).toBeGreaterThan(0);

    view.unmount();
  }, 30000);
});
