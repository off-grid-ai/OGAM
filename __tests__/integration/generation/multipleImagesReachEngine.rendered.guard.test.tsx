/**
 * Two images attached to one message BOTH reach the engine.
 *
 * A user comparing two screenshots ("what changed?") attaches both and asks once. If only the first survives the
 * trip to the engine, the model answers confidently about a comparison it never saw - the worst kind of failure,
 * because nothing looks broken. There is no error, no missing thumbnail, just a wrong answer.
 *
 * Both images arrive through REAL gestures from DIFFERENT sources - one from the photo library, one from the camera -
 * because the faked library picker returns the same uri every time. Two library picks would be indistinguishable
 * from one image arriving twice, which is precisely the bug being guarded against.
 *
 * The assertion is at the NATIVE module (`sendMessageWithMedia`/`sendMessageWithImages`), the far side of the real
 * liteRTService. So it proves the uris survived the whole path - attachment state, the generation pipeline, our
 * service - rather than that our own service was called with what the test handed it.
 *
 * REPLACES a mocked version of this in generationFlow.test.ts, which stood in for liteRTService itself and asserted
 * `mockLiteRTService.sendMessage` had been called with two uris. That could not fail for any reason a user would
 * ever hit: the mock WAS the engine, so the test only proved the pipeline passes its argument along, and anything
 * dropping an image inside the real service would have gone unnoticed.
 */
import { setupChatScreen } from '../../harness/chatHarness';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {},
  useIsFocused: () => true,
}));

describe('two attached images in one turn', () => {
  it('sends BOTH image uris to the engine, not just the first', async () => {
    const h = await setupChatScreen({ engine: 'litert', vision: true });
    h.render();

    // Two real attach gestures, two different sources - so the uris differ and "both arrived" is checkable.
    await h.attachImageViaUI('library');
    await h.attachImageViaUI('camera');

    await h.send('what is different?', { content: 'The second one is darker.' });

    // Whichever media entry point the service chose, the uris it handed native are what matter.
    const readMediaCalls = () => [
      ...h.boundary.litert.calls.sendMessageWithMedia,
      ...h.boundary.litert.calls.sendMessageWithImages,
    ];
    await h.rtl.waitFor(() => {
      expect(readMediaCalls().length).toBeGreaterThan(0);
    }, { timeout: 4000 });
    const mediaCalls = readMediaCalls();
    const sentUris = mediaCalls
      .flat()
      .flatMap((arg) => (Array.isArray(arg) ? arg : []))
      .filter((entry): entry is string => typeof entry === 'string' && entry.includes('mock/'));

    // Two DISTINCT images. A pipeline that kept only the last attachment, or overwrote one with the other,
    // leaves one uri here and the model answers a comparison question having seen half of it.
    expect(new Set(sentUris).size).toBe(2);
    expect(sentUris.some((uri) => uri.includes('image.jpg'))).toBe(true);
    expect(sentUris.some((uri) => uri.includes('camera.jpg'))).toBe(true);
    await h.rtl.waitFor(() => {
      expect(h.view!.queryByText(/The second one is darker\./)).not.toBeNull();
    });
  });
});
