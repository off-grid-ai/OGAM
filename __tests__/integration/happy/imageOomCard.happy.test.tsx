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

const MB = 1024 * 1024;

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: () => {},
    goBack: () => {},
    setOptions: () => {},
    addListener: () => () => {},
  }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {},
  useIsFocused: () => true,
}));

describe('happy — image-gen OOM surfaces the graceful "Not Enough Memory" card (heavy entry point)', () => {
  it('shows Load Anyway, then honors the explicit override and renders the image', async () => {
    const h = await setupChatScreen({ engine: 'llama', platform: 'ios' });
    h.render();
    await h.placeImageModel({ backend: 'coreml', size: 1200 * MB });

    await h.cycleImageMode(); // auto → ON(force); also activates the downloaded image model
    await h.rtl.waitFor(() => {
      expect(h.view!.queryByTestId('image-mode-force-badge')).not.toBeNull();
    });

    // The device is now a modest 4GB with only 300MB free (dropped AFTER the text model loaded so setup
    // succeeded). The normal gate refuses the ~2.1GB image working set, but evicting the resident text
    // model leaves enough real RAM for an explicit override without crossing the survival floor.
    h.boundary.setRam({
      platform: 'ios',
      totalBytes: 4 * GB,
      availBytes: 300 * 1024 * 1024,
    });
    const { hardwareService } = require('../../../src/services/hardware');
    await hardwareService.refreshMemoryInfo();

    await h.tapSend('a fox in the snow');

    // Graceful outcome: the user sees the memory card + the override, and NO image was generated.
    await h.rtl.waitFor(() => {
      expect(h.view!.queryByText(/Not Enough Memory/)).not.toBeNull();
    });
    expect(h.view!.queryByText('Load Anyway')).not.toBeNull();
    expect(h.boundary.diffusion.calls.generateImage).toHaveLength(0);

    // The explicit override is a real user action. It re-runs the owning image
    // load/generation path with override=true instead of presenting a second dead end.
    h.rtl.fireEvent.press(h.view!.getByText('Load Anyway'));
    await h.rtl.waitFor(
      () => {
        expect(h.boundary.diffusion.calls.generateImage).toHaveLength(1);
        expect(h.view!.queryByTestId('generated-image')).not.toBeNull();
      },
      { timeout: 6000 },
    );
  });
});
