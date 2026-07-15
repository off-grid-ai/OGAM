/**
 * T088 / DEV-B29 — in voice mode, while a generation is in flight, the mic must become a STOP button.
 *
 * Device (B29): during an in-progress voice-mode generation the mic button does NOT transform into a STOP
 * button — (a) no way to stop, (b) it still looks like a mic, so a tap starts a COLLIDING recording → the
 * STT double-record race (B12/B26). "which is fucked up." (SAFETY on-ramp to the STT bugs.)
 *
 * User behavior, real gestures: enter voice mode, voice-send a message whose generation is held in-flight
 * (native accepted the prompt, never completes). Assert what the user SEES: a STOP control is shown and the
 * hold-to-talk mic is gone (so a tap stops generation, not start a colliding recording).
 *
 * RED (B29 live): no stop-button, the mic record button still shows. GREEN: stop-button shown, mic gone.
 */
import { setupChatScreen } from '../../harness/chatHarness';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {}, useIsFocused: () => true,
}));

describe('T088 (rendered) — voice-mode mic becomes STOP during generation (DEV-B29)', () => {
  it('shows a STOP control (not the mic) while a voice-mode generation is in flight', async () => {
    const h = await setupChatScreen({ engine: 'litert', platform: 'android', whisper: true, pro: true });
    await h.setupWhisperModel();
    h.render();
    await h.enterVoiceMode();

    // Precondition (what the user sees before sending): the hold-to-talk mic is present.
    expect(h.view!.queryByTestId('voice-record-button-audio')).not.toBeNull();

    // Voice-send a message; the native runtime accepts it but never completes → generation stays in flight.
    h.boundary.litert.scriptHang();
    await h.voiceSend('tell me a long story');

    // SPEC (B29 fix): while generating, a STOP control is shown so a tap stops the generation.
    await h.rtl.waitFor(() => { expect(h.view!.queryByTestId('stop-button')).not.toBeNull(); }, { timeout: 4000 });
    // And the hold-to-talk mic is gone — a tap can't start a colliding recording.
    expect(h.view!.queryByTestId('voice-record-button-audio')).toBeNull();
  });
});
