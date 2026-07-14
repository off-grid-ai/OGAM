/**
 * T016 (GREEN guard, UI) — a GPU/OpenCL context init that times out must fall back to CPU gracefully: the
 * model still loads and a reply renders (no silent hang / no failed load), and the Generation Details reflect
 * the CPU fallback rather than a phantom GPU offload.
 *
 * Device (B24): first GPU/OpenCL init "timed out after 8000ms" → offloaded 0/36 → retry. The 8s timing has no
 * rendered surface (we don't assert it); the user-observable outcome is: the turn still works, on CPU. This
 * guards that graceful GPU→CPU fallback.
 *
 * Real stack: mount ChatScreen (llama), pick GPU/OpenCL via the real BackendSelector, tap the real reload
 * banner → real initContextWithFallback: attempt 1 (GPU, n_gpu_layers>0) rejects (the fake models the timeout),
 * attempt 2 (CPU, n_gpu_layers:0) succeeds. Then send → the reply renders and the meta shows CPU. The only
 * fakes are device leaves (llama init/completion, DeviceInfo). Falsify: without the GPU-init failure, the same
 * flow keeps the GPU offload (meta shows OpenCL) — so the CPU here is the fallback, not an always-CPU default.
 */
import { setupChatScreen } from '../../harness/chatHarness';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {}, useIsFocused: () => true,
}));

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

function selectBackendViaUI(h: Awaited<ReturnType<typeof setupChatScreen>>, backendId: string) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { BackendSelector } = require('../../../src/components/settings/textGenAdvancedSections');
  const s = h.rtl.render(h.React.createElement(BackendSelector, {}));
  h.rtl.fireEvent.press(s.getByTestId(`backend-${backendId}-button`));
  s.unmount();
}

async function reloadOnOpenCL(h: Awaited<ReturnType<typeof setupChatScreen>>) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const DeviceInfo = require('react-native-device-info');
  (DeviceInfo.getHardware as jest.Mock).mockResolvedValue('qcom'); // Adreno → OpenCL supported
  selectBackendViaUI(h, 'opencl');
  await h.rtl.waitFor(() => { expect(h.view!.queryByTestId('reload-model-banner')).not.toBeNull(); });
  await h.rtl.act(async () => { pressByWalkingUp(h.view!.getByTestId('reload-model-banner')); });
  await h.rtl.waitFor(() => { expect(h.view!.queryByTestId('reload-model-banner')).toBeNull(); }, { timeout: 20000 });
}

describe('T016 (rendered) — GPU init timeout falls back to CPU gracefully (DEV-B24)', () => {
  it('still renders a reply on CPU when the GPU/OpenCL init times out', async () => {
    const h = await setupChatScreen({ engine: 'llama', platform: 'android' });
    h.enableGenerationDetailsViaUI();
    h.render();

    // The GPU/OpenCL context init will time out (B24), forcing the CPU fallback.
    h.boundary.llama!.scriptGpuInitFailure();
    await reloadOnOpenCL(h);

    await h.send('hello', { text: 'Hi there.' });
    // The turn still works — the load did not hang or fail; a reply renders.
    await h.rtl.waitFor(() => { expect(h.view!.queryByText(/Hi there\./)).not.toBeNull(); });

    // ...and the Generation Details reflect the CPU fallback, not a phantom GPU offload.
    const meta = await h.rtl.waitFor(() => h.view!.getByTestId('generation-meta'));
    expect(h.rtl.within(meta).queryByText('CPU')).not.toBeNull();
    expect(h.rtl.within(meta).queryByText(/OpenCL/)).toBeNull();
  }, 30000); // reload now includes the device-critical memory-reclaim wait — allow for it under load

  it('falsify: without the GPU init failure, OpenCL keeps the GPU offload', async () => {
    const h = await setupChatScreen({ engine: 'llama', platform: 'android' });
    h.enableGenerationDetailsViaUI();
    h.render();

    // No GPU-init failure → the OpenCL offload succeeds.
    await reloadOnOpenCL(h);
    await h.send('hello', { text: 'Hi there.' });
    await h.rtl.waitFor(() => { expect(h.view!.queryByText(/Hi there\./)).not.toBeNull(); });

    const meta = await h.rtl.waitFor(() => h.view!.getByTestId('generation-meta'));
    expect(h.rtl.within(meta).queryByText(/OpenCL \(\d+L\)/)).not.toBeNull(); // GPU offload kept
  }, 30000); // reload now includes the device-critical memory-reclaim wait — allow for it under load
});
