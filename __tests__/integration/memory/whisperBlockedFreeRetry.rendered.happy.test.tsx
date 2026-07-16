/**
 * T119 (GREEN guard, UI) — on a tight device where a heavy text model owns RAM, recording a voice note still
 * transcribes: the whisper load is BLOCKED by the single-model rule, so ensureWhisperForTranscription frees
 * the generation model and retries → whisper loads, the transcript reaches the model, and the reply renders.
 *
 * Device (DEV-B1 + ensureWhisperForTranscription): whisper is a sidecar the single-model rule keeps OUT of RAM
 * while a heavier generation model is resident (makeRoomFor → fits=false → 'blocked'). A voice turn needs it
 * NOW, so the caller frees the generation model and retries.
 *
 * Real stack: mount ChatScreen (pro voice), text model resident, whisper DOWNLOADED-not-loaded, budget pinned
 * tight so the whisper sidecar cannot co-reside. Enter voice mode, record a voice note → the REAL voice path
 * (record → ensureWhisperForTranscription → whisperStore.loadModel='blocked' → freeGenerationModels → retry →
 * transcribeFile → onTranscript → send). Only device leaves are faked (whisper, llama, RAM, TTS executorch).
 *
 * The discriminator: on a tight device, WITHOUT the free→retry the load stays blocked → no resident whisper →
 * transcribeFile can't run → no reply. So a rendered reply proves the blocked→free→retry path ran. Falsify:
 * neutralize freeGenerationModels (Voice.ts) → blocked stays → no reply.
 */
import { setupChatScreen } from '../../harness/chatHarness';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {}, useIsFocused: () => true,
}));

describe('T119 (rendered) — voice note transcribes when whisper load is blocked (free→retry) (DEV-B1)', () => {
  it('frees the generation model, loads whisper, and the reply renders on a tight device', async () => {
    const h = await setupChatScreen({ engine: 'llama', platform: 'android', pro: true, whisper: true });
    /* eslint-disable @typescript-eslint/no-var-requires */
    const { useWhisperStore } = require('../../../src/stores/whisperStore');
    const { modelResidencyManager } = require('../../../src/services/modelResidency');
    /* eslint-enable @typescript-eslint/no-var-requires */

    // DOWNLOAD-ONLY whisper: the completed-download boundary artifact (file on disk + downloadedModelId) with
    // NO resident load — so the voice turn's first load attempt runs for real (and blocks on the tight budget).
    const docs = h.boundary.fs!.DocumentDirectoryPath;
    h.boundary.fs!.seedFile(`${docs}/whisper-models/ggml-tiny.en.bin`, 75 * 1024 * 1024);
    await useWhisperStore.getState().refreshPresentModels();
    useWhisperStore.setState({ downloadedModelId: 'tiny.en', isModelLoaded: false });

    // Pin the budget tight: the resident text model fills it, so the whisper sidecar cannot co-reside →
    // makeRoomFor returns fits=false → whisperStore.loadModel returns 'blocked'.
    modelResidencyManager.setBudgetOverrideMB(700);

    h.render();
    await h.enterVoiceMode();

    // Real voice turn: record → transcribe. On the tight device the first whisper load blocks; the real
    // ensureWhisperForTranscription frees the text model and retries so the transcript can be produced.
    await h.voiceSend('what is two plus two', { content: 'It is four.' });

    // The reply renders as an audio bubble — which, on a blocked device, is only possible if the free→retry
    // loaded whisper and the transcript reached the model.
    await h.rtl.waitFor(() => { expect(h.view!.queryAllByTestId(/^audio-bubble-/).length).toBeGreaterThan(0); }, { timeout: 6000 });
  });
});
