/**
 * T062 (VOICE-MODE + ENHANCEMENT variant) / DEV-B33 — resending an image request in voice mode WITH prompt
 * enhancement enabled must RE-DRAW, not fall through to the text model.
 *
 * This is the exact device flow behind the B33 report (DEVICE_SESSION_COMMENTARY): voice mode, "draw a dog"
 * while prompt-enhancement is ON ("its enhancing prompt"), then resend — which used the text model on the
 * (pre-fix) device build. The pre-fix bug: an enhanced image turn's FIRST reply content is the enhanced
 * prompt (text), so recordedTurnKind read the turn as 'text' and resend loaded the text model instead of
 * re-drawing. The fix (recordedTurnKind scans EVERY reply in the turn for an image output) must hold in
 * voice mode too — this guard exercises that multi-content scan (the plain-resend guard does not).
 *
 * User behavior, real gestures: activate an image model, enable enhancement, enter Voice mode, VOICE-send
 * "draw a dog" (STT → enhance → image), then RESEND via the real action menu. Assert a SECOND image was
 * drawn (two rendered generated images) — i.e. the resend re-ran the IMAGE pipeline, not the text model.
 *
 * GREEN = the scan-all-replies fix covers voice+enhancement. RED = the enhanced turn misroutes on resend.
 */
import { setupChatScreen } from '../../harness/chatHarness';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {}, useIsFocused: () => true,
}));

describe('T062 (voice + enhancement) — resend of an enhanced image request re-draws (DEV-B33)', () => {
  it('re-runs the IMAGE pipeline on resend of a VOICE-sent enhanced "draw a dog"', async () => {
    const h = await setupChatScreen({ engine: 'litert', platform: 'android', whisper: true, pro: true });
    await h.setupWhisperModel();
    h.render();

    await h.placeImageModel({ backend: 'mnn' });
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { activeModelService } = require('../../../src/services/activeModelService');
    await activeModelService.loadImageModel('sd');
    // Enable prompt enhancement — the setting that ran on the device before the failing resend.
    h.useAppStore.getState().updateSettings({ enhanceImagePrompts: true });

    await h.enterVoiceMode();

    // VOICE-send "draw a dog": STT transcribes it, enhancement rewrites the prompt (scripted text engine),
    // then the image is drawn.
    h.boundary.litert.scriptTurn({ content: 'a photorealistic dog in a park' });
    await h.voiceSend('draw a dog');
    await h.rtl.waitFor(() => { expect(h.view!.queryAllByTestId('generated-image-content').length).toBe(1); }, { timeout: 6000 });

    // RESEND via the real action menu (3-dots) on the image-result message → Retry. Regenerate REPLACES the
    // reply, so a correct re-draw leaves one rendered image; a misroute-to-text would leave ZERO (the image
    // reply replaced by a text answer). The scripted text is what would show if it misrouted.
    h.boundary.litert.scriptTurn({ content: 'A dog is a domestic animal.' });
    await h.regenerateLast({ content: 'A dog is a domestic animal.' }, 'dots');
    await h.settle(600);

    // SPEC: the resend re-ran the IMAGE pipeline (a second generateImage) AND the user still sees a rendered
    // image (not a text answer). RED (B33) would be zero rendered images + the text answer.
    expect(h.boundary.diffusion.calls.generateImage.length).toBe(2);
    expect(h.view!.queryAllByTestId('generated-image-content').length).toBe(1);
  });
});
