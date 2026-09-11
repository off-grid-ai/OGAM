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
import { startChatScreen, usingLiteRT } from '../../harness/chatHarness';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: () => {},
    goBack: () => {},
    setOptions: () => {},
    addListener: () => () => {},
  }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {},
  useIsFocused: () => true,
}));

describe('T057 (rendered) — tapping a pre-send image thumbnail opens a preview (DEV-B19)', () => {
  it('opens a fullscreen preview when the attached thumbnail is tapped', async () => {
    const h = await startChatScreen(
      usingLiteRT().withPhotoAttachment('gallery'),
    );

    expect(h.assertions.isAttachedPhotoVisible()).toBe(true);
    expect(await h.assertions.isAttachedPhotoClickable()).toBe(true);
  });
});
