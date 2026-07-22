/** The support prompt follows successful image generations through the real App. */
import {
  renderMainApp,
  seedDownloadedMnnImageModel,
} from '../../harness/appJourney';
import { GB } from '../../harness/nativeBoundary';

const SHEET_TITLE = 'Support Open-Source AI';

describe('full-App image share-prompt journey', () => {
  it('skips the first completed image and appears after the second', async () => {
    const { rtl, view } = await renderMainApp({
      boundary: {
        ram: { platform: 'android', totalBytes: 8 * GB, availBytes: 6 * GB },
      },
      beforeRender: async ({ boundary, asyncStorage }) => {
        await seedDownloadedMnnImageModel(boundary, asyncStorage);
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

    const ReactNative =
      require('react-native') as typeof import('react-native');
    const forceNextImage = async () => {
      rtl.fireEvent.press(view.getByTestId('quick-settings-button'));
      rtl.fireEvent.press(
        await rtl.waitFor(() => view.getByTestId('quick-image-mode')),
      );
      await rtl.waitFor(() =>
        expect(view.getByTestId('image-mode-force-badge')).toBeTruthy(),
      );
      const modal = view
        .UNSAFE_getAllByType(ReactNative.Modal)
        .find(candidate => candidate.props.visible);
      await rtl.act(async () => {
        rtl.fireEvent(modal!, 'requestClose');
      });
    };

    await forceNextImage();
    rtl.fireEvent.changeText(view.getByTestId('chat-input'), 'a blue heron');
    rtl.fireEvent.press(view.getByTestId('send-button'));
    await rtl.waitFor(() =>
      expect(view.getAllByTestId('generated-image')).toHaveLength(1),
    );
    await new Promise(resolve => setTimeout(resolve, 2200));
    expect(view.queryByText(SHEET_TITLE)).toBeNull();

    await forceNextImage();
    rtl.fireEvent.changeText(view.getByTestId('chat-input'), 'a red fox');
    rtl.fireEvent.press(view.getByTestId('send-button'));
    await rtl.waitFor(() =>
      expect(view.getAllByTestId('generated-image')).toHaveLength(2),
    );
    await rtl.waitFor(() => expect(view.getByText(SHEET_TITLE)).toBeTruthy(), {
      timeout: 4000,
    });

    view.unmount();
  }, 30000);
});
