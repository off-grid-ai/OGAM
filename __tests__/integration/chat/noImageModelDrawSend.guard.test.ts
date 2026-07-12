/**
 * GUARD (N3) — a "draw …" send with NO image model routes cleanly to the text model: the user gets a normal
 * text answer, and the internal "[User wanted an image but no image model is loaded]" marker (added at
 * useChatGenerationActions.ts:448 when shouldGenerateImage && !activeImageModel) is NEVER leaked into the
 * text the model actually receives.
 *
 * In auto mode with no image model, shouldRouteToImageGenerationFn returns false (skips the classifier), so
 * shouldGenerateImage is false and line 448 never fires — the marker is unreachable. This guard LOCKS that:
 * if a regression let an image route survive with no image model, the marker would leak into the model's
 * prompt. So the assertion rides the boundary that CARRIES that prompt — the litert engine's sendMessage
 * (the "what reached the engine seam" — the marker is a hidden prompt leak, not a rendered artifact) — not
 * generateRaw (which the main litert turn never uses; asserting there was vacuous — it can't carry the
 * marker in either world).
 *
 * Falsified: forcing shouldRouteToImageGenerationFn to return true (image route with no image model) makes
 * line 448 fire and the marker appears in the sendMessage text → this goes red.
 */
import { setupChatScreen } from '../../harness/chatHarness';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {},
  useIsFocused: () => true,
}));

describe('N3 (guard) — draw request with no image model routes safely', () => {
  it('renders a text answer and leaks NO image marker into the text the model receives', async () => {
    const h = await setupChatScreen({ engine: 'litert' });
    h.render();

    // No image model is downloaded/active → "draw …" must route to the text model.
    await h.send('draw a dragon', { content: 'A dragon is a large mythical reptile.' });

    // The user sees a normal text answer (the reachable, correct outcome).
    await h.rtl.waitFor(() => { expect(h.view!.queryByText(/A dragon is a large mythical reptile\./)).not.toBeNull(); });

    // The text that actually REACHED the engine carries no internal image marker (clean prompt). If line 448
    // ever fired (image route + no image model), the marker would be in this sendMessage text.
    const sentToEngine = h.boundary.litert.calls.sendMessage.map((c: unknown[]) => String(c[0]));
    expect(sentToEngine.length).toBeGreaterThan(0); // the send actually reached the engine (non-vacuous)
    expect(sentToEngine.some((t: string) => /User wanted an image/i.test(t))).toBe(false);
    // And the exact prompt the user typed reached the model unmodified.
    expect(sentToEngine.some((t: string) => t === 'draw a dragon')).toBe(true);
  });
});
