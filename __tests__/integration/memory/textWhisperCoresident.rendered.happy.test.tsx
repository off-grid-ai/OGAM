/**
 * T116 (checklist Area 3) — ALLOWED co-residence: a heavy text model and the whisper (STT) sidecar co-reside
 * on a roomy device. The single-model rule evicts HEAVIES for each other (text↔text, text↔image — see T026),
 * but a small reclaimable sidecar (whisper) co-resides warm alongside the active heavy; it is NOT evicted by
 * the heavy, and it does NOT evict the heavy.
 *
 * Validated through the model selector's real "In Memory" section (the residency indicator), not
 * getResidents(): after a text model is loaded and a whisper model is downloaded+selected, the section lists
 * BOTH models-row-text-ram AND models-row-speech-ram. The transition (text-only → text+whisper) proves whisper
 * co-resides without evicting the heavy.
 *
 * Falsify: if whisper were treated as a heavy (mis-applying the single-model rule to the sidecar), loading it
 * would evict text and only models-row-speech-ram would show. Contrast to T026 (two heavies must NOT co-reside).
 */
import { setupChatScreen } from '../../harness/chatHarness';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {}, useIsFocused: () => true,
}));

describe('T116 (rendered) — text + whisper allowed co-residence (In Memory UI)', () => {
  it('lists BOTH the text model and the whisper sidecar as in-memory on a roomy device', async () => {
    // Roomy device so both the heavy and the sidecar fit (co-residence is about the RULE, not the budget).
    const h = await setupChatScreen({ engine: 'litert', platform: 'android', whisper: true });
    h.render();
    /* eslint-disable @typescript-eslint/no-var-requires */
    const React = require('react');
    const { ModelsManagerSheet } = require('../../../src/components/models/ModelsManagerSheet');
    /* eslint-enable @typescript-eslint/no-var-requires */
    const openSelector = () => h.rtl.render(React.createElement(ModelsManagerSheet, {
      visible: true, onClose: () => {}, labels: { text: '—', image: '—', voice: '—', speech: '—' },
      loadingState: { isLoading: false }, isEjecting: false, hasActiveModel: false,
      onOpenRow: () => {}, onEject: () => {},
    }));

    // Precondition via the SAME real UI: only the text model is in memory (no whisper yet).
    const before = openSelector();
    await h.rtl.waitFor(() => { expect(before.queryByTestId('models-row-text-ram')).not.toBeNull(); }, { timeout: 4000 });
    expect(before.queryByTestId('models-row-speech-ram')).toBeNull();
    before.unmount();

    // Real gesture: download + select a whisper STT model (co-resides as a sidecar, must NOT evict text).
    await h.setupWhisperModel();

    // Result via the In Memory UI: BOTH are listed — the heavy text model kept its RAM, whisper co-resides.
    const after = openSelector();
    await h.rtl.waitFor(() => { expect(after.queryByTestId('models-row-speech-ram')).not.toBeNull(); }, { timeout: 4000 });
    expect(after.queryByTestId('models-row-text-ram')).not.toBeNull();
  });
});
