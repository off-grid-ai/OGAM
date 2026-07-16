/**
 * T023b / DEV-B1 (FIXED, guard) — Eject All frees EVERY resident model, including sidecars (whisper), not
 * just text + image.
 *
 * History: ejectAll (activeModelService:436) unloaded only text + image; sidecars (whisper/tts/embedding)
 * leaked and kept charging the memory budget after the user ejected everything. FIXED by iterating the
 * remaining residents through modelResidencyManager.evictByKey after unloadAllModels. This guard locks it.
 *
 * State reached through REAL interactions (no register() shortcut): setupChatScreen loads a text model via
 * the Home picker; loadImageModel loads an image model (evicts text — one heavy at a time); a real whisper
 * download+select makes whisper co-resident. So getResidents() = image + whisper. Then the REAL ejectAll.
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
    // A heavy (4GB) text model so its "one heavy at a time" premise holds: loading the image model
    // must EVICT the text model (they can't co-reside), leaving residents = image + whisper. The
    // harness default is a lighter 2GB model (fits chat-flow budgets) which would co-reside here.
    const h = await setupChatScreen({ engine: 'litert', platform: 'android', whisper: true, modelFileSizeBytes: 4 * 1024 * 1024 * 1024 });
    h.render();
    await h.placeImageModel({ backend: 'mnn' });
    /* eslint-disable @typescript-eslint/no-var-requires */
    const { activeModelService } = require('../../../src/services/activeModelService');
    const { modelResidencyManager } = require('../../../src/services/modelResidency');
    /* eslint-enable @typescript-eslint/no-var-requires */
    await activeModelService.loadImageModel('sd');
    await h.setupWhisperModel();

    const types = () => (modelResidencyManager.getResidents() as Array<{ type: string }>).map(r => r.type).sort();

    // Real precondition: image + whisper are in memory (so the post-eject check is meaningful).
    expect(types()).toEqual(['image', 'whisper']);

    // The REAL Eject All (the exact function the Home "Eject All" button calls).
    await activeModelService.ejectAll();

    // SPEC: Eject All frees ALL resident models, sidecars included.
    expect(types()).toEqual([]);
  });
});
