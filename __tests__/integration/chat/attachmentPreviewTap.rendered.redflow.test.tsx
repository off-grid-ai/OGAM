/**
 * T057 / DEV-B19 (RED) — tapping a pre-send attached image thumbnail must open a preview.
 *
 * Device (B19): "cannot preview an attached image in the input box (pre-send) — tapping the thumbnail does
 * nothing." Confirmed in code: the thumbnail is a bare <Image> with no press handler (Attachments.tsx:164);
 * only the remove (×) button is tappable. Product-correct: tapping the thumbnail opens the same fullscreen
 * image viewer generated images use (ImageViewerModal, with a Close control) — see T068.
 *
 * Real gestures: mount ChatScreen (vision model), attach a photo through the real attach popover
 * (attachImageViaUI), then tap the rendered thumbnail. UI-layer assertion: a fullscreen preview (Close
 * control) appears. RED on HEAD: nothing opens (the Image has no onPress). Precondition asserts the viewer
 * was NOT already open, so an always-on-screen control can't fake a pass. Falsify: wiring the thumbnail to
 * the existing ImageViewerModal → the preview opens → green.
 */
import { setupChatScreen } from '../../harness/chatHarness';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {}, useIsFocused: () => true,
}));

describe('T057 (rendered) — tapping a pre-send image thumbnail opens a preview (DEV-B19)', () => {
  it('opens a fullscreen preview when the attached thumbnail is tapped', async () => {
    const h = await setupChatScreen({ engine: 'litert', platform: 'android', vision: true });
    h.render();

    // Real gesture: attach a photo via the real attach popover → the thumbnail renders in the composer.
    await h.attachImageViaUI();
    const thumb = await h.rtl.waitFor(() => h.view!.getByTestId(/^attachment-image-/));

    // Precondition: no fullscreen viewer open yet (so "Close appears" is a real observed transition).
    expect(h.view!.queryByText('Close')).toBeNull();

    // Real gesture: tap the thumbnail.
    h.rtl.fireEvent.press(thumb);

    // SPEC: a fullscreen preview of the image opens (the app's image viewer, with a Close control — same as
    // tapping a generated image, T068). RED on HEAD: the thumbnail has no onPress, so nothing opens.
    await h.rtl.waitFor(() => { expect(h.view!.queryByText('Close')).not.toBeNull(); }, { timeout: 3000 });
  });
});
