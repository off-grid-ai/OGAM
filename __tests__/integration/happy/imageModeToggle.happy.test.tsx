/**
 * HAPPY-PATH (UI, BEHAVIORAL) — the image-mode toggle (auto | ON | OFF) routes each send correctly.
 *
 * Real ChatScreen: the user taps the real quick-image-mode toggle to cycle modes, then sends. Only the
 * native LiteRT + diffusion leaves are faked; an image model is placed via placeImageModel (a downloaded
 * model is a native/disk boundary, and it must be set AFTER the mount's async hydration or it gets wiped).
 * Asserts:
 *   - ON (force): the force badge appears, and a NON-draw prompt still generates an image.
 *   - OFF (disabled): the force badge clears, and a "draw …" prompt does NOT generate an image (text).
 * (auto is covered by imageIntentRouting.happy: "draw" → image, normal → text.)
 */
import { setupChatScreen } from '../../harness/chatHarness';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {},
  useIsFocused: () => true,
}));

describe('happy — image-mode toggle routes correctly (heavy entry point)', () => {
  it('ON (force): the badge appears and a NON-draw prompt still generates an image', async () => {
    const h = await setupChatScreen({ engine: 'litert', platform: 'ios' });
    h.render();
    await h.placeImageModel();

    await h.cycleImageMode(); // auto → ON(force)
    await h.rtl.waitFor(() => { expect(h.view!.queryByTestId('image-mode-force-badge')).not.toBeNull(); });
    await h.tapSend('tell me about the ocean'); // not a draw request

    // ON forces image regardless of the text → the native image generator runs.
    await h.rtl.waitFor(() => { expect(h.boundary.diffusion.calls.generateImage.length).toBe(1); });
  });

  it('OFF (disabled): the badge clears and a "draw …" prompt does NOT generate an image', async () => {
    const h = await setupChatScreen({ engine: 'litert', platform: 'ios' });
    h.render();
    await h.placeImageModel();

    await h.cycleImageMode(); // auto → ON
    await h.rtl.waitFor(() => { expect(h.view!.queryByTestId('image-mode-force-badge')).not.toBeNull(); });
    await h.cycleImageMode(); // ON → OFF(disabled)
    await h.rtl.waitFor(() => { expect(h.view!.queryByTestId('image-mode-force-badge')).toBeNull(); });
    await h.send('draw a dragon', { content: 'A dragon is a mythical reptile.' }); // draw request, but OFF

    // OFF disables image routing → the draw request is answered as text, no image generated.
    await h.rtl.waitFor(() => { expect(h.view!.queryByText(/A dragon is a mythical reptile\./)).not.toBeNull(); });
    expect(h.boundary.diffusion.calls.generateImage.length).toBe(0);
  });
});
