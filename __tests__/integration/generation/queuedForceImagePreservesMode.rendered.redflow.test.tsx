/**
 * #510 4a919e3d — a FORCE-IMAGE send that QUEUES behind an in-flight generation must still
 * generate an IMAGE when the queue drains. On device the queued force-image message lost its
 * force flag: QueuedMessage carried no imageMode, so on drain dispatchGenerationFn re-decided the
 * modality at imageMode='auto' → resolveTurnKind classified the (non-draw) text as TEXT and the
 * message the user explicitly forced to image generated as a text reply.
 *
 * SPEC (the user's view): I turned image mode ON, then sent a message while a previous turn was
 * still generating. When it finally runs, it must draw an image — not answer as text — because I
 * forced image mode for that send. The force choice must survive the queue.
 *
 * Journey (all real gestures on the real mounted ChatScreen + real generationService/dispatch/
 * queue; fake ONLY the native LiteRT/llama + diffusion leaves):
 *   1. place + activate an image model, image mode still AUTO.
 *   2. send turn #1 (a normal non-draw prompt) whose native completion HOLDS in prefill
 *      (holdBeforeStream) → generation stays in-flight (isGenerating true).
 *   3. observe the STOP control on screen (anti-false-green: the in-flight state truly rendered,
 *      so the next send genuinely queues behind it).
 *   4. turn image mode ON (force badge) and send turn #2 with a NON-draw prompt → it QUEUES
 *      behind the in-flight turn #1 (the queued-message path under test).
 *   5. release turn #1 → the queue drains and dispatches turn #2.
 *
 * The prompt for turn #2 ("tell me about cats") matches NO image heuristic, so under auto mode the
 * classifier routes it to TEXT — the force flag is the ONLY reason it should draw. That makes the
 * discriminator clean:
 *   RED on HEAD: force lost on drain → dispatched at 'auto' → classified TEXT → a text reply
 *     renders, NO generated image.
 *   GREEN with the fix: imageMode carried through the queue → dispatched as force → the diffusion
 *     boundary runs → the generated-image bubble renders, NO text reply.
 */
import { setupChatScreen } from '../../harness/chatHarness';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {}, useIsFocused: () => true,
}));

const QUEUED_TEXT_LEAK = 'Cats are small domesticated carnivorous mammals.';

describe('#510 (rendered) — a queued force-image send preserves its force flag on drain', () => {
  it('draws an image (not a text reply) when a force-image send queued behind an in-flight turn drains', async () => {
    // llama engine so we can HOLD turn #1 in prefill (holdBeforeStream) → generation stays in-flight.
    const h = await setupChatScreen({ engine: 'llama', platform: 'android' });
    h.render();
    const { rtl } = h;
    const view = h.view!;

    await h.placeImageModel({ backend: 'coreml' });

    // ---- Turn #1 (TEXT, auto mode): holds in prefill so generation stays in-flight. ----
    // The queued force-image text is what would leak as a bubble if turn #2 misroutes to text.
    h.boundary.llama!.scriptCompletion({ text: QUEUED_TEXT_LEAK, holdBeforeStream: true });
    await h.tapSend('what is the weather like');

    // Anti-false-green precondition: the generating STOP control is genuinely on screen, so the
    // next send truly queues behind an in-flight turn (not a no-op because it was too fast).
    await rtl.waitFor(() => { expect(view.queryByTestId('stop-button')).not.toBeNull(); }, { timeout: 4000 });

    // ---- Turn on image mode (force), then send turn #2 → it QUEUES behind turn #1. ----
    await h.cycleImageMode(); // auto → ON(force)
    await rtl.waitFor(() => { expect(view.queryByTestId('image-mode-force-badge')).not.toBeNull(); });
    await h.tapSend('tell me about cats'); // NON-draw prompt: only the force flag should make it an image
    await h.settle(50); // let handleSendFn enqueue

    // No image generated yet — turn #2 is queued, turn #1 still holds.
    expect(h.boundary.diffusion.calls.generateImage.length).toBe(0);

    // ---- Release turn #1 → the queue drains and dispatches the queued force-image message. ----
    h.boundary.llama!.releaseStream();
    await h.settle(400); // turn #1 finalizes; resetState schedules the drain (~100ms) → dispatch turn #2

    // SPEC: the queued force-image send draws → the generated-image bubble renders on screen, and the
    // scripted TEXT reply must NOT appear for turn #2.
    // RED (#510): force lost → classified text → QUEUED_TEXT_LEAK renders again as a second reply, no image.
    await rtl.waitFor(() => { expect(h.boundary.diffusion.calls.generateImage.length).toBe(1); }, { timeout: 4000 });
    expect(view.queryByTestId('generated-image')).not.toBeNull();
    // Only turn #1's single text reply may exist — turn #2 must NOT have produced a second text reply.
    expect(view.queryAllByText(new RegExp(QUEUED_TEXT_LEAK)).length).toBe(1);
  });

  it('COALESCE (M16): two sends queue together and one forced image — the merged dispatch draws an image', async () => {
    // Exercises the multi-message branch (all.length > 1) where imageMode = all.some(force) ? force : all[0].
    // My single-message test above only hits the all[0] shortcut; this pins the coalesce force-merge so a
    // regression to `all[0].imageMode` (dropping the .some) is caught.
    const h = await setupChatScreen({ engine: 'llama', platform: 'android' });
    h.render();
    const { rtl } = h;
    const view = h.view!;
    await h.placeImageModel({ backend: 'coreml' });

    // Turn #1 holds in prefill → in-flight, so BOTH following sends queue behind it and coalesce.
    h.boundary.llama!.scriptCompletion({ text: QUEUED_TEXT_LEAK, holdBeforeStream: true });
    await h.tapSend('what is the weather like');
    await rtl.waitFor(() => { expect(view.queryByTestId('stop-button')).not.toBeNull(); }, { timeout: 4000 });

    // Queue #2 (auto/text) then #3 (force image) — both queue while #1 holds → coalesced on drain.
    await h.tapSend('and how are you'); // auto, non-draw → queued
    await h.settle(30);
    await h.cycleImageMode();
    await rtl.waitFor(() => { expect(view.queryByTestId('image-mode-force-badge')).not.toBeNull(); });
    await h.tapSend('tell me about cats'); // force → queued (now 2 queued, one forced)
    await h.settle(50);
    expect(h.boundary.diffusion.calls.generateImage.length).toBe(0); // nothing drawn while #1 holds

    // Drain: the 2 queued messages coalesce; because one was force, the merged dispatch must draw.
    h.boundary.llama!.releaseStream();
    await h.settle(400);
    await rtl.waitFor(() => { expect(h.boundary.diffusion.calls.generateImage.length).toBe(1); }, { timeout: 4000 });
    expect(view.queryByTestId('generated-image')).not.toBeNull();
  });
});
