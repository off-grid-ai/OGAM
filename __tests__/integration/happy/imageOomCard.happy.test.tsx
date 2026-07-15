/**
 * HAPPY-PATH (UI, BEHAVIORAL — graceful OOM surface) — when an image generation can't fit the image model in
 * RAM, the user sees the dismissible "Not Enough Memory" card with a "Load Anyway" override instead of a crash.
 *
 * Heavy entry point on the REAL ChatScreen: the user turns image-mode ON and sends. The device is now low on
 * RAM (dropped below the image model's need AFTER the text model loaded), so the REAL activeModelService /
 * modelResidencyManager memory gate refuses the image-model load → the REAL imageGenerationService reports it
 * → the REAL ModelFailureCard renders. Only the native leaves + RAM sensor + fs are faked. The card IS the
 * correct graceful outcome (avoidance, not a SIGKILL) — this proves the user-visible failure surface works.
 */
import { setupChatScreen } from '../../harness/chatHarness';
import { GB } from '../../harness/nativeBoundary';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {},
  useIsFocused: () => true,
}));

describe('happy — image-gen OOM surfaces the graceful "Not Enough Memory" card (heavy entry point)', () => {
  it('refuses the over-budget image load and shows the card with Load Anyway (no crash, no image)', async () => {
    const h = await setupChatScreen({ engine: 'litert', platform: 'ios' }); // generous RAM for text-model setup
    h.render();
    await h.placeImageModel({ backend: 'coreml' }); // Core ML — no integrity-file gate; ~2GB model (~3.7GB est on iOS)

    await h.cycleImageMode(); // auto → ON(force); also activates the downloaded image model
    await h.rtl.waitFor(() => { expect(h.view!.queryByTestId('image-mode-force-badge')).not.toBeNull(); });

    // The device is now a modest 4GB with only 300MB free (dropped AFTER the text model loaded so setup
    // succeeded). The send's image-model load hits the real residency gate: even evicting the resident text
    // model, the ~3.7GB image estimate can't fit → the gate refuses (OverridableMemoryError).
    h.boundary.setRam({ platform: 'ios', totalBytes: 4 * GB, availBytes: 300 * 1024 * 1024 });
    const { hardwareService } = require('../../../src/services/hardware');
    await hardwareService.refreshMemoryInfo();

    await h.tapSend('a fox in the snow');

    // Graceful outcome: the user sees the memory card + the override, and NO image was generated.
    await h.rtl.waitFor(() => { expect(h.view!.queryByText(/Not Enough Memory/)).not.toBeNull(); });
    expect(h.view!.queryByText('Load Anyway')).not.toBeNull();
    expect(h.boundary.diffusion.calls.generateImage.length).toBe(0);
  });
});
