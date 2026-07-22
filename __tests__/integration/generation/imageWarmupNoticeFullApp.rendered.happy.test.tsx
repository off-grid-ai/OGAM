/** P2 #76 — image warmup messaging matches the model's real first run. */
import {
  renderMainApp,
  seedDownloadedMnnImageModel,
} from '../../harness/appJourney';
import { GB } from '../../harness/nativeBoundary';

describe('P2 full-app first-image warmup notice', () => {
  it('shows one-time optimization only for the first generation and clears it', async () => {
    const { boundary, rtl, view } = await renderMainApp({
      boundary: {
        ram: { platform: 'android', totalBytes: 8 * GB, availBytes: 6 * GB },
      },
      beforeRender: async ({ boundary: native, asyncStorage }) => {
        await seedDownloadedMnnImageModel(native, asyncStorage);
      },
    });

    rtl.fireEvent.press(view.getByTestId('models-summary'));
    rtl.fireEvent.press(
      await rtl.waitFor(() => view.getByTestId('models-row-image')),
    );
    await rtl.waitFor(() =>
      expect(view.getByText('Journey Image')).toBeTruthy(),
    );
    rtl.fireEvent.press(view.getByTestId('model-item'));
    rtl.fireEvent.press(
      await rtl.waitFor(() => view.getByTestId('new-chat-button')),
    );
    await rtl.waitFor(() =>
      expect(view.getByTestId('chat-screen')).toBeTruthy(),
    );

    rtl.fireEvent.press(view.getByTestId('quick-settings-button'));
    rtl.fireEvent.press(
      await rtl.waitFor(() => view.getByTestId('quick-image-mode')),
    );
    const ReactNative =
      require('react-native') as typeof import('react-native');
    const visibleModal = view
      .UNSAFE_getAllByType(ReactNative.Modal)
      .find(modal => modal.props.visible);
    await rtl.act(async () => {
      rtl.fireEvent(visibleModal!, 'requestClose');
    });

    let releaseGeneration: (() => void) | undefined;
    const holdNextNativeGeneration = (id: string) => {
      boundary.diffusion.module.generateImage.mockImplementationOnce(
        (params: Record<string, unknown>) =>
          new Promise(resolve => {
            releaseGeneration = () => {
              const imagePath = `/generated/${id}.png`;
              boundary.fs!.seedFile(imagePath, 1024);
              resolve({
                id,
                imagePath,
                width: params.width,
                height: params.height,
                seed: params.seed,
              });
            };
          }),
      );
    };

    holdNextNativeGeneration('first-warmed-image');
    rtl.fireEvent.changeText(view.getByTestId('chat-input'), 'a blue sailboat');
    rtl.fireEvent.press(view.getByTestId('send-button'));
    try {
      await rtl.waitFor(() =>
        expect(
          view.getByText('Optimizing GPU for your device (~120s, one-time)...'),
        ).toBeTruthy(),
      );

      boundary.litertEvents.emit('LocalDreamProgress', {
        step: 2,
        totalSteps: 8,
        progress: 0.25,
      });
      await rtl.waitFor(() =>
        expect(
          view.getByText(
            'Generating image (2/8)... (optimizing GPU, one-time)',
          ),
        ).toBeTruthy(),
      );
    } finally {
      await rtl.act(async () => releaseGeneration?.());
    }
    await rtl.waitFor(() => {
      expect(view.getAllByTestId('generated-image')).toHaveLength(1);
      expect(view.queryByText(/one-time/)).toBeNull();
    });

    // Force mode is intentionally one-turn; choose it again through the same
    // visible control so the second prompt is another image generation.
    rtl.fireEvent.press(view.getByTestId('quick-settings-button'));
    rtl.fireEvent.press(
      await rtl.waitFor(() => view.getByTestId('quick-image-mode')),
    );
    await rtl.waitFor(() =>
      expect(view.getByTestId('image-mode-force-badge')).toBeTruthy(),
    );
    const secondVisibleModal = view
      .UNSAFE_getAllByType(ReactNative.Modal)
      .find(modal => modal.props.visible);
    await rtl.act(async () => {
      rtl.fireEvent(secondVisibleModal!, 'requestClose');
    });

    holdNextNativeGeneration('second-warmed-image');
    rtl.fireEvent.changeText(view.getByTestId('chat-input'), 'a red sailboat');
    rtl.fireEvent.press(view.getByTestId('send-button'));
    try {
      await rtl.waitFor(() =>
        expect(view.getByText('Starting image generation...')).toBeTruthy(),
      );
      expect(view.queryByText(/one-time/)).toBeNull();

      boundary.litertEvents.emit('LocalDreamProgress', {
        step: 2,
        totalSteps: 8,
        progress: 0.25,
      });
      await rtl.waitFor(() =>
        expect(view.getByText('Generating image (2/8)...')).toBeTruthy(),
      );
      expect(view.queryByText(/one-time/)).toBeNull();
    } finally {
      await rtl.act(async () => releaseGeneration?.());
    }
    await rtl.waitFor(() => {
      expect(view.getAllByTestId('generated-image')).toHaveLength(2);
      expect(view.queryByText(/one-time/)).toBeNull();
    });

    view.unmount();
  }, 30000);
});
