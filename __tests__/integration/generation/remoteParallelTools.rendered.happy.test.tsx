/**
 * T048 (checklist Area 6, full-UI upgrade) — a remote OpenAI-compat model (LM Studio) that emits PARALLEL
 * tool_calls has them accumulated by index, executed by the real tool loop, and rendered as tool-result
 * bubbles, then its final reply renders.
 *
 * Device-grounded (DEVICE_TEST_FINDINGS + wire-captures/lmstudio-raw-curl-proof part8): LM Studio streamed
 * `tool_calls index:0 calculator "47 * 83"; index:1 "128 * 256"; index:2 "0.30 * 400"`, finish_reason=tool_calls,
 * toolCalls=3 (parallel) → [ToolLoop] executed → finish_reason=stop. The prior coverage
 * (remoteProviderRouting) mocks the store at the service level; this drives the FULL ChatScreen with a real
 * send over the captured SSE at the XHR boundary.
 *
 * Real transport: the captured LM Studio SSE is replayed at the XMLHttpRequest boundary (a 2-request queue:
 * the tool_calls turn, then the final reply after the tool results). The REAL provider, processDelta
 * (accumulate-by-index), tool loop, real calculator, and chat render run on top.
 *
 * Falsify: replace the 3 tool_calls with 1 → only one bubble → the "three bubbles" assertion goes red.
 */
import { setupChatScreen } from '../../harness/chatHarness';
import { installRemoteModel, installRemoteStream } from '../../harness/remoteHarness';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {}, useIsFocused: () => true,
}));

// Request 1: the parallel tool_calls (index 0/1/2), then finish_reason=tool_calls (the captured shape).
const TOOL_CALLS_SSE =
  'data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n' +
  'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c0","function":{"name":"calculator","arguments":"{\\"expression\\":\\"47*83\\"}"}}]}}]}\n\n' +
  'data: {"choices":[{"delta":{"tool_calls":[{"index":1,"id":"c1","function":{"name":"calculator","arguments":"{\\"expression\\":\\"128*256\\"}"}}]}}]}\n\n' +
  'data: {"choices":[{"delta":{"tool_calls":[{"index":2,"id":"c2","function":{"name":"calculator","arguments":"{\\"expression\\":\\"0.3*400\\"}"}}]}}]}\n\n' +
  'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n' +
  'data: [DONE]\n\n';
// Request 2 (sent WITH the tool results): the final reply, finish_reason=stop.
const REPLY_SSE =
  'data: {"choices":[{"delta":{"content":"Results: 3901, 32768, and 120."}}]}\n\n' +
  'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n' +
  'data: [DONE]\n\n';

describe('T048 (rendered) — remote parallel tool_calls render as bubbles + final reply', () => {
  it('accumulates 3 parallel calculator calls, runs them, renders 3 tool bubbles and the reply', async () => {
    const h = await setupChatScreen({ engine: 'llama', platform: 'android' });
    // LM Studio advertises tool-calling (the capture shows [ToolLoop] executed) → the app sends the tools.
    await installRemoteModel({ name: 'LM Studio', caps: { supportsThinking: false, supportsToolCalling: true } });
    installRemoteStream([TOOL_CALLS_SSE, REPLY_SSE]); // multi-turn queue
    h.render();
    h.enableToolViaUI('calculator'); // real Tools-screen switch (after the remote model is active)

    await h.tapSend('compute 47*83, 128*256, and 0.3*400');

    // The three parallel calculator calls each render a tool-result bubble (accumulate-by-index worked).
    await h.rtl.waitFor(() => { expect(h.view!.queryAllByTestId('tool-result-label-calculator').length).toBe(3); }, { timeout: 6000 });
    // ...and the remote model's final reply renders.
    await h.rtl.waitFor(() => { expect(h.view!.queryByText(/Results: 3901, 32768, and 120/)).not.toBeNull(); }, { timeout: 6000 });
  });
});
