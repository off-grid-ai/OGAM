/** Image generation renders native preview progress and can be cancelled through the real App. */
import {
  renderMainApp,
  seedDownloadedMnnImageModel,
} from '../../harness/appJourney';
import { GB } from '../../harness/nativeBoundary';

describe('full-App image preview and cancellation journey', () => {
  it('shows the refining preview, then returns to an idle composer when the user stops', async () => {
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

    let rejectNativeGeneration: ((error: Error) => void) | undefined;
    boundary.diffusion.module.generateImage.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectNativeGeneration = reject;
        }),
    );
    boundary.diffusion.module.cancelGeneration.mockImplementationOnce(
      async () => {
        rejectNativeGeneration?.(new Error('cancelled'));
        return true;
      },
    );

    rtl.fireEvent.changeText(
      view.getByTestId('chat-input'),
      'a forest at dusk',
    );
    rtl.fireEvent.press(view.getByTestId('send-button'));
    await rtl.waitFor(() =>
      expect(view.getByText('Generating Image')).toBeTruthy(),
    );

    boundary.fs!.seedFile('/generated/preview-step-4.png', 512);
    await rtl.act(async () => {
      boundary.litertEvents.emit('LocalDreamProgress', {
        step: 4,
        totalSteps: 8,
        progress: 0.5,
        previewPath: '/generated/preview-step-4.png',
      });
    });
    await rtl.waitFor(() => {
      expect(view.getByText('Refining Image')).toBeTruthy();
      expect(view.getByText('Refining image (4/8)...')).toBeTruthy();
      expect(view.queryByTestId('image-progress-placeholder-icon')).toBeNull();
    });

    let progressAncestor = view.getByText('Refining Image').parent;
    let imageStopButton = progressAncestor
      ?.findAll(node => typeof node.props.onPress === 'function')
      .at(0);
    while (progressAncestor?.parent && !imageStopButton) {
      progressAncestor = progressAncestor.parent;
      imageStopButton = progressAncestor
        .findAll(node => typeof node.props.onPress === 'function')
        .at(0);
    }
    expect(imageStopButton).toBeTruthy();
    rtl.fireEvent.press(imageStopButton!);
    await rtl.waitFor(() => {
      expect(view.queryByText('Refining Image')).toBeNull();
      expect(view.queryByText('Generating Image')).toBeNull();
      expect(view.queryByTestId('generated-image')).toBeNull();
    });
    expect(boundary.diffusion.module.cancelGeneration).toHaveBeenCalledTimes(1);

    rtl.fireEvent.changeText(view.getByTestId('chat-input'), 'ready again');
    expect(view.getByTestId('send-button')).toBeTruthy();

    view.unmount();
  }, 30000);
});
