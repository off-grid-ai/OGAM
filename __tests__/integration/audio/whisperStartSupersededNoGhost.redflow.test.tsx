/**
 * RED-FLOW (UI, rendered) — #558 CodeRabbit 🔴: no GHOST recording if the mic is released while the
 * whisper model is still loading.
 *
 * The realtime dictation start now awaits ensureModelReady() (which can free the generation model and
 * reload whisper — seconds on device). If the user RELEASES the mic during that await, the start's
 * continuation must NOT proceed to activate a recording — the stop already ran, so a session started
 * after it would never be stopped (a ghost recording that holds the mic forever).
 *
 * Fix under test: a session-intent nonce (useWhisperTranscription) captured before the await; stop/cancel
 * bump it; the start aborts if it changed. Mounts the real ChatScreen; holds the whisper load via the
 * device-boundary fake (holdNextLoad), releases the mic mid-load, then resolves the load — and asserts NO
 * realtime session is active. RED (revert the nonce guard): the continuation runs after release →
 * startRealtimeTranscription fires → realtimeActive() true (the ghost). Only the device leaves are faked.
 */
import { setupChatScreen } from '../../harness/chatHarness';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {}, useIsFocused: () => true,
}));

describe('realtime dictation: releasing the mic during model load starts NO ghost recording (#558)', () => {
  it('aborts the superseded start — no realtime session after release-during-load', async () => {
    const h = await setupChatScreen({ engine: 'llama', platform: 'android', whisper: true });
    const { useWhisperStore } = require('../../../src/stores/whisperStore');

    // Whisper downloaded-not-loaded, so the mic press must load it (the async gap the race lives in).
    const docs = h.boundary.fs!.DocumentDirectoryPath;
    h.boundary.fs!.seedFile(`${docs}/whisper-models/ggml-tiny.en.bin`, 75 * 1024 * 1024);
    await useWhisperStore.getState().refreshPresentModels();
    useWhisperStore.setState({ downloadedModelId: 'tiny.en', isModelLoaded: false });

    h.render();

    // HOLD the whisper load open (device-shaped: a real ggml init takes seconds) so the start is parked
    // inside the ensureModelReady() await when we release the mic.
    h.boundary.whisper!.holdNextLoad();

    await h.tapMic();     // start begins → awaits ensureModelReady() → whisper load HELD
    await h.settle(150);  // the start is now parked in the await
    await h.releaseMic(); // RELEASE during the load → stopRecording bumps the session nonce
    await h.settle(50);

    // Precondition (anti-false-green): the load really was in flight when we released — no session yet.
    expect(h.boundary.whisper!.realtimeActive()).toBe(false);

    // Now let the load resolve. The superseded start must NOT resurrect a recording.
    await h.rtl.act(async () => { h.boundary.whisper!.releaseLoad(); });
    await h.settle(300);

    // TERMINAL artifact: no realtime session is active and none was subscribed — the ghost never started.
    // RED (revert the nonce guard): the continuation proceeds post-release → startRealtimeTranscription →
    // realtimeActive() true.
    expect(h.boundary.whisper!.realtimeActive()).toBe(false);
    expect(h.boundary.whisper!.hasRealtimeSubscriber()).toBe(false);
  }, 30000);
});
