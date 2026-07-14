/**
 * T014 (HAPPY/GUARD, UI integration, HEAVY entry point) — selecting the GPU/OpenCL text backend and
 * reloading the model surfaces a GPU-offloaded backend in the per-message Generation Details, not CPU.
 *
 * Device ground truth (DEVICE_TEST_FINDINGS.md, session 3 backend matrix + B24): on the OPPO/SM8635,
 * gemma-4-E2B gguf on the OpenCL backend offloaded real layers to the GPU (24/36). The invariant this
 * guards: the settings→load flow (pick OpenCL → reload) makes the loaded context report GPU with layers
 * offloaded, and that reaches the rendered GenerationMeta ("OpenCL (NL)") — never a silent CPU fallback.
 *
 * Real ChatScreen + real BackendSelector gesture + real reload banner + real llmService/captureGpuInfo +
 * real GenerationMeta; only the native llama leaf is faked. The fake's initLlama echoes gpu/devices from
 * the requested n_gpu_layers exactly as llama.cpp does — so the GPU label is EMERGENT from the real path,
 * not programmed. Falsified by the CPU-backend sibling: same flow, CPU selected → "CPU", no "(NL)".
 */
import { setupChatScreen } from '../../harness/chatHarness';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {},
  useIsFocused: () => true,
}));

/** Invoke the onPress bound to a testID host node's nearest pressable ancestor — for an AnimatedPressable
 *  (createAnimatedComponent(TouchableOpacity)) whose onPress lives on the composite above the host, which
 *  RTL's fireEvent.press traversal doesn't reach. Same thing a real tap does. */
function pressByWalkingUp(node: unknown): void {
  type N = { props?: Record<string, unknown>; parent?: N | null } | null;
  let n = node as N;
  for (let d = 0; n && d < 12; d++) {
    const op = n.props?.onPress;
    if (typeof op === 'function') { (op as () => void)(); return; }
    n = n.parent ?? null;
  }
  throw new Error('no onPress found walking up from the node');
}

/** Arrive-via-UI: change the text inference backend by tapping the real BackendSelector segment (the same
 *  control Model Settings → Text → Advanced renders). Shares the app store with the mounted ChatScreen, so
 *  the change flips the "settings changed" reload banner. NOT updateSettings seeding. */
function selectBackendViaUI(h: Awaited<ReturnType<typeof setupChatScreen>>, backendId: string) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { BackendSelector } = require('../../../src/components/settings/textGenAdvancedSections');
  const s = h.rtl.render(h.React.createElement(BackendSelector, {}));
  h.rtl.fireEvent.press(s.getByTestId(`backend-${backendId}-button`));
  s.unmount();
}

describe('T014 — GPU/OpenCL backend → GenerationMeta shows GPU layers offloaded (heavy entry point)', () => {
  it('selecting OpenCL + reloading renders a GPU-offloaded backend, not CPU', async () => {
    const h = await setupChatScreen({ engine: 'llama', platform: 'android' });
    // Device boundary: an Adreno (Qualcomm) GPU — getOpenCLCapability keys off DeviceInfo.getHardware.
    // The seeded 'unknown' device would (correctly) refuse OpenCL, so seed the real device's SoC family.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const DeviceInfo = require('react-native-device-info');
    (DeviceInfo.getHardware as jest.Mock).mockResolvedValue('qcom');

    h.enableGenerationDetailsViaUI(); // real segmented toggle → the details row renders under each reply
    h.render();

    // Precondition: the model was loaded on the default (CPU) backend — no GPU meta yet.
    // GESTURE: pick GPU/OpenCL in the real BackendSelector → the "settings changed" reload banner appears.
    selectBackendViaUI(h, 'opencl');
    await h.rtl.waitFor(() => { expect(h.view!.queryByTestId('reload-model-banner')).not.toBeNull(); });
    // GESTURE: tap the banner → the REAL reload unloads + reloads the model on the OpenCL backend.
    // The banner is an AnimatedPressable (createAnimatedComponent(TouchableOpacity)); its onPress lives on
    // the composite ABOVE the testID host node, which RTL's press traversal doesn't reach — so walk up the
    // parent chain to the bound onPress and invoke it (the same thing a tap does — see the harness send helper).
    await h.rtl.act(async () => { pressByWalkingUp(h.view!.getByTestId('reload-model-banner')); });
    await h.rtl.waitFor(() => { expect(h.view!.queryByTestId('reload-model-banner')).toBeNull(); }, { timeout: 20000 });

    await h.send('hello', { text: 'Hi there.' });
    await h.rtl.waitFor(() => { expect(h.view!.queryByText(/Hi there\./)).not.toBeNull(); });

    // The per-message Generation Details show a GPU-offloaded backend with a layer count (e.g. "OpenCL (99L)")
    // — the layers reached the GPU, not a silent CPU fallback.
    const meta = await h.rtl.waitFor(() => h.view!.getByTestId('generation-meta'));
    expect(h.rtl.within(meta).queryByText(/OpenCL \(\d+L\)/)).not.toBeNull();
    // And it is NOT running on CPU.
    expect(h.rtl.within(meta).queryByText('CPU')).toBeNull();
  }, 30000); // reload now includes the device-critical memory-reclaim wait — allow for it under load

  it('falsify: CPU backend renders "CPU" with no offloaded layers', async () => {
    const h = await setupChatScreen({ engine: 'llama', platform: 'android' });
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const DeviceInfo = require('react-native-device-info');
    (DeviceInfo.getHardware as jest.Mock).mockResolvedValue('qcom');
    h.enableGenerationDetailsViaUI();
    h.render();

    // The default backend IS CPU on Android — no backend change, straight to a send.
    await h.send('hello', { text: 'Hi there.' });
    await h.rtl.waitFor(() => { expect(h.view!.queryByText(/Hi there\./)).not.toBeNull(); });

    const meta = await h.rtl.waitFor(() => h.view!.getByTestId('generation-meta'));
    expect(h.rtl.within(meta).queryByText('CPU')).not.toBeNull();
    expect(h.rtl.within(meta).queryByText(/OpenCL/)).toBeNull();
    expect(h.rtl.within(meta).queryByText(/\(\d+L\)/)).toBeNull();
  });
});
