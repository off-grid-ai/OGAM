/**
 * RED-FLOW (UI integration, HEAVY entry point) — SEND vs RESEND must not diverge after the modality
 * decision. Commit 4a919e3d unified the modality DECISION (resolveTurnKind), but the post-decision
 * DISPATCH diverged: send guards the image pipeline on `activeImageModel` and FALLS BACK to text when no
 * image model is loaded, while resend fired the image pipeline UNCONDITIONALLY. So the SAME prompt behaves
 * differently on resend vs send once the image model is gone.
 *
 * SPEC (the OGAM user's view): a turn that produced an image, resent AFTER the image model is unloaded,
 * must behave like SENDING that prompt with no image model — a graceful TEXT reply, NOT an "Error: No image
 * model loaded." dead-end. Send already does this (dispatchGenerationFn prepends a note and runs text);
 * resend must converge on the SAME shared dispatch.
 *
 * Arrive-via-UI: force an image (real quick-image-mode toggle) and send → a real image turn is recorded
 * (imageGenerationService adds an assistant message with an image attachment → recordedTurnKind='image').
 * Then the image model is unloaded (store transition — the documented harness convention, since the image
 * picker lives behind a nested sheet that is fragile to gesture in jest), and the turn is RESENT via its
 * real Retry affordance.
 *
 * RED on HEAD: resend fires the image pipeline with no image model → the user sees "No image model loaded."
 * and NO text reply. GREEN after the shared-dispatch fix: resend falls back to text like send → the scripted
 * text reply renders and the error alert never appears.
 */
import { setupChatScreen } from '../../harness/chatHarness';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {}, useIsFocused: () => true,
}));

describe('send/resend parity — resending an image turn with no image model falls back to text (like send)', () => {
  it('shows a text reply, not "No image model loaded.", when the image turn is resent after the image model is gone', async () => {
    const h = await setupChatScreen({ engine: 'litert', platform: 'ios' });
    h.render();
    await h.placeImageModel();

    // GESTURE: force image mode, then send → the REAL image pipeline runs and records an image turn
    // (assistant message with an image attachment → recordedTurnKind='image' for this user message).
    await h.cycleImageMode(); // auto → ON (force)
    await h.rtl.waitFor(() => { expect(h.view!.queryByTestId('image-mode-force-badge')).not.toBeNull(); });
    await h.tapSend('a castle on a hill');
    await h.rtl.waitFor(() => { expect(h.boundary.diffusion.calls.generateImage.length).toBe(1); }, { timeout: 8000 });
    await h.rtl.waitFor(() => { expect(h.view!.queryByTestId('generated-image')).not.toBeNull(); }, { timeout: 8000 });

    // The user unloads the image model (store transition — the picker is behind a fragile nested sheet;
    // this is the documented harness convention for image-model (de)activation). activeImageModel → undefined.
    await h.rtl.act(async () => { h.useAppStore.setState({ activeImageModelId: null }); });

    // GESTURE: resend the (image-recorded) turn via its real Retry affordance. The next engine turn is
    // scripted as TEXT — what SHOULD render once resend falls back to text (send's behavior).
    await h.regenerateLast({ content: 'A castle is a fortified stone structure.' }, 'longpress');

    // Correct (send-parity): a graceful TEXT reply renders, and the image-model error never appears.
    // RED on HEAD: resend fires the image pipeline unconditionally → "No image model loaded." + no reply.
    await h.rtl.waitFor(() => { expect(h.view!.queryByText(/A castle is a fortified stone structure\./)).not.toBeNull(); }, { timeout: 8000 });
    expect(h.view!.queryByText('No image model loaded.')).toBeNull();
    // The failed image path must NOT have fired a second diffusion call.
    expect(h.boundary.diffusion.calls.generateImage.length).toBe(1);
  }, 60000);
});
