/**
 * T077 / DEV-B11 (RED) — a chat-mode recording that the user never stops must not keep the mic capturing
 * after they leave the screen.
 *
 * Device (B11): tapping the mic in chat mode started a realtime whisper session; the user navigated away
 * without releasing, and the session kept capturing for 7+ minutes with whisper pinned resident 1.5GB —
 * it "never stopped". The JS-decided defect: useWhisperTranscription has NO unmount cleanup — its
 * useMountedRef only flips a flag; nothing calls stopTranscription/forceReset when the ChatScreen unmounts.
 *
 * Device-boundary assertion (the sanctioned native-residue exception, like the audio/TTS seam): the mic
 * capture is a native whisper.rn realtime session. The fake tracks whether it is still CAPTURING
 * (transcribeRealtime → stop()/release()). Product-correct: leaving the screen stops the session. RED on
 * HEAD: after the ChatScreen unmounts, the session is STILL active (the leak). The fake test proves the
 * JS-lifecycle bug; the "7-minute / battery / privacy-indicator" residue is the human's on-device check.
 *
 * Falsify: adding an unmount cleanup that calls stopTranscription → the session stops → realtimeActive()
 * false → green. Precondition asserts the session was truly active first, so a no-op can't fake a pass.
 */
import { setupChatScreen } from '../../harness/chatHarness';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {}, useIsFocused: () => true,
}));

describe('T077 (rendered) — chat-mode mic must stop capturing when the user leaves (DEV-B11)', () => {
  it('leaks the realtime mic session after navigating away without stopping', async () => {
    const h = await setupChatScreen({ engine: 'llama', platform: 'android', whisper: true });
    await h.setupWhisperModel();
    h.render();

    // GESTURE: press-and-hold the chat-mode mic → the REAL startRecording → native realtime session starts.
    await h.tapMic();
    await h.settle(300);
    // Precondition: the mic is genuinely capturing (so "still active later" is a real observed transition).
    expect(h.boundary.whisper!.realtimeActive()).toBe(true);

    // GESTURE: navigate away — the ChatScreen unmounts while the recording is still running (the user never
    // tapped stop). The real focus/unmount lifecycle runs; nothing else stops the mic.
    h.view!.unmount();
    await h.settle(300);

    // SPEC: leaving the screen stops the mic. RED on HEAD: no unmount cleanup → the native session keeps
    // capturing (B11's 7-minute leak). The human confirms the on-device privacy indicator / battery drain.
    expect(h.boundary.whisper!.realtimeActive()).toBe(false);
  });
});
