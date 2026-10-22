/**
 * NPU selected on a phone whose Hexagon session does not open: the reply runs on the CPU and the chat
 * says so. It never runs on the Adreno OpenCL GPU.
 *
 * Device ground truth (release/stable-v55-v115, OnePlus/Oppo Snapdragon + Adreno, llama.rn 0.13.0-rc.7,
 * Qwen3.5-2B Q4_K_M, backend = NPU, 2 of 2): "[LLM] HTP backend — offloading 99 layers to NPU", load OK,
 * then the UI janked and ~10 s into the first reply "E/Adreno-GSL: Exiting the process … from function
 * cl_a7p_cmdbuf_mgr_submit_ibs" → signal 9. OpenCL did the work although only the NPU was asked for.
 *
 * Why: llama.rn (cpp/jsi/RNLlamaJSI.cpp buildDeviceOverrides/configureBackendDevices) treats a device
 * list that matches no registered device as absent and falls back to its Android default — every GPU
 * except HTP, i.e. OpenCL. ggml-hexagon drops HTP0 from the registry when its session probe fails, so
 * `devices: ['HTP0']` put all 99 layers on OpenCL. The load now names CPU as the fallback in the list.
 *
 * Real ChatScreen + real BackendSelector + real llmService/initContextWithFallback/captureGpuInfo + real
 * GenerationMeta. Only the llama.rn leaf is faked, and it resolves the device list the way llama.rn does
 * (scriptHtpUnavailable = no HTP0 registered), so the backend shown is emergent from the params we send.
 */
import { setupChatScreen } from '../../harness/chatHarness';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {},
  useIsFocused: () => true,
}));

type Harness = Awaited<ReturnType<typeof setupChatScreen>>;

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

async function npuPhone(): Promise<Harness> {
  return setupChatScreen({
    engine: 'llama',
    platform: 'android',
    deferInitialLoad: true,
    deviceHardware: 'qcom',
    socModel: 'SM8650', // Snapdragon 8 Gen 3: Hexagon NPU + Adreno GPU
    modelFileName: 'Qwen3.5-2B-Q4_K_M.gguf',
  });
}

/** Chat on the default CPU backend, tap NPU in the real BackendSelector, tap the reload banner, reply again. */
async function chooseNpuAndReply(h: Harness): Promise<void> {
  h.enableGenerationDetailsViaUI();
  h.render();
  await h.send('hello', { text: 'Hi there.' });
  await h.rtl.waitFor(() => { expect(h.view!.queryByText(/Hi there\./)).not.toBeNull(); });
  // BEFORE: loaded on the CPU backend the person chose by default — no fallback notice.
  expect(h.view!.queryByText(/running on CPU/i)).toBeNull();

  const { BackendSelector } = require('../../../src/components/settings/textGenAdvancedSections');
  const s = h.rtl.render(h.React.createElement(BackendSelector, {}));
  h.rtl.fireEvent.press(await h.rtl.waitFor(() => s.getByTestId('backend-htp-button')));
  s.unmount();
  await h.rtl.waitFor(() => { expect(h.view!.queryByTestId('reload-model-banner')).not.toBeNull(); });
  await h.rtl.act(async () => { pressByWalkingUp(h.view!.getByTestId('reload-model-banner')); });
  await h.rtl.waitFor(() => { expect(h.view!.queryByTestId('reload-model-banner')).toBeNull(); }, { timeout: 20000 });

  await h.send('again', { text: 'Second reply.' });
  await h.rtl.waitFor(() => { expect(h.view!.queryByText(/Second reply\./)).not.toBeNull(); });
  await h.rtl.waitFor(() => { expect(h.view!.queryByTestId('stop-button')).toBeNull(); });
}

async function backendShown(h: Harness) {
  await h.rtl.act(async () => { pressByWalkingUp(h.view!.getAllByTestId('generation-details-toggle').slice(-1)[0]); });
  return h.rtl.waitFor(() => h.view!.getAllByTestId('generation-meta').slice(-1)[0]);
}

describe('NPU selected, Hexagon session unavailable → the reply runs on CPU, never OpenCL', () => {
  it('runs the reply on the CPU and shows the CPU notice', async () => {
    const h = await npuPhone();
    h.boundary.llama!.scriptHtpUnavailable();
    await chooseNpuAndReply(h);

    const meta = await backendShown(h);
    expect(h.rtl.within(meta).queryByText('CPU')).not.toBeNull();
    expect(h.rtl.within(meta).queryByText(/OpenCL/)).toBeNull();
    expect(h.rtl.within(meta).queryByText(/\(\d+L\)/)).toBeNull();
    // The person asked for the NPU and got the CPU: the chat says so.
    await h.rtl.waitFor(() => { expect(h.view!.queryAllByText(/running on CPU/i).length).toBeGreaterThan(0); });
  }, 60000);

  it('falsify: with the Hexagon session open the reply runs on HTP0 and no notice shows', async () => {
    const h = await npuPhone();
    await chooseNpuAndReply(h);

    const meta = await backendShown(h);
    expect(h.rtl.within(meta).queryByText(/HTP0 \(\d+L\)/)).not.toBeNull();
    expect(h.rtl.within(meta).queryByText(/OpenCL/)).toBeNull();
    expect(h.view!.queryByText(/running on CPU/i)).toBeNull();
  }, 60000);
});
