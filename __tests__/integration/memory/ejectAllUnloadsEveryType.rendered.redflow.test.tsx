/**
 * T023b / DEV-B1 (FIXED, guard) — Eject All frees EVERY resident model, including sidecars (whisper), not
 * just text + image.
 *
 * History: ejectAll (activeModelService:436) unloaded only text + image; sidecars (whisper/tts/embedding)
 * leaked and kept charging the memory budget after the user ejected everything. FIXED by iterating the
 * remaining residents through modelResidencyManager.evictByKey after unloadAllModels. This guard locks it.
 *
 * State reached through REAL interactions (no register() shortcut): setupChatScreen loads a text model via
 * the Home picker; loadImageModel loads an imported image model; a real whisper download+select makes whisper
 * co-resident. So getResidents() contains text + image + whisper. Then the REAL ejectAll.
 *
 * GREEN: after ejectAll, NOTHING is resident. Falsified: removing the sidecar-eviction loop from ejectAll
 * leaves whisper resident → red.
 */
import { setupChatScreen } from '../../harness/chatHarness';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {}, useIsFocused: () => true,
}));

describe('T023b (rendered) — Eject All frees every resident, sidecars included (DEV-B1, fixed)', () => {
  it('leaves NO model resident after ejectAll (whisper sidecar freed too)', async () => {
    // Keep a substantial text model resident so Eject All must unload every runtime class.
    const h = await setupChatScreen({ engine: 'litert', platform: 'android', whisper: true, modelFileSizeBytes: 4 * 1024 * 1024 * 1024 });
    h.render();
    const imageModel = await h.placeImageModel({ backend: 'mnn' });
     
    const { activeModelService } = require('../../harness/activeModelLifecycle');
    const { modelResidencyManager } = require('../../harness/activeModelLifecycle');
     
    await activeModelService.loadImageModel(imageModel.id);
    await h.setupWhisperModel();
    await h.loadSelectedWhisperOnDemand();

    const types = () => (modelResidencyManager.getResidents() as Array<{ type: string }>).map(r => r.type).sort();

    // Real precondition: text + image + whisper are in memory (so the post-eject check is meaningful).
    expect(types()).toEqual(['image', 'text', 'transcription']);

    // The REAL Eject All (the exact function the Home "Eject All" button calls).
    await activeModelService.ejectAll();

    // SPEC: Eject All frees ALL resident models, sidecars included.
    expect(types()).toEqual([]);
  });
});
