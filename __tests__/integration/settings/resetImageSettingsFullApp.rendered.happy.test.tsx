/** P2 #74 — Reset to Defaults restores image settings all the way to generation. */
import {
  renderMainApp,
  seedDownloadedMnnImageModel,
} from '../../harness/appJourney';
import { GB } from '../../harness/nativeBoundary';

describe('P2 reset image settings journey', () => {
  it('visibly restores changed image parameters and generates with the defaults', async () => {
    const { boundary, rtl, view } = await renderMainApp({
      boundary: {
        ram: { platform: 'android', totalBytes: 8 * GB, availBytes: 6 * GB },
      },
      beforeRender: async ({ boundary: native, asyncStorage }) => {
        await seedDownloadedMnnImageModel(native, asyncStorage);
      },
    });
    const { act, fireEvent, waitFor } = rtl;

    fireEvent.press(view.getByTestId('settings-tab'));
    fireEvent.press(await waitFor(() => view.getByText('Model Settings')));
    fireEvent.press(
      await waitFor(() => view.getByTestId('image-generation-accordion')),
    );

    fireEvent.press(
      await waitFor(() => view.getByTestId('image-steps-value-button')),
    );
    const stepsInput = view.getByTestId('image-steps-input');
    fireEvent.changeText(stepsInput, '24');
    fireEvent(stepsInput, 'submitEditing');

    fireEvent.press(view.getByTestId('image-size-value-button'));
    const sizeInput = view.getByTestId('image-size-input');
    fireEvent.changeText(sizeInput, '256');
    fireEvent(sizeInput, 'submitEditing');

    fireEvent.press(view.getByTestId('image-advanced-toggle'));
    fireEvent.press(
      await waitFor(() =>
        view.getByTestId('image-guidance-scale-value-button'),
      ),
    );
    const guidanceInput = view.getByTestId('image-guidance-scale-input');
    fireEvent.changeText(guidanceInput, '3.5');
    fireEvent(guidanceInput, 'submitEditing');

    fireEvent.press(view.getByTestId('image-threads-value-button'));
    const threadsInput = view.getByTestId('image-threads-input');
    fireEvent.changeText(threadsInput, '2');
    fireEvent(threadsInput, 'submitEditing');

    await waitFor(() => {
      expect(view.getByTestId('image-steps-value')).toHaveTextContent('24');
      expect(view.getByTestId('image-size-value')).toHaveTextContent('256x256');
      expect(view.getByTestId('image-guidance-scale-value')).toHaveTextContent(
        '3.5',
      );
      expect(view.getByTestId('image-threads-value')).toHaveTextContent('2');
    });

    fireEvent.press(view.getByTestId('reset-settings-button'));
    await waitFor(() =>
      expect(view.getByText('Reset All Settings')).toBeTruthy(),
    );
    await act(async () => {
      fireEvent.press(view.getByText('Reset'));
    });

    await waitFor(() => {
      expect(view.getByTestId('image-steps-value')).toHaveTextContent('8');
      expect(view.getByTestId('image-size-value')).toHaveTextContent('512x512');
      expect(view.getByTestId('image-guidance-scale-value')).toHaveTextContent(
        '7.5',
      );
      expect(view.getByTestId('image-threads-value')).toHaveTextContent('4');
    });

    fireEvent.press(view.getByTestId('back-button'));
    fireEvent.press(await waitFor(() => view.getByTestId('home-tab')));
    fireEvent.press(view.getByTestId('models-summary'));
    fireEvent.press(await waitFor(() => view.getByTestId('models-row-image')));
    await waitFor(() => expect(view.getByText('Journey Image')).toBeTruthy());
    fireEvent.press(view.getByTestId('model-item'));
    fireEvent.press(await waitFor(() => view.getByTestId('new-chat-button')));
    await waitFor(() => expect(view.getByTestId('chat-screen')).toBeTruthy());

    fireEvent.press(view.getByTestId('quick-settings-button'));
    fireEvent.press(await waitFor(() => view.getByTestId('quick-image-mode')));
    await waitFor(() =>
      expect(view.getByTestId('image-mode-force-badge')).toBeTruthy(),
    );
    const ReactNative =
      require('react-native') as typeof import('react-native');
    const visibleModal = view
      .UNSAFE_getAllByType(ReactNative.Modal)
      .find(modal => modal.props.visible);
    expect(visibleModal).toBeTruthy();
    await act(async () => {
      fireEvent(visibleModal!, 'requestClose');
    });

    fireEvent.changeText(view.getByTestId('chat-input'), 'a moonlit lake');
    fireEvent.press(view.getByTestId('send-button'));
    await waitFor(
      () => expect(view.getByTestId('generated-image')).toBeTruthy(),
      { timeout: 8000 },
    );

    expect(boundary.diffusion.calls.generateImage).toHaveLength(1);
    expect(boundary.diffusion.calls.generateImage[0]).toEqual(
      expect.objectContaining({
        steps: 8,
        guidanceScale: 7.5,
        width: 512,
        height: 512,
        useOpenCL: true,
      }),
    );

    view.unmount();
  }, 30000);
});
