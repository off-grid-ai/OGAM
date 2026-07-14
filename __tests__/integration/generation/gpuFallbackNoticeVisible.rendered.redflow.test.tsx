/**
 * RED-FLOW (UI integration, HEAVY entry point) — when the user selects a GPU backend and the GPU init
 * fails, the CPU fallback must be VISIBLE in the chat, not silent. Device ground truth (offgrid-debug.log
 * 2026-07-13 18:57, gemma-4-E2B on Adreno 735): user set Backend=GPU + reloaded → "OpenCL backend —
 * offloading 24 layers to GPU" → "Attempt 1/3 failed (GPU): GPU context init timed out after 8000ms" →
 * CPU init succeeded → the turn ran at 3.4 tok/s on CPU. The ONLY tell was the meta line, which is gated
 * behind Show Generation Details (off by default) — the user reported it as "GPU selected but CPU".
 *
 * SPEC (product view): a user who explicitly selected GPU and got CPU must SEE that downgrade happen —
 * a system notice in the conversation — without needing any debug/details setting. T016 already guards
 * that the fallback is graceful and the meta truthful; THIS guards that it is never silent.
 *
 * Real ChatScreen + real BackendSelector + real reload banner + real llmService/initContextWithFallback;
 * fakes only at the llama.rn boundary (initLlama with n_gpu_layers>0 rejects — the timeout's shape).
 * Show Generation Details stays OFF — the notice must not depend on it.
 *
 * RED on HEAD: no such notice exists anywhere in the app.
 * Falsifier inside: the same reload with a HEALTHY GPU init shows NO notice (it is a fallback notice,
 * not a load-time banner).
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
  (DeviceInfo.getHardware as jest.Mock).mockResolvedValue('qcom'); // Adreno → OpenCL allowed
  selectBackendViaUI(h, 'opencl');
  await h.rtl.waitFor(() => { expect(h.view!.queryByTestId('reload-model-banner')).not.toBeNull(); });
  await h.rtl.act(async () => { pressByWalkingUp(h.view!.getByTestId('reload-model-banner')); });
  await h.rtl.waitFor(() => { expect(h.view!.queryByTestId('reload-model-banner')).toBeNull(); }, { timeout: 20000 });
}

describe('GPU fallback notice — a GPU-selected load that lands on CPU is visibly reported (device 18:57)', () => {
  it('shows a CPU-fallback notice in the conversation when the GPU init fails (details OFF)', async () => {
    const h = await setupChatScreen({ engine: 'llama', platform: 'android' });
    h.render();

    // A live conversation exists (the user was chatting when they changed the backend, as on device).
    await h.send('hello', { text: 'Hi there.' });
    await h.rtl.waitFor(() => { expect(h.view!.queryByText(/Hi there\./)).not.toBeNull(); });

    // PRE-CONDITION: no fallback notice is on screen before the reload.
    expect(h.view!.queryByText(/running on CPU/i)).toBeNull();

    // Device boundary: the GPU/OpenCL context init times out (B24's exact failure shape).
    h.boundary.llama!.scriptGpuInitFailure();
    await reloadOnOpenCL(h);

    // RED on HEAD: the downgrade is silent — no notice renders anywhere.
    await h.rtl.waitFor(() => { expect(h.view!.queryByText(/running on CPU/i)).not.toBeNull(); }, { timeout: 20000 });
  }, 30000);

  it('falsify: a healthy GPU reload shows NO fallback notice', async () => {
    const h = await setupChatScreen({ engine: 'llama', platform: 'android' });
    h.render();

    await h.send('hello', { text: 'Hi there.' });
    await h.rtl.waitFor(() => { expect(h.view!.queryByText(/Hi there\./)).not.toBeNull(); });

    // No GPU-init failure: the OpenCL offload succeeds — the notice must NOT appear.
    await reloadOnOpenCL(h);
    await h.settle(200);
    expect(h.view!.queryByText(/running on CPU/i)).toBeNull();
  }, 30000);
});
