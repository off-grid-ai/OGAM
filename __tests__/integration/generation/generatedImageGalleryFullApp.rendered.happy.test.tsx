/** P2 #77 — images generated in chat are visible and openable in Gallery. */
import {
  renderMainApp,
  seedDownloadedMnnImageModel,
} from '../../harness/appJourney';
import { GB } from '../../harness/nativeBoundary';

const PROMPT = 'a lighthouse above stormy waves';
const GENERATED_URI = 'file:///generated/img-1.png';

describe('P2 generated-image Gallery journey', () => {
  it('opens the generated artifact from the real chat Gallery', async () => {
    const { rtl, view } = await renderMainApp({
      boundary: {
        ram: { platform: 'android', totalBytes: 8 * GB, availBytes: 6 * GB },
      },
      beforeRender: async ({ boundary: native, asyncStorage }) => {
        await seedDownloadedMnnImageModel(native, asyncStorage);
      },
    });
    const { act, fireEvent, waitFor } = rtl;

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
    const settingsModal = view
      .UNSAFE_getAllByType(ReactNative.Modal)
      .find(modal => modal.props.visible);
    expect(settingsModal).toBeTruthy();
    await act(async () => {
      fireEvent(settingsModal!, 'requestClose');
    });

    fireEvent.changeText(view.getByTestId('chat-input'), PROMPT);
    fireEvent.press(view.getByTestId('send-button'));
    await waitFor(
      () => {
        expect(view.getByTestId('generated-image')).toBeTruthy();
        expect(
          view.getByTestId('generated-image-content').props.source.uri,
        ).toBe(GENERATED_URI);
      },
      { timeout: 8000 },
    );
    fireEvent.press(view.getByTestId('chat-settings-icon'));
    fireEvent.press(await waitFor(() => view.getByText('Gallery (1)')));
    await waitFor(() => expect(view.getByText('Chat Images')).toBeTruthy());

    const galleryThumbnail = view.getByTestId('gallery-image-0');
    expect(
      rtl.within(galleryThumbnail).UNSAFE_getByType(ReactNative.Image).props
        .source.uri,
    ).toBe(GENERATED_URI);
    fireEvent.press(galleryThumbnail);

    await waitFor(() => {
      expect(view.getByText('Info')).toBeTruthy();
      expect(view.getByText('Save')).toBeTruthy();
      expect(view.getByText('Delete')).toBeTruthy();
      expect(view.getByText('Close')).toBeTruthy();
    });
    fireEvent.press(view.getByText('Info'));
    await waitFor(() => {
      expect(view.getByText('Image Details')).toBeTruthy();
      expect(view.getByText(PROMPT)).toBeTruthy();
      expect(view.getByText('8 steps')).toBeTruthy();
      expect(view.getByText('512x512')).toBeTruthy();
    });

    view.unmount();
  }, 30000);
});
