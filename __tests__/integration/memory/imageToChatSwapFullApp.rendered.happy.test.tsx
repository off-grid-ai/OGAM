/** P1 #100/#103 — a near-edge image load stays coherent and swaps back to text. */
import {
  renderMainApp,
  seedDownloadedMnnImageModel,
  sendChatMessage,
} from '../../harness/appJourney';
import { GB } from '../../harness/nativeBoundary';

describe('P1 #100/#103 image memory and chat transition', () => {
  it('generates at the owned memory edge, then swaps to text and renders the reply', async () => {
    const { boundary, rtl, view } = await renderMainApp({
      boundary: {
        llama: true,
        ram: { platform: 'android', totalBytes: 8 * GB, availBytes: 6 * GB },
      },
      beforeRender: async ({ boundary: native, asyncStorage }) => {
        // 1.85 GB on disk => ~4.6 GB at the authoritative Android 2.5x estimator:
        // it fits the balanced budget alone, but not beside the text model.
        await seedDownloadedMnnImageModel(native, asyncStorage, {
          size: 1.85 * GB,
          name: 'Near-edge Journey Image',
        });
      },
    });

    // Reach image generation entirely through Home's real model manager.
    rtl.fireEvent.press(view.getByTestId('models-summary'));
    rtl.fireEvent.press(
      await rtl.waitFor(() => view.getByTestId('models-row-image')),
    );
    rtl.fireEvent.press(
      await rtl.waitFor(() => view.getByTestId('model-item')),
    );
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
    const settingsModal = view
      .UNSAFE_getAllByType(ReactNative.Modal)
      .find(modal => modal.props.visible);
    await rtl.act(async () => rtl.fireEvent(settingsModal!, 'requestClose'));

    sendChatMessage(rtl, view, 'paint a quiet mountain lake');
    await rtl.waitFor(
      () => expect(view.getByTestId('generated-image')).toBeTruthy(),
      { timeout: 10000 },
    );
    expect(view.queryByText('Not Enough Memory')).toBeNull();

    // Return through navigation, choose text, and send. The manager must evict the
    // near-edge image resident rather than leave the user on a refusal card.
    rtl.fireEvent.press(view.getByTestId('chat-back-button'));
    await rtl.waitFor(() =>
      expect(view.getByTestId('home-screen')).toBeTruthy(),
    );
    rtl.fireEvent.press(view.getByTestId('models-summary'));
    rtl.fireEvent.press(
      await rtl.waitFor(() => view.getByTestId('models-row-text')),
    );
    rtl.fireEvent.press(
      await rtl.waitFor(() => view.getByTestId('model-item')),
    );
    rtl.fireEvent.press(
      await rtl.waitFor(() => view.getByTestId('new-chat-button')),
    );
    await rtl.waitFor(() =>
      expect(view.getByTestId('chat-screen')).toBeTruthy(),
    );
    boundary.llama!.scriptCompletion({
      text: 'Text chat resumed after the image generation.',
    });
    sendChatMessage(rtl, view, 'Continue in text chat.');
    await rtl.waitFor(
      () =>
        expect(
          view.getByText('Text chat resumed after the image generation.'),
        ).toBeTruthy(),
      { timeout: 12000 },
    );

    expect(view.queryByText('Load Anyway')).toBeNull();

    view.unmount();
  }, 45000);
});
