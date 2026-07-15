/**
 * T062 (LLAMA engine variant) / DEV-B33 — resending an image request re-draws on the LLAMA engine too.
 *
 * WHY THIS EXISTS: the B33 device bug ran on gemma-4-E2B-it-Q4_K_M.gguf — the LLAMA engine (wire part38) —
 * but the other T062 guards all run on litert. After T056 (a green that was litert-only while the device bug
 * was llama-only), engine is treated as a real axis: an engine-agnostic-looking fix must be proven on the
 * engine the finding actually used. This pins engine:'llama' so the guard matches the device.
 *
 * Real gestures: llama model active, image model active + force image, send "draw a dog" (→ image), resend
 * via the real action menu. Asserts the resend re-ran the image pipeline (a second generateImage) and no
 * text answer leaked — i.e. the recordedTurnKind replay is genuinely engine-agnostic.
 *
 * GREEN: routing fix holds on llama. Falsified by the shared messageHasImageOutput break (see the litert
 * guard) which turns every B33 guard RED.
 */
import { setupChatScreen } from '../../harness/chatHarness';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {}, useIsFocused: () => true,
}));

describe('T062 (llama) — resend of an image request re-draws on the llama engine (DEV-B33)', () => {
  it('re-runs the IMAGE pipeline on resend of "draw a dog" with a llama (GGUF) model active', async () => {
    const h = await setupChatScreen({ engine: 'llama', platform: 'android' });
    h.render();
    await h.placeImageModel({ backend: 'coreml' });
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { activeModelService } = require('../../../src/services/activeModelService');
    await activeModelService.loadImageModel('sd');
    await h.cycleImageMode(); // auto → ON(force)
    await h.rtl.waitFor(() => { expect(h.view!.queryByTestId('image-mode-force-badge')).not.toBeNull(); });

    await h.tapSend('draw a dog');
    await h.rtl.waitFor(() => { expect(h.boundary.diffusion.calls.generateImage.length).toBe(1); }, { timeout: 6000 });

    // RESEND via the real action menu (3-dots) → the scripted text is what leaks if it misroutes to llama.
    await h.regenerateLast({ text: 'A dog is a domestic animal.' }, 'dots');
    await h.settle(500);

    expect(h.boundary.diffusion.calls.generateImage.length).toBe(2);
    expect(h.view!.queryByText(/domestic animal/)).toBeNull();
  });
});
