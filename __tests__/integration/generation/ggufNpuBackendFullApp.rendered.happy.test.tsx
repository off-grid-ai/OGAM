/** P1 #30 — a compatible Snapdragon exposes HTP and completes on the selected NPU backend. */
import type { DownloadedModel } from '../../../src/types';
import {
  openChatWithJourneyModel,
  renderMainApp,
  sendChatMessage,
} from '../../harness/appJourney';

const NPU_MODEL: DownloadedModel = {
  id: 'test/llama-npu/llama-3-Q4_0.gguf',
  name: 'Llama NPU Model',
  author: 'test',
  fileName: 'llama-3-Q4_0.gguf',
  filePath: '/docs/models/llama-3-Q4_0.gguf',
  fileSize: 128 * 1024 * 1024,
  quantization: 'Q4_0',
  downloadedAt: '2026-01-01T00:00:00.000Z',
  engine: 'llama',
};

describe('P1 full-App GGUF NPU backend journey', () => {
  it('gates HTP on native SoC support and sends the selected layers to HTP0', async () => {
    const journey = await renderMainApp({
      boundary: { llama: true },
      downloadedModels: [NPU_MODEL],
      beforeRender: ({ boundary }) => {
        const DeviceInfo = require('react-native-device-info');
        (DeviceInfo.getHardware as jest.Mock).mockResolvedValue('qcom');
        boundary.diffusion.module.getSoCModel = jest
          .fn()
          .mockResolvedValue('SM8550-AB');
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
      await rtl.waitFor(() => view.getByTestId('backend-htp-button')),
    );
    rtl.fireEvent(
      view.getByTestId('gpu-layers-stepper-slider'),
      'slidingComplete',
      8,
    );
    rtl.fireEvent.press(view.getByTestId('show-gen-details-on-button'));
    await rtl.waitFor(() => {
      expect(
        view.getByTestId('backend-htp-button').props.accessibilityState
          .selected,
      ).toBe(true);
      expect(view.getByTestId('gpu-layers-stepper-value').props.children).toBe(
        '8',
      );
    });

    rtl.fireEvent.press(view.getByTestId('back-button'));
    rtl.fireEvent.press(await rtl.waitFor(() => view.getByTestId('home-tab')));
    await openChatWithJourneyModel(rtl, view);

    boundary.llama!.scriptCompletion({
      text: 'The HTP-backed model answered successfully.',
    });
    sendChatMessage(rtl, view, 'Confirm NPU acceleration');

    await rtl.waitFor(
      () => {
        expect(
          view.getByText('The HTP-backed model answered successfully.'),
        ).toBeTruthy();
        expect(
          rtl
            .within(view.getByTestId('generation-meta'))
            .getByText('HTP0 (8L)'),
        ).toBeTruthy();
        expect(view.queryByTestId('stop-button')).toBeNull();
        expect(view.queryByTestId('queue-indicator')).toBeNull();
      },
      { timeout: 12000 },
    );

    const textLoads = boundary
      .llama!.module.initLlama.mock.calls.map(
        call =>
          call[0] as {
            embedding?: boolean;
            devices?: string[];
            n_gpu_layers?: number;
          },
      )
      .filter(request => !request.embedding);
    expect(textLoads.at(-1)).toEqual(
      expect.objectContaining({ devices: ['HTP0'], n_gpu_layers: 8 }),
    );

    view.unmount();
  }, 30000);

  it('does not offer HTP when native SoC discovery reports no compatible NPU', async () => {
    let getHardware!: jest.Mock;
    const journey = await renderMainApp({
      boundary: { llama: true },
      downloadedModels: [NPU_MODEL],
      beforeRender: () => {
        const DeviceInfo = require('react-native-device-info');
        getHardware = DeviceInfo.getHardware as jest.Mock;
        getHardware.mockResolvedValue('mediatek-mt6895');
      },
    });
    const { rtl, view } = journey;

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
    await rtl.waitFor(() => expect(getHardware).toHaveBeenCalled());

    expect(view.queryByTestId('backend-htp-button')).toBeNull();
    expect(view.getByTestId('backend-cpu-button')).toBeTruthy();
    expect(view.getByTestId('backend-opencl-button')).toBeTruthy();

    view.unmount();
  });
});
