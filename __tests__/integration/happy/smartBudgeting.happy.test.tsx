/**
 * HAPPY-PATH (UI, BEHAVIORAL) — smart budgeting: a fittable image model, generated via the real force-mode +
 * send gesture on the ChatScreen, produces an image, becomes resident, and shows NO "Not Enough Memory"
 * card. GREEN counterpart to the M-series over-admit/over-refuse reds.
 *
 * REAL modelResidencyManager + memoryBudget + imageGenerationService over the seeded native RAM leaf (no
 * mock of the budget logic). The image model is DOWNLOADED (boundary) + ACTIVATED by the toggle gesture.
 */
import { setupChatScreen } from '../../harness/chatHarness';
import { GB } from '../../harness/nativeBoundary';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {},
  useIsFocused: () => true,
}));

describe('happy — a fittable image gen succeeds with no failure card (heavy entry point)', () => {
  it('generates on ample RAM, becomes resident, shows no ModelFailureCard', async () => {
    const h = await setupChatScreen({ engine: 'litert', platform: 'ios', ram: { platform: 'ios', totalBytes: 12 * GB, availBytes: 8 * GB } });
    h.render();
    await h.placeImageModel({ backend: 'coreml' }); // fits comfortably in 8GB free

    await h.cycleImageMode(); // auto → ON(force); activates the downloaded image model
    await h.rtl.waitFor(() => { expect(h.view!.queryByTestId('image-mode-force-badge')).not.toBeNull(); });
    await h.tapSend('a red bicycle');

    // The fittable load succeeded through the REAL gate: the native image generator ran...
    await h.rtl.waitFor(() => { expect(h.boundary.diffusion.calls.generateImage).toHaveLength(1); });

    const { modelResidencyManager } = require('../../../src/services/modelResidency');
    expect(modelResidencyManager.isResident('image')).toBe(true);

    // ...and the user sees NO "Not Enough Memory" card anywhere on the chat screen.
    expect(h.view!.queryByText(/Not Enough Memory/)).toBeNull();
  });
});
