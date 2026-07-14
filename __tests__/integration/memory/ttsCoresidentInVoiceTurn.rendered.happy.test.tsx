/**
 * T120 (checklist Area 3) — TTS co-residence during a voice turn: in voice mode the TTS engine loads as a
 * reclaimable sidecar (registered key/type 'tts', canEvict when playback is idle) alongside the active text
 * model, so a completed voice turn can SPEAK the reply. It co-resides warm — it is not a heavy that evicts
 * the text model. Contrast to T030 (stale TTS phantom after delete).
 *
 * Real user behavior: enter voice mode (real gesture) → record a voice note and release to send (real
 * transcribe → onTranscript → send) → the reply is spoken. Validated through the model selector's real
 * "In Memory" section: it lists models-row-voice-ram with its RAM, alongside the text model.
 *
 * Falsify: without voice mode (no TTS engine loaded), models-row-voice-ram is absent → red.
 */
import { setupChatScreen } from '../../harness/chatHarness';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {}, useIsFocused: () => true,
}));

describe('T120 (rendered) — TTS co-resides during a voice turn (In Memory UI)', () => {
  it('lists the TTS sidecar with its RAM after a spoken voice turn, alongside the text model', async () => {
    const h = await setupChatScreen({ engine: 'litert', platform: 'android', whisper: true, pro: true });
    await h.setupWhisperModel();
    h.render();
    /* eslint-disable @typescript-eslint/no-var-requires */
    const React = require('react');
    const { ModelsManagerSheet } = require('../../../src/components/models/ModelsManagerSheet');
    /* eslint-enable @typescript-eslint/no-var-requires */

    // Enter voice mode (real gesture) — the TTS engine loads as a sidecar — then speak a voice turn.
    await h.enterVoiceMode();
    await h.voiceSend('what is 2 plus 2', { content: 'It is 4.' });
    await h.rtl.waitFor(() => {
      const msgs = h.useChatStore.getState().getActiveConversation?.()?.messages ?? [];
      expect(msgs.find((m: { role: string }) => m.role === 'assistant')?.content).toMatch(/It is 4/);
    }, { timeout: 6000 });

    // Result via the In Memory UI (rendered AFTER the voice turn): the TTS sidecar is listed with its RAM,
    // co-resident with the active text model.
    const sel = h.rtl.render(React.createElement(ModelsManagerSheet, {
      visible: true, onClose: () => {}, labels: { text: '—', image: '—', voice: '—', speech: '—' },
      loadingState: { isLoading: false }, isEjecting: false, hasActiveModel: false,
      onOpenRow: () => {}, onEject: () => {},
    }));
    await h.rtl.waitFor(() => { expect(sel.queryByTestId('models-row-voice-ram')).not.toBeNull(); }, { timeout: 4000 });
    expect(sel.queryByTestId('models-row-text-ram')).not.toBeNull();
    expect(h.rtl.within(sel.getByTestId('models-row-voice-ram')).queryByText(/GB/)).not.toBeNull();
  });
});
