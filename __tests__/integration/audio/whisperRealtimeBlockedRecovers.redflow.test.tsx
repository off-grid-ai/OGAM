/**
 * DEVICE-CONFIRMED (rendered UI) — the realtime hold-to-talk dictation path must RECOVER from a memory
 * refusal, not dead-end. Product rule: ANY memory refusal on ANY model type offers recovery — never a
 * silent dead-end.
 *
 * The defect: on a tight device a heavier generation (text) model owns RAM, so the whisper sidecar's
 * load is BLOCKED by the single-model rule (makeRoomFor → fits=false → loadModel returns 'blocked', it
 * does NOT throw). The realtime path called whisperStore.loadModel() DIRECTLY: a 'blocked' return is not
 * a throw, so it fell through to whisperService.startRealtimeTranscription, which throws 'No Whisper model
 * loaded' → the mic press failed with an error, no transcript, no recovery. The Audio-mode file path
 * already recovers via ensureWhisperForTranscription (free the generation model, retry loadWhisper); the
 * realtime path did not.
 *
 * Real stack: mount the REAL ChatScreen on a NON-audio (llama) model — so chat-mode hold-to-talk takes the
 * whisper REALTIME path (Voice.ts startWhisperRecording), not the direct-audio or file path. The text model
 * is resident, whisper is DOWNLOADED-not-loaded, and the budget is pinned tight so the whisper sidecar
 * cannot co-reside → the first load blocks. Only device leaves are faked (whisper, llama, RAM, fs).
 *
 * Arrive via the REAL hold-to-talk gesture (tapMic grant → releaseMic release), then the (faked) realtime
 * stream delivers the utterance. The USER-FACING outcome under test: the transcript lands in the composer
 * (dictation recovered) — proving blocked → free generation model → retry → whisper loaded → transcript.
 *
 * RED before the fix: the realtime path called loadModel() directly; 'blocked' fell through to
 * startRealtimeTranscription → 'No Whisper model loaded' → error state → the composer stays EMPTY.
 * GREEN: routed through ensureWhisperForTranscription (the same recovery the file path uses) → transcript
 * in the input.
 *
 * The discriminator: on a tight device, WITHOUT the free→retry the load stays blocked → no resident
 * whisper → startRealtimeTranscription throws → the composer never receives text.
 */
import { setupChatScreen } from '../../harness/chatHarness';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {}, useIsFocused: () => true,
}));

describe('realtime hold-to-talk dictation recovers when whisper load is blocked (free→retry) — device', () => {
  it('frees the generation model, loads whisper, and the transcript lands in the composer', async () => {
    const h = await setupChatScreen({ engine: 'llama', platform: 'android', whisper: true });
    const { useWhisperStore } = require('../../../src/stores/whisperStore');
    const { modelResidencyManager } = require('../../../src/services/modelResidency');

    // DOWNLOAD-ONLY whisper: the completed-download boundary artifact (file on disk + downloadedModelId) with
    // NO resident load — so the realtime turn's first load attempt runs for real (and blocks on the tight budget).
    const docs = h.boundary.fs!.DocumentDirectoryPath;
    h.boundary.fs!.seedFile(`${docs}/whisper-models/ggml-tiny.en.bin`, 75 * 1024 * 1024);
    await useWhisperStore.getState().refreshPresentModels();
    useWhisperStore.setState({ downloadedModelId: 'tiny.en', isModelLoaded: false });

    // Pin the budget tight: the resident text model fills it, so the whisper sidecar cannot co-reside →
    // makeRoomFor returns fits=false → whisperStore.loadModel returns 'blocked'.
    modelResidencyManager.setBudgetOverrideMB(700);

    h.render();
    const view = h.view!;

    // Precondition (anti-false-green): the composer is empty.
    const inputBefore = await h.rtl.waitFor(() => view.getByTestId('chat-input'));
    expect(inputBefore.props.value ?? '').toBe('');

    // REAL chat-mode hold-to-talk on a non-audio (llama) model → the whisper REALTIME path.
    await h.tapMic();      // grant → onStartRecording → the whisper realtime dictation path
    await h.settle(200);   // let the (blocked→free→retry) load resolve and the realtime session start
    await h.releaseMic();  // release → onStopRecording (whisper path finalizes)

    // The realtime stream delivers the finished utterance (final event, isCapturing:false).
    await h.rtl.act(async () => {
      h.boundary.whisper!.emitRealtime({ text: 'take a note', isCapturing: false });
    });
    await h.settle(800); // MIN_TRANSCRIBING_TIME + the finalResult → onTranscript effect

    // THE FIX — dictation RECOVERED: the transcript is in the INPUT BOX.
    // RED before: the realtime path dead-ended on 'blocked' (startRealtimeTranscription threw
    // 'No Whisper model loaded') → the composer stayed empty.
    await h.rtl.waitFor(() => {
      expect(view.getByTestId('chat-input').props.value ?? '').toContain('take a note');
    }, { timeout: 4000 });
  });
});
