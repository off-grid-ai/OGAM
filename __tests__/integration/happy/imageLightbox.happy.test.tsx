/**
 * HAPPY-PATH (UI, BEHAVIORAL) — the image lightbox on the REAL ChatScreen. The user generates an image
 * (force image-mode + real send), TAPS the generated image in the chat, and the fullscreen viewer opens with
 * its Share / Save / Close controls. Tapping Save runs the real save flow (RNFS copy on memfs) and the user sees the
 * "Image Saved" confirmation; tapping Close dismisses the viewer.
 *
 * Real ChatScreen + real useChatScreen (handleImagePress/handleSaveImage) + real imageGenerationService +
 * real ImageViewerModal + real CustomAlert. Only the native diffusion + LiteRT leaves and the filesystem
 * (memfs) are faked. The image is generated and tapped through real gestures — no viewer state is seeded.
 */
import { setupChatScreen } from '../../harness/chatHarness';

// Real navigation: the app's own NavigationContainer and routes (chatHarness navigation: 'real').
jest.unmock('@react-navigation/native');

describe('happy — image lightbox (tap a generated image → viewer + controls)', () => {
  it('tapping the generated image opens the fullscreen viewer; Close dismisses it', async () => {
    const h = await setupChatScreen({ navigation: 'real', engine: 'litert', platform: 'ios' });
    await h.generateImageViaUI({ prompt: 'a fox in the snow' });

    // The viewer is not open yet — no Save/Close controls on screen.
    expect(h.view!.queryByLabelText('Close')).toBeNull();

    // Tap the generated image (real onPress → handleImagePress → viewer opens).
    h.rtl.fireEvent.press(h.view!.getByTestId('generated-image'));

    // The fullscreen viewer is open with both controls.
    await h.rtl.waitFor(() => { expect(h.view!.queryByLabelText('Save')).not.toBeNull(); });
    expect(h.view!.queryByLabelText('Close')).not.toBeNull();

    // Close dismisses the viewer.
    h.rtl.fireEvent.press(h.view!.getByLabelText('Close'));
    await h.rtl.waitFor(() => { expect(h.view!.queryByLabelText('Save')).toBeNull(); });
    expect(h.view!.queryByLabelText('Close')).toBeNull();
  });

  it('Save in the viewer writes the image to the gallery and confirms', async () => {
    const h = await setupChatScreen({ navigation: 'real', engine: 'litert', platform: 'ios' });
    await h.generateImageViaUI({ prompt: 'a fox in the snow' });

    h.rtl.fireEvent.press(h.view!.getByTestId('generated-image'));
    await h.rtl.waitFor(() => { expect(h.view!.queryByLabelText('Save')).not.toBeNull(); });

    // Save runs the real RNFS copy (memfs) and the user sees the confirmation alert.
    h.rtl.fireEvent.press(h.view!.getByLabelText('Save'));
    await h.rtl.waitFor(() => { expect(h.view!.queryByText('Image Saved')).not.toBeNull(); });

    // The image really landed on disk in the gallery folder.
    const RNFS = require('react-native-fs');
    const dir = `${RNFS.DocumentDirectoryPath}/OffgridMobile_Images`;
    const files = await RNFS.readDir(dir);
    expect(files.length).toBeGreaterThan(0);
  });

  it('Share in the viewer closes it and shares that image with the mark', async () => {
    const h = await setupChatScreen({ navigation: 'real', engine: 'litert', platform: 'ios' });
    // The harness loads a fresh module registry; take the share service the screen uses.
    const shareCard = require('../../../src/services/shareCard');
    const share = jest.spyOn(shareCard, 'shareMarkedImage').mockResolvedValue(undefined);
    await h.generateImageViaUI({ prompt: 'a fox in the snow' });

    h.rtl.fireEvent.press(h.view!.getByTestId('generated-image'));
    await h.rtl.waitFor(() => { expect(h.view!.queryByLabelText('Share')).not.toBeNull(); });
    h.rtl.fireEvent.press(h.view!.getByTestId('image-viewer-share'));

    await h.rtl.waitFor(() => { expect(share).toHaveBeenCalledTimes(1); });
    expect(share.mock.calls[0][0]).toMatch(/\.png$/);
    expect(h.view!.queryByLabelText('Close')).toBeNull();
    share.mockRestore();
  });

  it('a share that cannot be made says so, and Save still works', async () => {
    // No ShareCardHost is mounted here, so the real share service cannot draw the card.
    const h = await setupChatScreen({ navigation: 'real', engine: 'litert', platform: 'ios' });
    await h.generateImageViaUI({ prompt: 'a fox in the snow' });

    h.rtl.fireEvent.press(h.view!.getByTestId('generated-image'));
    await h.rtl.waitFor(() => { expect(h.view!.queryByLabelText('Share')).not.toBeNull(); });
    h.rtl.fireEvent.press(h.view!.getByTestId('image-viewer-share'));

    await h.rtl.waitFor(() => { expect(h.view!.queryByText('Could not share')).not.toBeNull(); });
    expect(h.view!.queryByText('The image could not be shared. Save still works.')).not.toBeNull();
  });
});
