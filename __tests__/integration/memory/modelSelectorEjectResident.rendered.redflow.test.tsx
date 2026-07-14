/**
 * TDD (feature not built yet) — per-model eject in the model selector.
 *
 * The model selector should list EVERY model currently in memory (text, image, and sidecars like whisper),
 * each with its RAM, and let the user eject each one INDIVIDUALLY — freeing only that model (calling its real
 * unload), leaving the others resident. This is the "In Memory" section. It also lets a user free the whisper
 * sidecar that ejectAll leaks (T023b).
 *
 * State reached through REAL interactions (no register() shortcut): setupChatScreen loads a text model via the
 * Home picker; loadImageModel loads an image model (which evicts the text model — one heavy at a time); a real
 * whisper download+select makes whisper co-resident. So getResidents() ends at image + whisper.
 *
 * These assertions FAIL today (the section + evict-by-key don't exist). They are the spec the feature satisfies.
 */
import { setupChatScreen } from '../../harness/chatHarness';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {}, useIsFocused: () => true,
}));

describe('per-model eject (TDD) — model selector In Memory section', () => {
  it('lists every resident with RAM and ejects one individually, leaving the others', async () => {
    const h = await setupChatScreen({ engine: 'litert', platform: 'android', whisper: true });
    h.render();
    // Real interactions to reach image + whisper resident.
    await h.placeImageModel({ backend: 'mnn' });
    /* eslint-disable @typescript-eslint/no-var-requires */
    const { activeModelService } = require('../../../src/services/activeModelService');
    const { modelResidencyManager } = require('../../../src/services/modelResidency');
    const React = require('react');
    const { ModelsManagerSheet } = require('../../../src/components/models/ModelsManagerSheet');
    /* eslint-enable @typescript-eslint/no-var-requires */
    await activeModelService.loadImageModel('sd');
    await h.setupWhisperModel();

    // Precondition (real): image + whisper are in memory.
    const types = () => (modelResidencyManager.getResidents() as Array<{ type: string }>).map(r => r.type).sort();
    expect(types()).toEqual(['image', 'whisper']);

    const v = h.rtl.render(React.createElement(ModelsManagerSheet, {
      visible: true, onClose: () => {}, labels: { text: '—', image: '—', voice: '—', speech: '—' },
      loadingState: { isLoading: false }, isEjecting: false, hasActiveModel: false,
      onOpenRow: () => {}, onEject: () => {},
    }));

    // The manager sheet marks each RESIDENT row with a RAM chip: image + whisper(→speech) are resident,
    // text is not (it was evicted by the image load — one heavy at a time).
    await h.rtl.waitFor(() => { expect(v.queryByTestId('models-row-image-ram')).not.toBeNull(); }, { timeout: 4000 });
    expect(v.queryByTestId('models-row-speech-ram')).not.toBeNull();
    expect(v.queryByTestId('models-row-text-ram')).toBeNull(); // text not resident → no chip
    // Each resident shows its RAM footprint.
    expect(h.rtl.within(v.getByTestId('models-row-speech-ram')).queryByText(/GB/)).not.toBeNull();

    // SPEC: ejecting whisper frees ONLY whisper (its real unload runs); image stays resident.
    h.rtl.fireEvent.press(v.getByTestId('models-row-speech-eject'));
    await h.rtl.waitFor(() => { expect(types()).toEqual(['image']); }, { timeout: 4000 });
    // The sheet re-projects residency on its poll — wait for the speech chip to clear; image stays.
    await h.rtl.waitFor(() => { expect(v.queryByTestId('models-row-speech-ram')).toBeNull(); }, { timeout: 4000 });
    expect(v.queryByTestId('models-row-image-ram')).not.toBeNull();
  });
});
