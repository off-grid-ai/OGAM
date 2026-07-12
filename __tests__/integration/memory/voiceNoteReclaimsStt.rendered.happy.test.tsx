/**
 * T115 (checklist Area 3) — VOICE twin of T111: a voice-note send on a memory-tight device reclaims the idle
 * whisper (STT) sidecar. After the note transcribes (whisper USED, then idle), sending the transcript is a
 * generation turn that goes through the same handleSendFn → reclaimSttForGeneration path as a typed turn, so
 * on a ≤6GB device whisper is freed for the LLM working set. The reply still renders.
 *
 * Real user behavior: enter voice mode (real gesture), record a voice note and release to send (real
 * transcribeFile → onTranscript → send). Result validated through the model selector's real "In Memory"
 * section: after the voice turn, the whisper row is gone while the text model row stays. (The precondition —
 * whisper + text both resident — is a setup check via getResidents; the BEHAVIOR is UI-validated. Note: the
 * selector cannot be rendered BEFORE voiceSend — a second tree mid-voice-turn disrupts the record state.)
 *
 * Falsify: keep the device roomy (>6GB) → whisper stays listed → red.
 */
import { setupChatScreen } from '../../harness/chatHarness';

const GB = 1024 * 1024 * 1024;

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {}, useIsFocused: () => true,
}));

describe('T115 (rendered) — voice-note send reclaims idle STT on a tight device (In Memory UI)', () => {
  it('frees whisper after a voice-note turn on a ≤6GB device, and still renders the reply', async () => {
    const h = await setupChatScreen({
      engine: 'litert',
      platform: 'android',
      whisper: true,
      pro: true, // voice mode (TTS) available
      ram: { platform: 'android', totalBytes: 12 * GB, availBytes: 9 * GB },
    });
    // Whisper resident (real download+select) BEFORE render (the order the working voice tests use).
    await h.setupWhisperModel();
    h.render();
    /* eslint-disable @typescript-eslint/no-var-requires */
    const React = require('react');
    const { ModelSelectorModal } = require('../../../src/components/ModelSelectorModal');
    const { hardwareService } = require('../../../src/services/hardware');
    const { modelResidencyManager } = require('../../../src/services/modelResidency');
    /* eslint-enable @typescript-eslint/no-var-requires */
    const residentTypes = () => (modelResidencyManager.getResidents() as Array<{ type: string }>).map(r => r.type);

    // Enter voice mode (real gesture) on the roomy device.
    await h.enterVoiceMode();
    // Precondition (setup check only): text + whisper both resident before the turn.
    expect(residentTypes()).toEqual(expect.arrayContaining(['text', 'whisper']));

    // Memory tightens to ≤6GB (the reclaim gate keys on TOTAL).
    h.boundary.setRam({ platform: 'android', totalBytes: 6 * GB, availBytes: 5 * GB });
    await hardwareService.refreshMemoryInfo();

    // Real user behavior: record a voice note and release to send (transcribe → onTranscript → send).
    await h.voiceSend('what is 2 plus 2', { content: 'It is 4.' });
    // Voice mode: the reply is an AUDIO bubble (spoken via TTS), not rendered text. Assert the assistant
    // reply's audio bubble renders and carries the answer — the visible artifact of a completed voice turn.
    await h.rtl.waitFor(() => {
      const msgs = h.useChatStore.getState().getActiveConversation?.()?.messages ?? [];
      const reply = msgs.find((m: { role: string }) => m.role === 'assistant');
      expect(reply?.content).toMatch(/It is 4/);
      expect(h.view!.queryByTestId(`audio-bubble-${(reply as { id: string }).id}`)).not.toBeNull();
    }, { timeout: 6000 });

    // Result via the In Memory UI (the selector is rendered AFTER the voice turn): the idle whisper was
    // reclaimed for the generation working set; the text model stays.
    const sel = h.rtl.render(React.createElement(ModelSelectorModal, {
      visible: true, onClose: () => {}, onSelectModel: () => {}, onUnloadModel: () => {}, isLoading: false,
      currentModelPath: null,
    }));
    await h.rtl.waitFor(() => { expect(sel.queryByTestId('in-memory-section')).not.toBeNull(); }, { timeout: 4000 });
    await h.rtl.waitFor(() => { expect(sel.queryByTestId('resident-item-whisper')).toBeNull(); }, { timeout: 4000 });
    expect(sel.queryByTestId('resident-item-text')).not.toBeNull();
  });
});
