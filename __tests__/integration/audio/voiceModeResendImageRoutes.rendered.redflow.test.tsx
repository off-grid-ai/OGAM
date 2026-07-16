/**
 * T062 (VOICE-MODE variant) / DEV-B33 — resending an IMAGE request in VOICE mode must RE-DRAW, not route
 * to the text model.
 *
 * Ground truth (docs/DEVICE_TEST_FINDINGS.md B33 + DEVICE_SESSION_COMMENTARY "i resent draw a dog. and it
 * used the text model", part28/part38): a FRESH "draw a dog" routes to IMAGE and draws; the RESEND of it
 * reached the text LLM instead (every device RESEND-SM logged recordedKind=text/none, NEVER image). The
 * user raised the open question: text-mode resend is now fixed (resendImageRoutes green guard) — does the
 * VOICE-MODE flow also replay the image kind, or does it fall through to text?
 *
 * User behavior replicated end-to-end on the REAL ChatScreen: activate an image model + force image mode,
 * enter Voice mode via the header Text/Voice dropdown, VOICE-send "draw a dog" (STT transcribeFile → image
 * route → drawn), then RESEND that turn via the real action menu and assert a SECOND image was drawn and NO
 * text answer leaked. Only the native leaves (whisper STT, diffusion, engine, executorch) are faked.
 *
 * GREEN = voice-mode resend re-draws (voice is not special; the core recordedTurnKind replay covers it) —
 * a happy guard closing the hypothesis. RED = voice-mode resend falls through to the text model (the bug).
 */
import { setupChatScreen } from '../../harness/chatHarness';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {}, useIsFocused: () => true,
}));

describe('T062 (voice-mode) — resend of an image request re-draws, not text (DEV-B33)', () => {
  it('re-runs the IMAGE pipeline on resend of a VOICE-sent "draw a dog" (does not load the text model)', async () => {
    const h = await setupChatScreen({ engine: 'litert', platform: 'android', whisper: true, pro: true });

    // Download + select an STT model (via its real screen) BEFORE mounting ChatScreen so the audio-mode mic
    // is available. Done pre-mount because it renders its own throwaway screen.
    await h.setupWhisperModel();
    h.render();

    // Place + load (activate) an image model via the REAL load path — hasImageModel=true, imageMode stays
    // 'auto'. Matches the device (auto + pattern classifier routes "draw a dog" → image; log part28/38).
    await h.placeImageModel({ backend: 'mnn' });
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { activeModelService } = require('../../../src/services/activeModelService');
    await activeModelService.loadImageModel('sd');

    // Switch to Voice mode via the chat-input quick-settings, then VOICE-send "draw a dog" → IMAGE.
    await h.enterVoiceMode();
    await h.voiceSend('draw a dog');
    await h.rtl.waitFor(() => { expect(h.boundary.diffusion.calls.generateImage.length).toBe(1); }, { timeout: 6000 });

    // RESEND via the real action menu (3-dots) on the image-result message → Retry. In audio mode the image
    // result renders as the same core ChatMessage, so the action menu is identical to text mode.
    await h.regenerateLast({ content: 'A dog is a domestic animal.' }, 'dots'); // the text that leaks if it misroutes
    await h.settle(400);

    // SPEC: resend re-runs the IMAGE pipeline → a SECOND generateImage; NO text answer leaked.
    // RED (B33 in voice mode): resend goes to the text model → generateImage stays 1 + the scripted text renders.
    expect(h.boundary.diffusion.calls.generateImage.length).toBe(2);
    expect(h.view!.queryByText(/domestic animal/)).toBeNull();
  });
});
