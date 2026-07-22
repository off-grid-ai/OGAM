/** P1 #73 — retrying an image turn must replace it with a newly generated image. */
import {
  renderMainApp,
  seedDownloadedMnnImageModel,
} from '../../harness/appJourney';

describe('P1 full-app image resend', () => {
  it('re-draws an image request through the rendered Regenerate action', async () => {
    const { rtl, view } = await renderMainApp({
      beforeRender: async ({ boundary: native, asyncStorage }) => {
        await seedDownloadedMnnImageModel(native, asyncStorage);
      },
    });

    rtl.fireEvent.press(view.getByTestId('models-summary'));
    await rtl.waitFor(() =>
      expect(view.getByTestId('models-row-image')).toBeTruthy(),
    );
    rtl.fireEvent.press(view.getByTestId('models-row-image'));
    await rtl.waitFor(() =>
      expect(view.getByText('Journey Image')).toBeTruthy(),
    );
    rtl.fireEvent.press(view.getByTestId('model-item'));
    await rtl.waitFor(() =>
      expect(view.getByTestId('new-chat-button')).toBeTruthy(),
    );
    rtl.fireEvent.press(view.getByTestId('new-chat-button'));
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
    const settingsModal = view
      .UNSAFE_getAllByType(ReactNative.Modal)
      .find(modal => modal.props.visible);
    await rtl.act(async () => {
      rtl.fireEvent(settingsModal!, 'requestClose');
    });

    rtl.fireEvent.changeText(view.getByTestId('chat-input'), 'draw a red fox');
    rtl.fireEvent.press(view.getByTestId('send-button'));
    await rtl.waitFor(
      () => expect(view.getByTestId('generated-image-content')).toBeTruthy(),
      { timeout: 8000 },
    );
    const firstUri = view.getByTestId('generated-image-content').props.source
      .uri as string;
    expect(firstUri).toBe('file:///generated/img-1.png');
    expect(view.getByText(/Generated image for:.*draw a red fox/)).toBeTruthy();

    rtl.fireEvent(view.getByTestId('assistant-message'), 'longPress');
    rtl.fireEvent.press(
      await rtl.waitFor(() => view.getByTestId('action-retry')),
    );

    await rtl.waitFor(
      () => {
        const redrawn = view.getByTestId('generated-image-content');
        expect(redrawn.props.source.uri).toBe('file:///generated/img-2.png');
        expect(redrawn.props.source.uri).not.toBe(firstUri);
        expect(view.getAllByTestId('generated-image-content')).toHaveLength(1);
        expect(
          view.getByText(/Generated image for:.*draw a red fox/),
        ).toBeTruthy();
      },
      { timeout: 8000 },
    );
    view.unmount();
  }, 30000);
});
