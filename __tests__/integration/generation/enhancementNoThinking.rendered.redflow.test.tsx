/**
 * T071 / DEV-B30 — prompt enhancement must NOT think.
 *
 * Device (part37 WIRE-LLAMA-PARAMS, enhancement ON + thinking ON globally): the enhancement
 * generateStandalone request went out with enable_thinking=true, so the model emitted a reasoning chain
 * ("Thinking Process:…") that became the image prompt — slow, non-streaming, garbage prompt. User's fix
 * spec: "enhancing prompt should not think — that turn shouldn't think." The enhancement is a utility
 * rewrite, not a reasoning task; its request must force enable_thinking=false regardless of the global
 * thinking setting.
 *
 * User behavior, real gestures: activate an image model, force image mode, turn thinking ON (global), turn
 * enhancement ON, send "draw a cat". The enhancement completion is the one text-model request in the turn.
 *
 * Boundary-record assertion (the sanctioned "what reached the engine seam" exception — the reasoning-garbage
 * symptom is only observable if the model produces it, which the fake controls, so we assert the JS decision
 * at its boundary): the enhancement request reaching the engine must carry enable_thinking !== true.
 * RED on HEAD (it sends true). Falsify: with the fix forcing false, it goes green; a NON-enhancement turn
 * with thinking ON legitimately keeps enable_thinking=true (so this isn't just "thinking is always off").
 */
import { setupChatScreen } from '../../harness/chatHarness';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {}, useIsFocused: () => true,
}));

const isEnhancementRequest = (p: { messages?: Array<{ role: string; content?: string }> }) =>
  !!p.messages?.some(m => m.role === 'system' && /image generation prompt/i.test(m.content || ''));

describe('T071 (rendered) — prompt enhancement must not think (DEV-B30)', () => {
  it('sends the enhancement request with enable_thinking !== true even when thinking is ON globally', async () => {
    const h = await setupChatScreen({ engine: 'llama', platform: 'android' });
    h.render();

    await h.placeImageModel({ backend: 'coreml' });
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { activeModelService } = require('../../../src/services/activeModelService');
    await activeModelService.loadImageModel('sd');
    await h.cycleImageMode(); // auto → ON(force): "draw a cat" routes to IMAGE
    await h.rtl.waitFor(() => { expect(h.view!.queryByTestId('image-mode-force-badge')).not.toBeNull(); });

    // Thinking ON globally + enhancement ON — the exact device configuration.
    h.useAppStore.getState().updateSettings({ enhanceImagePrompts: true, thinkingEnabled: true });

    h.boundary.llama!.scriptCompletion({ text: 'a photorealistic cat in a garden' }); // the rewritten prompt
    await h.tapSend('draw a cat');
    await h.rtl.waitFor(() => { expect(h.boundary.diffusion.calls.generateImage).toHaveLength(1); }, { timeout: 6000 });

    // The enhancement completion reached the text engine.
    const enhancementReq = h.boundary.llama!.calls.completion.map(c => c[0] as { enable_thinking?: boolean; messages?: Array<{ role: string; content?: string }> }).find(isEnhancementRequest);
    expect(enhancementReq).toBeDefined(); // precondition: enhancement actually ran

    // SPEC: a utility rewrite must not think. RED (B30): the request carries enable_thinking=true.
    expect(enhancementReq!.enable_thinking).not.toBe(true);
  });
});
