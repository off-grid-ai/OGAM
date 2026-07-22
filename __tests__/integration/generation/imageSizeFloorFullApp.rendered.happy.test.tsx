/** P2 #68 — the smallest selectable image size reaches native as 256x256. */
import {
  renderMainApp,
  seedDownloadedMnnImageModel,
} from '../../harness/appJourney';
import { GB } from '../../harness/nativeBoundary';

describe('P2 full-app image-size floor journey', () => {
  it('generates a visible image at no less than 256 pixels per side', async () => {
    const { boundary, rtl, view } = await renderMainApp({
      boundary: {
        ram: { platform: 'android', totalBytes: 8 * GB, availBytes: 6 * GB },
      },
      beforeRender: async ({ boundary: native, asyncStorage }) => {
        await seedDownloadedMnnImageModel(native, asyncStorage);
      },
    });

    rtl.fireEvent.press(view.getByTestId('settings-tab'));
    rtl.fireEvent.press(
      await rtl.waitFor(() => view.getByText('Model Settings')),
    );
    rtl.fireEvent.press(
      await rtl.waitFor(() => view.getByTestId('image-generation-accordion')),
    );
    rtl.fireEvent.press(
      await rtl.waitFor(() => view.getByTestId('image-size-value-button')),
    );
    const sizeInput = await rtl.waitFor(() =>
      view.getByTestId('image-size-input'),
    );
    rtl.fireEvent.changeText(sizeInput, '256');
    rtl.fireEvent(sizeInput, 'submitEditing');
    await rtl.waitFor(() =>
      expect(view.getByTestId('image-size-value')).toHaveTextContent('256x256'),
    );

    rtl.fireEvent.press(view.getByTestId('back-button'));
    rtl.fireEvent.press(await rtl.waitFor(() => view.getByTestId('home-tab')));
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
    await rtl.waitFor(() =>
      expect(view.getByTestId('image-mode-force-badge')).toBeTruthy(),
    );
    const ReactNative =
      require('react-native') as typeof import('react-native');
    const visibleModal = view
      .UNSAFE_getAllByType(ReactNative.Modal)
      .find(modal => modal.props.visible);
    expect(visibleModal).toBeTruthy();
    await rtl.act(async () => {
      rtl.fireEvent(visibleModal!, 'requestClose');
    });

    rtl.fireEvent.changeText(
      view.getByTestId('chat-input'),
      'a small red kite',
    );
    rtl.fireEvent.press(view.getByTestId('send-button'));
    await rtl.waitFor(
      () => expect(view.getByTestId('generated-image')).toBeTruthy(),
      { timeout: 8000 },
    );

    expect(boundary.diffusion.calls.generateImage).toHaveLength(1);
    const nativeRequest = boundary.diffusion.calls.generateImage[0];
    expect(nativeRequest).toEqual(
      expect.objectContaining({ width: 256, height: 256 }),
    );
    expect(Number(nativeRequest.width)).toBeGreaterThanOrEqual(256);
    expect(Number(nativeRequest.height)).toBeGreaterThanOrEqual(256);

    view.unmount();
  }, 30000);
});
