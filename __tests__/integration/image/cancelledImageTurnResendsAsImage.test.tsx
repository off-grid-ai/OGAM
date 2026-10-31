/**
 * UI integration (heavy entry point) — resending a turn whose image generation was CANCELLED.
 *
 * Device evidence (Android 2026-08-09 17:00, reproduced on iOS): "draw a dog running" was generating,
 * the user pressed the X on the progress card, then resent the same message — and got PROSE. The log
 * shows the modality flipping between the two resends of the same message:
 *
 *   16:59:46 [RESEND-SM] retry user msg idx=11 ... recordedKind=image   → dispatch → IMAGE pipeline
 *   17:00:00 [IMG-SM]    phase generating → idle                        (the X)
 *   17:00:02 [RESEND-SM] retry user msg idx=11 ... recordedKind=text    → dispatch → TEXT generation
 *
 * The turn's kind was DERIVED from the replies that survived, and a cancelled image turn keeps only its
 * "Enhanced prompt" reply and never gets its image — so it read back as a text turn. From the user's
 * view: a turn they asked to be drawn stays a drawing turn, and resending it draws again. Cancelling is
 * not a change of mind about the modality.
 *
 * Prompt enhancement is ON deliberately: that reply is what the derivation tripped over, so with it off
 * the turn has no reply at all and the bug does not exist. This is the exact condition the device hit.
 *
 * Real ChatScreen + real dispatch/resend seam + real imageGenerationService; only llama and diffusion
 * natives are faked. The generation is PARKED in native so the X is pressed while it is genuinely
 * in flight, as on the device.
 */
import { setupChatScreen } from '../../harness/chatHarness';

// Real navigation: the app's own NavigationContainer and routes (chatHarness navigation: 'real').
jest.unmock('@react-navigation/native');

const ENHANCEMENT = 'an energetic dog running through an open field, cinematic lighting, 8k.';

/** Arrive-via-UI: turn prompt enhancement ON by tapping the real toggle on the real settings section. */
async function enableEnhanceViaUI(h: Awaited<ReturnType<typeof setupChatScreen>>) {

  const { ImageGenerationSection } = require('../../../src/components/GenerationSettingsModal/ImageGenerationSection');
  const s = h.renderAside(h.React.createElement(ImageGenerationSection, {}));
  h.rtl.fireEvent.press(s.getByTestId('modal-image-advanced-toggle'));
  h.rtl.fireEvent.press(await h.rtl.waitFor(() => s.getByTestId('image-enhance-on')));
  s.unmount();
}

/** Open the user message's action menu via its "•••" control and tap Resend. The handler is resolved off
 *  the node the way the harness resolves send: RNTL's press traversal does not reach this control inside
 *  the message list, and invoking the bound handler is the same thing a tap does. */
async function resendLastUserMessage(h: Awaited<ReturnType<typeof setupChatScreen>>) {
  type PressNode = { props?: Record<string, unknown>; parent?: PressNode | null } | null;
  const view = h.view!;
  const bubbles = view.queryAllByTestId('user-message');
  const target = bubbles[bubbles.length - 1];
  await h.rtl.act(async () => {
    let n: PressNode = h.rtl.within(target).getByText('•••') as unknown as PressNode;
    for (let d = 0; n && d < 12; d++) {
      const onPress = n.props?.onPress;
      if (typeof onPress === 'function') { (onPress as () => void)(); return; }
      n = n.parent ?? null;
    }
    throw new Error('the user message has no pressable "•••" — its action menu cannot be opened');
  });
  await h.rtl.waitFor(() => { expect(view.getByTestId('action-menu')).toBeTruthy(); });
  await h.rtl.act(async () => {
    let n: PressNode = view.getByTestId('action-retry') as unknown as PressNode;
    for (let d = 0; n && d < 12; d++) {
      const onPress = n.props?.onPress;
      if (typeof onPress === 'function') { (onPress as () => void)(); return; }
      n = n.parent ?? null;
    }
    throw new Error('the action menu\'s Resend has no pressable ancestor — the resend gesture is dead');
  });
}

describe('a cancelled image turn is still an image turn', () => {
  it('resending after pressing X on the progress card draws again, it does not answer in text', async () => {
    const h = await setupChatScreen({ navigation: 'real', engine: 'llama' });
    h.render();
    await h.placeImageModel({ backend: 'coreml' });
    await h.cycleImageMode(); // auto -> ON(force); also activates the downloaded image model
    await enableEnhanceViaUI(h);
    const view = h.view!;

    // Send the drawing request and park the generation inside native, as diffusion really does for seconds.
    h.boundary.llama!.scriptCompletion({ text: ENHANCEMENT });
    h.boundary.diffusion.holdNextGeneration();
    await h.tapSend('draw a dog running');
    await h.rtl.waitFor(() => { expect(h.boundary.diffusion.calls.generateImage.length).toBe(1); });
    await h.rtl.waitFor(() => { expect(h.boundary.diffusion.generationHeld()).toBe(true); });

    // BEFORE: it is drawing — the enhancement reply is on screen and no image exists yet.
    expect(view.queryByTestId('thinking-block')).not.toBeNull();
    expect(view.queryByTestId('generated-image')).toBeNull();

    // GESTURE: press the X on the progress card. The run is abandoned; no image is ever produced.
    await h.pressImageCardStop();
    await h.settle(200);
    expect(view.queryByTestId('generated-image')).toBeNull();

    // GESTURE: resend the same message — open its action menu and tap Resend.
    h.boundary.llama!.scriptCompletion({ text: ENHANCEMENT });
    await resendLastUserMessage(h);

    // It draws again. The image the user asked for arrives; the turn was never demoted to text.
    await h.rtl.waitFor(() => { expect(view.queryByTestId('generated-image')).not.toBeNull(); }, { timeout: 8000 });
    expect(h.boundary.diffusion.calls.generateImage.length).toBe(2);
  });
});
