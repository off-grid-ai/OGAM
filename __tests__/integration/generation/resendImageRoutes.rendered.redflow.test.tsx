/**
 * T062 / DEV-B33 — resending an IMAGE request ("draw a dog") must RE-DRAW, not route to the text model.
 * Device (B33): fresh "draw a dog" → image ✅; RESEND of it → text model ❌ (resend bypassed image-intent
 * routing). Recreating the exact flow to see if HEAD still does it: GREEN = fixed (happy guard), RED = bug.
 *
 * FULL ChatScreen, real gestures: place an image model, force image mode, send "draw a dog" (→ image), then
 * open the real action menu on the result and tap Retry (regenerate). Assert a SECOND image was generated and
 * NO text reply appeared. Only the native diffusion + engine leaves are faked.
 */
import { setupChatScreen } from '../../harness/chatHarness';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {}, useIsFocused: () => true,
}));

describe('T062 (rendered) — resend of an image request re-draws, not text (DEV-B33)', () => {
  it('re-runs the IMAGE pipeline on resend of "draw a dog" (does not load the text model)', async () => {
    const h = await setupChatScreen({ engine: 'litert', platform: 'ios' });
    h.render();
    await h.placeImageModel({ backend: 'coreml' });
    await h.cycleImageMode(); // auto → ON(force): "draw a dog" routes to IMAGE deterministically
    await h.rtl.waitFor(() => { expect(h.view!.queryByTestId('image-mode-force-badge')).not.toBeNull(); });

    // Original send → IMAGE (device-confirmed correct).
    await h.tapSend('draw a dog');
    await h.rtl.waitFor(() => { expect(h.boundary.diffusion.calls.generateImage.length).toBe(1); });

    // RESEND via the real action menu (3-dots) on the image-result message → Retry.
    await h.regenerateLast({ content: 'A dog is a domestic animal.' }, 'dots'); // scripted text is what leaks if it misroutes
    await h.settle(400);

    // SPEC: resend re-runs the IMAGE pipeline → a SECOND generateImage; NO text answer leaked.
    // RED (B33): resend goes to the text model → generateImage stays 1 + the scripted text renders.
    expect(h.boundary.diffusion.calls.generateImage.length).toBe(2);
    expect(h.view!.queryByText(/domestic animal/)).toBeNull();
  });
});
