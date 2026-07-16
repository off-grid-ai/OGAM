/**
 * GUARD (UI, BEHAVIORAL) — T058 / device finding B20: engine-consistent vision affordance.
 *
 * B20 (docs/DEVICE_TEST_FINDINGS.md): "litert gemma-4-E2B reports supportsVision:true natively but the app
 * doesn't expose vision for it, while the gguf variant does. Engine-inconsistent vision affordance." A
 * vision-capable model on the LiteRT engine must expose the SAME working attach-photo affordance that any
 * other vision-capable model exposes (proven by T054 / multimodalVision.happy) — the user must be able to
 * open the attach popover, tap Photo, pick from the library, and see the image attach. No "Vision Not
 * Supported" wall.
 *
 * This is a GREEN-GUARD: the single capability rule (services/engines.ts deriveEngineCapabilities) now
 * derives LiteRT vision from the model's liteRTVision flag — the same flag that mirrors the native
 * supportsVision:true B20 observed — so the affordance IS exposed. The guard locks the fix: inverting the
 * LiteRT branch (vision:false) reproduces B20 and flips this red (see the falsification transcript in the
 * task report). To prove the affordance is genuinely GATED (not always-on / vacuously green), the second
 * case drives a LiteRT model WITHOUT vision through the identical gesture and asserts the app walls it with
 * the "Vision Not Supported" alert instead of attaching.
 *
 * Real ChatScreen + real useChatScreen/useChatModelStateSync + real activeTextCapabilities +
 * real useAttachments; only the native leaves are faked (image picker returns a mock image; LiteRT native).
 * The model is selected via the real Home picker; the attach is the real attach-photo gesture.
 *
 * Scoped to the LiteRT engine (both cases) because that is exactly the engine B20 names, and because a
 * cross-engine llama/gguf comparison in ONE test would require the shared harness to expose a
 * vision-capable llama fake — see the "shared-harness change needed" note in the task report.
 */
import { setupChatScreen } from '../../harness/chatHarness';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {},
  useIsFocused: () => true,
}));

describe('T058/B20 — LiteRT vision-capable model exposes the same attach-photo affordance', () => {
  it('a LiteRT vision model (liteRTVision:true, mirroring native supportsVision:true) attaches a photo via the real gesture — no vision wall', async () => {
    const h = await setupChatScreen({ engine: 'litert', vision: true });
    h.render();

    // REAL affordance gesture: attach button → Photo → Photo Library → faked picker adds the image.
    // attachImageViaUI() asserts the attachments-container renders; it can ONLY succeed if the app
    // exposed vision for this LiteRT model (else the Photo tap raises "Vision Not Supported" and no
    // attachment is added). This is the rendered UI artifact — the image chip the user sees.
    await h.attachImageViaUI();

    // The vision affordance produced a real, rendered attachment (the terminal artifact the user perceives).
    expect(h.view!.queryByTestId('attachments-container')).not.toBeNull();
    // And the app did NOT wall the LiteRT vision model with the no-vision alert.
    expect(h.view!.queryByText('Vision Not Supported')).toBeNull();
  });

  it('a LiteRT model WITHOUT vision walls the identical gesture with "Vision Not Supported" — proving the affordance is gated, not always-on', async () => {
    const h = await setupChatScreen({ engine: 'litert', vision: false });
    h.render();

    // Same real gesture path up to the Photo tap. Without vision the app must NOT attach — it alerts.
    const view = h.view!;
    h.rtl.fireEvent.press(await h.rtl.waitFor(() => view.getByTestId('attach-button')));
    h.rtl.fireEvent.press(await h.rtl.waitFor(() => view.getByTestId('attach-photo')));
    await h.settle(400);

    // The rendered UI artifact for "vision not exposed": the alert wall, and NO attachment chip.
    await h.rtl.waitFor(() => { expect(view.queryByText('Vision Not Supported')).not.toBeNull(); });
    expect(view.queryByTestId('attachments-container')).toBeNull();
  });
});
