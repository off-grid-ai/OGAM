/**
 * RED-FLOW (UI, rendered) — T080 / T075 / DEV-B26+B28: chat-mode voice input does NOT reliably transcribe
 * what the user said. Chat-mode hold-to-talk runs the REALTIME pipeline (useWhisperTranscription →
 * startRealtimeTranscription → transcribeRealtime), which on device captures NO audio (hasData:false) even
 * when the user spoke — while voice-mode's FILE pipeline (transcribeFile) works (T079). Root (B28): three
 * divergent STT mechanisms; chat-mode is on the broken realtime one.
 *
 * OGAM GROUND TRUTH: voice input is ALWAYS transcribed to TEXT (never raw audio). The user speaking
 * "hello world" MUST put "hello world" in the input. Here the recording captured it (file-transcribe returns
 * "hello world"), but the realtime stream emits device-faithful NO-DATA (B26). HEAD: chat-mode's realtime-only
 * path ignores the recording, gets no data → input stays EMPTY → RED. Fix (unify chat-mode onto the
 * file-transcribe pipeline voice-mode already uses) surfaces "hello world".
 *
 * FULL ChatScreen mount, REAL hold-to-talk gesture (fireEvent responderGrant on the real VoiceRecordButton),
 * REAL useVoiceInput + whisperService. Only the native STT leaf + mic-permission are faked. Engine 'llama'
 * (no audio support) → chat-mode uses whisper realtime (a litert model would divert to direct-audio). The
 * native "realtime captures nothing" is the MANUAL check; this proves the JS pipeline choice is the defect.
 */
import { setupChatScreen } from '../../harness/chatHarness';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {}, useIsFocused: () => true,
}));

describe('T080/T075 (rendered) — chat-mode STT must transcribe the recording to TEXT (DEV-B26/B28)', () => {
  it('lands the spoken transcript in the input when realtime captured nothing but the recording has it', async () => {
    const h = await setupChatScreen({ engine: 'llama', whisper: true });
    await h.setupWhisperModel('tiny.en'); // downloaded + selected + resident, via the real select gesture
    h.render();

    // The recording captured "hello world" (what a reliable file-transcribe of it yields)...
    h.boundary.whisper!.setFileTranscript('hello world');

    // ...but chat-mode uses the realtime stream. Fire the REAL hold-to-talk gesture on the REAL mic, then
    // emit the device-faithful realtime events: a partial with no data, then a FINAL with no data (B26 — the
    // mic captured nothing even though the user spoke).
    await h.tapMic();
    await h.rtl.waitFor(() => { expect(h.boundary.whisper!.hasRealtimeSubscriber()).toBe(true); });
    h.boundary.whisper!.emitRealtime({ isCapturing: true, noData: true, recordingTime: 300 });
    h.boundary.whisper!.emitRealtime({ isCapturing: false, noData: true, recordingTime: 900 });
    await h.settle(300);

    // SPEC (OGAM ground truth): the spoken words are transcribed to TEXT in the input.
    // HEAD: realtime-only path got no data, never transcribes the recording → input EMPTY → RED.
    const input = await h.rtl.waitFor(() => h.view!.getByTestId('chat-input'));
    expect(input.props.value).toContain('hello world');
  });
});
