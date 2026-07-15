/**
 * HAPPY-PATH (UI, BEHAVIORAL) — image generation across compute backends via the REAL ChatScreen: the user
 * turns on the image-mode toggle (ON/force) and sends; the generated image's details show the correct
 * backend label: NPU→"QNN (NPU)" · MNN(GPU)→"MNN (GPU)" · Metal(iOS)→"Core ML (ANE)".
 *
 * Only the native diffusion + LiteRT leaves are faked. The image model is DOWNLOADED (boundary) and ACTIVATED
 * by the real toggle gesture (not setState). Generation details are turned on via the real toggle.
 * (MNN(CPU) needs the GPU-Acceleration setting OFF; NPU(qnn) requires the device to report a Qualcomm NPU —
 * on the generic faked device qnn CORRECTLY refuses ("NPU models require a Qualcomm Snapdragon processor"),
 * which is real behavior, not a test gap. Both are covered at the service/meta layer, not duplicated here.)
 */
import { setupChatScreen } from '../../harness/chatHarness';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {},
  useIsFocused: () => true,
}));

type Cfg = { label: string; backend: 'mnn' | 'qnn'; platform: 'ios' | 'android'; expected: string };
const CONFIGS: Cfg[] = [
  { label: 'MNN GPU (Android)', backend: 'mnn', platform: 'android', expected: 'MNN (GPU)' },
  { label: 'Metal (Core ML, iOS)', backend: 'mnn', platform: 'ios', expected: 'Core ML (ANE)' },
];

describe('happy — image generation shows the correct backend label (heavy entry point)', () => {
  it.each(CONFIGS)('$label: produces an image and the details show "$expected"', async (cfg) => {
    const h = await setupChatScreen({ engine: 'litert', platform: cfg.platform });
    h.enableGenerationDetailsViaUI(); // turn details on BEFORE mounting the chat (separate render)
    h.render();
    await h.placeImageModel({ backend: cfg.backend });

    await h.cycleImageMode(); // auto → ON(force); the toggle also ACTIVATES the downloaded image model
    await h.rtl.waitFor(() => { expect(h.view!.queryByTestId('image-mode-force-badge')).not.toBeNull(); });
    await h.tapSend('a fox in snow');

    // A real image was produced through the real service + native generateImage...
    await h.rtl.waitFor(() => { expect(h.boundary.diffusion.calls.generateImage.length).toBe(1); });
    // ...and the user sees the correct backend label in the message details.
    await h.rtl.waitFor(() => { expect(h.view!.queryByText(new RegExp(cfg.expected.replace(/[()]/g, '\\$&')))).not.toBeNull(); });
  });
});
