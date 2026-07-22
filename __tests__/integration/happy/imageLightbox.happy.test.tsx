/**
 * HAPPY-PATH (UI, BEHAVIORAL) — the image lightbox on the REAL ChatScreen. The user generates an image
 * (force image-mode + real send), TAPS the generated image in the chat, and the fullscreen viewer opens with
 * its Save / Close controls. Tapping Save runs the real save flow (RNFS copy on memfs) and the user sees the
 * "Image Saved" confirmation; tapping Close dismisses the viewer.
 *
 * Real ChatScreen + real useChatScreen (handleImagePress/handleSaveImage) + real imageGenerationService +
 * real ImageViewerModal + real CustomAlert. Only the native diffusion + LiteRT leaves and the filesystem
 * (memfs) are faked. The image is generated and tapped through real gestures — no viewer state is seeded.
 */
import { setupChatScreen } from '../../harness/chatHarness';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {},
  useIsFocused: () => true,
}));

async function generateImage(h: Awaited<ReturnType<typeof setupChatScreen>>) {
  h.render();
  await h.placeImageModel({ backend: 'coreml' }); // iOS Core ML — no integrity-file gate
  await h.cycleImageMode(); // auto → ON(force); also activates the downloaded image model
  await h.rtl.waitFor(() => { expect(h.view!.queryByTestId('image-mode-force-badge')).not.toBeNull(); });
  await h.tapSend('a fox in the snow');
  // The image is produced through the real service + native generateImage and rendered in the chat.
  await h.rtl.waitFor(() => { expect(h.boundary.diffusion.calls.generateImage).toHaveLength(1); });
  await h.rtl.waitFor(() => { expect(h.view!.queryByTestId('generated-image')).not.toBeNull(); });
}

describe('happy — image lightbox (tap a generated image → viewer + controls)', () => {
  it('tapping the generated image opens the fullscreen viewer; Close dismisses it', async () => {
    const h = await setupChatScreen({ engine: 'litert', platform: 'ios' });
    await generateImage(h);

    // The viewer is not open yet — no Save/Close controls on screen.
    expect(h.view!.queryByText('Close')).toBeNull();

    // Tap the generated image (real onPress → handleImagePress → viewer opens).
    h.rtl.fireEvent.press(h.view!.getByTestId('generated-image'));

    // The fullscreen viewer is open with both controls.
    await h.rtl.waitFor(() => { expect(h.view!.queryByText('Save')).not.toBeNull(); });
    expect(h.view!.queryByText('Close')).not.toBeNull();

    // Close dismisses the viewer.
    h.rtl.fireEvent.press(h.view!.getByText('Close'));
    await h.rtl.waitFor(() => { expect(h.view!.queryByText('Save')).toBeNull(); });
    expect(h.view!.queryByText('Close')).toBeNull();
  });

  it('Save in the viewer writes the image to the gallery and confirms', async () => {
    const h = await setupChatScreen({ engine: 'litert', platform: 'ios' });
    await generateImage(h);

    h.rtl.fireEvent.press(h.view!.getByTestId('generated-image'));
    await h.rtl.waitFor(() => { expect(h.view!.queryByText('Save')).not.toBeNull(); });

    // Save runs the real RNFS copy (memfs) and the user sees the confirmation alert.
    h.rtl.fireEvent.press(h.view!.getByText('Save'));
    await h.rtl.waitFor(() => { expect(h.view!.queryByText('Image Saved')).not.toBeNull(); });

    // The image really landed on disk in the gallery folder.
    const RNFS = require('react-native-fs');
    const dir = `${RNFS.DocumentDirectoryPath}/OffgridMobile_Images`;
    const files = await RNFS.readDir(dir);
    expect(files.length).toBeGreaterThan(0);
  });
});
