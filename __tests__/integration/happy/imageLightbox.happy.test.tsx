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

// The native capture is the device boundary: it hands back a file for whatever the host drew.
jest.mock('react-native-view-shot', () => {
  const ReactLib = require('react');
  const ViewShot = ReactLib.forwardRef(({ children }: { children: unknown }, ref: unknown) => {
    ReactLib.useImperativeHandle(ref, () => ({
      capture: async () => {
        // The capture lands a real file on the (in-memory) disk, as the native module does.
        const RNFS = require('react-native-fs');
        await RNFS.mkdir('/tmp/ReactNative');
        await RNFS.writeFile('/tmp/ReactNative/capture.png', 'png', 'utf8');
        return 'file:///tmp/ReactNative/capture.png';
      },
    }));
    return children;
  });
  return { __esModule: true, default: ViewShot };
});

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
    // The harness loads a fresh module registry: take React Native and the card host from it. The OS
    // share sheet and the image size read are the device boundary; the share service and host run for real.
    const RN = require('react-native');
    const sheet = jest.spyOn(RN.Share, 'share').mockResolvedValue({ action: 'sharedAction' });
    jest.spyOn(RN.Image, 'getSize').mockImplementation((...args: unknown[]) => (args[1] as (w: number, hgt: number) => void)(1024, 768));
    const { ShareCardHost } = require('../../../src/components/ShareCard/ShareCardHost');
    const host = h.rtl.render(require('react').createElement(ShareCardHost));
    await h.generateImageViaUI({ prompt: 'a fox in the snow' });

    h.rtl.fireEvent.press(h.view!.getByTestId('generated-image'));
    await h.rtl.waitFor(() => { expect(h.view!.queryByLabelText('Share')).not.toBeNull(); });
    h.rtl.fireEvent.press(h.view!.getByTestId('image-viewer-share'));

    // The host draws the picture with the mark, captures it once the image loads, and hands it to the sheet.
    await h.rtl.waitFor(() => { expect(host.queryByTestId('share-card-image', { includeHiddenElements: true })).not.toBeNull(); });
    // The card sits off screen with touches off, so the native image's load is delivered straight to it.
    await h.rtl.act(async () => { host.getByTestId('share-card-image', { includeHiddenElements: true }).props.onLoad(); });
    await h.rtl.waitFor(() => { expect(sheet).toHaveBeenCalledTimes(1); });
    expect(sheet.mock.calls[0][0]).toEqual({
      url: expect.stringMatching(/\/share-cards\/off-grid-ai-\d+\.png$/),
      message: 'Made offline on my phone · Off Grid AI\nhttps://getoffgridai.co/download',
    });
    expect(h.view!.queryByLabelText('Close')).toBeNull();
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
