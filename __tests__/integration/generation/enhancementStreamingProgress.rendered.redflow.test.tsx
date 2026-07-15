/**
 * T073 / DEV-B30b (RED) — the enhancement step must show STREAMING / live progress, not a frozen static
 * "Enhancing…".
 *
 * Device (part37, B30b): with enhancement ON, the enhancement generation runs LONG but shows NO
 * streaming/progress — the user sees a static "Enhancing prompt with AI…" and it "looked like it wasn't
 * doing anything but it was doing a million characters" (completely frozen). User's spec: "it also isn't
 * streaming — so that's a problem … Enhancement must stream or show real progress." This is independent of
 * B30's thinking bug (T071/T072): ANY long generation with no visible progress is a UX failure.
 *
 * Root cause on HEAD (imageGenerationService._enhancePrompt + engines.generateStandalone): the enhancement
 * is run via `generateStandalone`, which passes a NO-OP stream callback (`() => {}`) — every streamed token
 * is discarded. The only UI during enhancement is the ImageProgressIndicator card, whose status is the
 * STATIC string "Enhancing prompt with AI…" with a frozen `progress {step:0}` (0/N), plus a temp thinking
 * message hard-coded to the STATIC text "Enhancing your prompt…". The enhanced text is written to the chat
 * only AFTER generateStandalone resolves — so mid-flight the user sees nothing moving.
 *
 * User behavior, real gestures: activate an image model, force image mode, turn enhancement ON, send
 * "draw a cat". The enhancement completion is the one text-model request in the turn; we HOLD it mid-stream
 * (llama fake `scriptCompletion({ pauseAfter })`) so the in-flight enhancement UI is truly on screen and can
 * be inspected — this is the T056 discipline (observe the transient state present, don't assert on a no-op).
 *
 * SPEC (UI layer): while the enhancement is mid-generation, the user sees LIVE progress of it — the partial
 * enhanced text streaming in ("a photorealistic…" already emitted by the paused stream). The plausible fix
 * feeds the enhancement stream deltas into the same rendered surface normal generation streams into (the
 * thinking message content and/or the progress card), so the growing text is visible. RED on HEAD: the
 * deltas are dropped, so only the static "Enhancing prompt with AI…" / "Enhancing your prompt…" renders and
 * the partial streamed fragment never appears.
 *
 * Emergent, not testing-the-fake: the llama fake really streams char-by-char through the completion
 * callback (device-faithful llama.rn) and PAUSES after the fragment; whether that stream reaches the UI is
 * entirely the app's own generateStandalone/_enhancePrompt decision. Falsify: route the enhancement stream
 * into the rendered thinking message/status → the partial fragment appears → green (and releaseStream lets
 * the turn finish, so it isn't a hang).
 */
import { setupChatScreen } from '../../harness/chatHarness';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {}, useIsFocused: () => true,
}));

// The clean enhanced rewrite. The paused stream will have emitted the leading fragment below by the time we
// inspect the screen — a fix that streams the enhancement makes that partial text visible mid-flight.
const ENHANCED_PROMPT = 'a photorealistic tabby cat sitting in a sunlit garden, shallow depth of field';
const PARTIAL_FRAGMENT = 'a photorealistic'; // pauseAfter lands exactly here, mid-generation

describe('T073 (rendered) — enhancement must stream / show live progress (DEV-B30b)', () => {
  it('shows the partial enhanced text streaming while the enhancement is mid-generation, not a frozen static "Enhancing…"', async () => {
    const h = await setupChatScreen({ engine: 'llama', platform: 'android' });
    h.render();

    await h.placeImageModel({ backend: 'coreml' });
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { activeModelService } = require('../../../src/services/activeModelService');
    await activeModelService.loadImageModel('sd');
    await h.cycleImageMode(); // auto → ON(force): "draw a cat" routes to IMAGE
    await h.rtl.waitFor(() => { expect(h.view!.queryByTestId('image-mode-force-badge')).not.toBeNull(); });

    // Enhancement ON — the exact device configuration for B30b.
    h.useAppStore.getState().updateSettings({ enhanceImagePrompts: true });

    // Device-faithful: the enhancement streams char-by-char, then HOLDS mid-generation after the fragment
    // (releaseStream lets it finish so the turn isn't a hang). While held, the in-flight enhancement UI is on
    // screen for real (not a no-op — T056 discipline).
    h.boundary.llama!.scriptCompletion({ text: ENHANCED_PROMPT, pauseAfter: PARTIAL_FRAGMENT });
    await h.tapSend('draw a cat');

    // PRECONDITION (observe the transient present, so an absent assertion below can't false-green): the
    // enhancement is truly in flight — its static status card is on screen.
    await h.rtl.waitFor(
      () => { expect(h.view!.queryByText(/Enhancing prompt with AI/i)).not.toBeNull(); },
      { timeout: 6000 },
    );

    // SPEC (UI layer): mid-generation the user sees the enhancement STREAMING — the partial enhanced text
    // ("a photorealistic…") is on screen. RED on HEAD (B30b): generateStandalone drops every delta, so only
    // the static "Enhancing…" renders and the partial fragment is nowhere — it looks frozen.
    expect(h.view!.queryByText(new RegExp(PARTIAL_FRAGMENT, 'i'))).not.toBeNull();

    // Release the held stream so the turn completes cleanly (no dangling promise / open handle).
    h.boundary.llama!.releaseStream();
    await h.rtl.waitFor(
      () => { expect(h.boundary.diffusion.calls.generateImage.length).toBe(1); },
      { timeout: 6000 },
    );
  });
});
