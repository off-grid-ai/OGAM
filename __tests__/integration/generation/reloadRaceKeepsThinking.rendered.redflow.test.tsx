/**
 * RED-FLOW (UI integration, HEAVY entry point) — a send that lands DURING a settings reload must still
 * honor the model's thinking capability. Device ground truth (offgrid-debug.log 2026-07-13, gemma-4-E2B):
 *   18:50:26.905  GPU init succeeded            → llm.ts publishes this.context (isModelLoaded() = true)
 *   18:50:27.149  mmproj/multimodal phase starts (944.5 MB — seconds long on device)
 *   18:50:27.733  user sends "Hi"               → [GEN-SM] ensureModelReady → already loaded
 *   18:50:28.117  [LLM][THINKING] thinkingSupported=false, thinkingEnabled=true, enable_thinking=false
 *   18:50:30.409  [LLM] Model loaded, vision: false, tools: true, thinking: true   ← detection ran TOO LATE
 * The load pipeline detected thinking correctly — but readiness said "loaded" ~3.5s early, so the racing
 * turn generated with STALE capabilities: no thinking block, wrong reasoning_format. The same window also
 * drops tool support and vision for that turn.
 *
 * SPEC (product view): after the user changes the backend and reloads, the next reply behaves exactly like
 * every other reply from this model — reasoning renders in the thinking block. When the user manages to
 * send while the reload is still finishing, the turn WAITS for readiness; it never silently downgrades.
 *
 * Real ChatScreen + real BackendSelector + real reload banner + real llmService/generation pipeline; fakes
 * only at the llama.rn boundary. The fake emits its reasoning output ONLY when the request carries
 * enable_thinking=true — so the thinking block is EMERGENT from the app's own capability handling.
 * The load window is opened deterministically by holding the post-init multimodal probe
 * (scriptMultimodalHold), the exact phase the device log shows the send racing into.
 *
 * RED on HEAD: the racing turn renders the answer WITHOUT the thinking block (stale thinkingSupported).
 * Falsifier inside: the PRE-reload turn (same model, same settings) DOES render the block — proving the
 * capability was live before the reload, so its absence after is the regression, not a never-worked.
 */
import { setupChatScreen } from '../../harness/chatHarness';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {}, useIsFocused: () => true,
}));

/** Invoke the onPress bound to a testID host node's nearest pressable ancestor (AnimatedPressable's
 *  onPress lives on the composite above the host — same helper as the sibling reload-banner tests). */
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

/** Arrive-via-UI: change the text inference backend on the real BackendSelector (Model Settings control). */
function selectBackendViaUI(h: Awaited<ReturnType<typeof setupChatScreen>>, backendId: string) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { BackendSelector } = require('../../../src/components/settings/textGenAdvancedSections');
  const s = h.rtl.render(h.React.createElement(BackendSelector, {}));
  h.rtl.fireEvent.press(s.getByTestId(`backend-${backendId}-button`));
  s.unmount();
}

const REASON_BEFORE = 'Pre-reload reasoning: six sevens are forty-two.';
const REASON_AFTER = 'Post-reload reasoning: seventeen has no divisors below its root.';

describe('reload race — a send during the load window keeps thinking (device 2026-07-13 18:50)', () => {
  it('renders the thinking block for a turn sent while the reload is still detecting capabilities', async () => {
    const h = await setupChatScreen({ engine: 'llama', platform: 'android' });
    // Device boundary: an Adreno (Qualcomm) SoC so the OpenCL backend choice is allowed (as on device).
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const DeviceInfo = require('react-native-device-info');
    (DeviceInfo.getHardware as jest.Mock).mockResolvedValue('qcom');
    h.render();

    // GESTURE: turn Thinking ON the way the user does — quick settings → the Thinking row.
    h.rtl.fireEvent.press(await h.rtl.waitFor(() => h.view!.getByTestId('quick-settings-button')));
    h.rtl.fireEvent.press(await h.rtl.waitFor(() => h.view!.getByTestId('quick-thinking-toggle')));

    // PRE-CONDITION (falsifier guard): before any reload, a thinking turn renders its block — the
    // capability is live, so its absence after the reload cannot be a never-worked.
    await h.send('what is 6 times 7', {
      text: 'The answer is 42.',
      thinkingText: `<think>${REASON_BEFORE}</think>The answer is 42.`,
    });
    await h.rtl.waitFor(() => { expect(h.view!.queryByText(/The answer is 42/)).not.toBeNull(); }, { timeout: 4000 });
    expect(h.view!.queryByText(new RegExp('six sevens are forty-two'))).not.toBeNull();

    // GESTURE: pick GPU/OpenCL → the settings-changed reload banner appears.
    selectBackendViaUI(h, 'opencl');
    await h.rtl.waitFor(() => { expect(h.view!.queryByTestId('reload-model-banner')).not.toBeNull(); });

    // Open the device-shaped load window: the reload's post-init capability phase is held, exactly the
    // window the device send raced into. Script the NEXT turn before the send.
    h.boundary.llama!.scriptMultimodalHold();
    h.boundary.llama!.scriptCompletion({
      text: 'Yes, 17 is prime.',
      thinkingText: `<think>${REASON_AFTER}</think>Yes, 17 is prime.`,
    });

    // GESTURE: tap the reload banner. The reload parks inside the capability window (hold engaged).
    await h.rtl.act(async () => { pressByWalkingUp(h.view!.getByTestId('reload-model-banner')); });
    await h.rtl.waitFor(() => { expect(h.boundary.llama!.multimodalHoldActive()).toBe(true); }, { timeout: 4000 });

    // GESTURE: the user sends while the reload is still finishing (device: 18:50:27.733).
    await h.tapSend('is 17 prime');
    // The device finishes its capability phase; the window closes.
    await h.rtl.act(async () => { h.boundary.llama!.releaseMultimodalHold(); });

    // The reply renders...
    await h.rtl.waitFor(() => { expect(h.view!.queryByText(/Yes, 17 is prime/)).not.toBeNull(); }, { timeout: 4000 });
    // ...WITH its reasoning — the racing turn must not silently lose thinking.
    // RED on HEAD: the turn ran with stale thinkingSupported=false → enable_thinking=false → the model
    // never reasoned → this text is nowhere on screen and the second turn has NO thinking block.
    expect(h.view!.queryByText(/seventeen has no divisors below its root/)).not.toBeNull();
    // BOTH turns carry the thinking affordance (the block collapses to its preview after completion).
    const blocks = h.view!.queryAllByTestId('thinking-block');
    expect(blocks.length).toBe(2);
    // Expand the racing turn's block: the full reasoning renders in the block content.
    // (walking-up press: the toggle's onPress lives on the composite above the testID host)
    const toggles = h.view!.queryAllByTestId('thinking-block-toggle');
    await h.rtl.act(async () => { pressByWalkingUp(toggles[toggles.length - 1]); });
    await h.rtl.waitFor(() => {
      const content = h.view!.queryAllByTestId('thinking-block-content');
      expect(content.some(c => h.rtl.within(c).queryByText(/seventeen has no divisors below its root/) != null)).toBe(true);
    });
  }, 30000);
});
