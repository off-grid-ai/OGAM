/** APP-P1-011 — deleting a generated image removes its file and its rendered thumbnail. */
import {
  renderMainApp,
  seedDownloadedMnnImageModel,
} from '../../harness/appJourney';
import { GB } from '../../harness/nativeBoundary';

const GENERATED_PATH = '/generated/img-1.png';

describe('APP-P1-011 full-App Gallery deletion', () => {
  it('deletes the native file and immediately replaces the grid with the empty state', async () => {
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
    const modal = view
      .UNSAFE_getAllByType(ReactNative.Modal)
      .find(candidate => candidate.props.visible);
    await rtl.act(async () => rtl.fireEvent(modal!, 'requestClose'));

    rtl.fireEvent.changeText(
      view.getByTestId('chat-input'),
      'a small cabin in falling snow',
    );
    rtl.fireEvent.press(view.getByTestId('send-button'));
    await rtl.waitFor(() =>
      expect(view.getByTestId('generated-image')).toBeTruthy(),
    );
    await expect(
      (boundary.fs!.module.exists as (path: string) => Promise<boolean>)(
        GENERATED_PATH,
      ),
    ).resolves.toBe(true);

    rtl.fireEvent.press(view.getByTestId('chat-settings-icon'));
    rtl.fireEvent.press(await rtl.waitFor(() => view.getByText('Gallery (1)')));
    rtl.fireEvent.press(
      await rtl.waitFor(() => view.getByTestId('gallery-image-0')),
    );
    rtl.fireEvent.press(await rtl.waitFor(() => view.getByText('Delete')));
    await rtl.waitFor(() =>
      expect(view.getByText('Delete Image')).toBeTruthy(),
    );
    const deleteButtons = view.getAllByText('Delete');
    rtl.fireEvent.press(deleteButtons[deleteButtons.length - 1]);

    await rtl.waitFor(() => {
      expect(view.getByText('No images in this chat')).toBeTruthy();
      expect(view.queryByTestId('gallery-image-0')).toBeNull();
    });
    await expect(
      (boundary.fs!.module.exists as (path: string) => Promise<boolean>)(
        GENERATED_PATH,
      ),
    ).resolves.toBe(false);

    view.unmount();
  }, 30000);
});
