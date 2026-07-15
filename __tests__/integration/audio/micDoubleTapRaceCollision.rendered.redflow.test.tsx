/**
 * T078 / DEV-B12 (RED) — double-tapping the chat-mode mic quickly (start-while-recording) must NOT open a
 * SECOND realtime whisper session on top of the first. It must be a clean SINGLE recording.
 *
 * Device (B12, DEVICE_TEST_FINDINGS.md session 2): "Realtime transcribe race: double-trigger → 'Failed to
 * start realtime transcribe. State: -100'." B26/B29 context: the mic re-arms as a mic (not a stop) during an
 * in-progress recording, so a quick second press fires ANOTHER startRecording → startRealtimeTranscription
 * while the first native session is still alive/tearing down → native transcribeRealtime rejects with
 * State:-100 (a collision). The user's intent on a double-tap is ONE recording, never two racing sessions.
 *
 * JS-decided defect (the part this fake test owns): useWhisperTranscription.startRecording, on a second press
 * while isRecording, calls stopRecording() (a 2500ms trailing-audio wait) and THEN proceeds to start a fresh
 * realtime session — so the native transcribeRealtime is entered a SECOND time. On device that second entry,
 * arriving before the first session has fully released, is what throws State:-100. Product-correct: a
 * double-tap yields exactly ONE realtime session (the redundant press is absorbed, not a new start).
 *
 * DEVICE-BOUNDARY assertion (named, like micNoStopLeakOnLeave names realtimeActive()): the collision itself
 * is a native reject we can't run in jsdom, so we assert at the whisper device boundary — how many times the
 * real whisperService drove the native context.transcribeRealtime. A clean single recording == invoked ONCE.
 * The State:-100 native reject on the second, overlapping start is the one step the human confirms on device.
 *
 * RED on HEAD: the second tap opens a second session → transcribeRealtime invoked TWICE (the start-while-
 * recording collision B12 describes). GREEN after the fix (the redundant press does not open a second native
 * session) → invoked exactly ONCE. Precondition asserts the first session is genuinely active before the
 * second tap, so "always one" can't fake a pass from a session that never started.
 */
import { setupChatScreen } from '../../harness/chatHarness';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {}, useIsFocused: () => true,
}));

describe('T078 (rendered) — double-tapping the chat-mode mic must be one clean recording, no race (DEV-B12)', () => {
  it('opens a SECOND overlapping realtime session on a rapid double-tap (start-while-recording collision)', async () => {
    const h = await setupChatScreen({ engine: 'llama', platform: 'android', whisper: true });
    await h.setupWhisperModel(); // downloaded + selected + resident, via the real select gesture
    h.render();

    const whisper = h.boundary.whisper!;
    // The native whisper context the REAL whisperService drives; its transcribeRealtime is the native
    // start-a-realtime-session leaf. Each invocation = one attempt to open a live mic session.
    const ctx = await (whisper.module.initWhisper as jest.Mock).mock.results[0].value;
    const nativeStarts = () => (ctx.transcribeRealtime as jest.Mock).mock.calls.length;

    // GESTURE 1: press the chat-mode mic → REAL startRecording → REAL startRealtimeTranscription → the native
    // realtime session starts (one native start).
    await h.tapMic();
    await h.rtl.waitFor(() => { expect(whisper.hasRealtimeSubscriber()).toBe(true); });
    // Precondition: the first session is GENUINELY capturing (so the second start is a real overlap, not a
    // no-op firing against a dead session — a false "only one" can't hide behind a session that never began).
    expect(whisper.realtimeActive()).toBe(true);
    expect(nativeStarts()).toBe(1);

    // GESTURE 2: quickly press the mic AGAIN while the first recording is still live (the B12/B29 double-tap:
    // the button still looks/acts like a mic during an in-progress recording, so a user taps it to "record
    // again"). Let the real start-while-recording path run to completion (the 2500ms trailing-audio stop the
    // hook inserts before it starts the second session).
    await h.tapMic();
    await h.settle(3000);

    // SPEC (T078): a double-tap is ONE clean recording — the redundant press must not open a second native
    // realtime session. RED on HEAD: startRecording stops then re-starts → the native session is entered a
    // SECOND time (the overlap that throws State:-100 on device). Assert the device-boundary invariant.
    expect(nativeStarts()).toBe(1);
  }, 20000);
});
