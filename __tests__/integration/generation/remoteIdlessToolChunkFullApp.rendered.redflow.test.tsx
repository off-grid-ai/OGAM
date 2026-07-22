/**
 * G9 (docs/RELEASE_571_GAP_FINDINGS.md): processToolCallChunk (openAICompatibleStream.ts) only
 * CREATES a tool-call target when the delta carries an `id`. Some OpenAI-compatible servers stream
 * the first tool_calls chunk with `index` + `function.name` but DEFER the `id` to a later chunk. That
 * first chunk hits `if (!target) return` and is dropped — the tool name is lost, so the call never
 * executes and the user gets no result. The fix creates the target from `index` alone.
 */
import { Switch } from 'react-native';
import { renderMainApp, sendChatMessage } from '../../harness/appJourney';
import {
  installRemoteDiscoveryBoundary,
  openRemoteChatThroughApp,
} from '../../harness/fullAppRemoteJourney';
import { installRemoteStream } from '../../harness/remoteHarness';

const ANSWER = 'The remote model says 2 plus 2 is 4.';
// First tool_calls chunk: index + name, NO id. Second chunk: the id + the rest of the arguments.
const TOOL_CALLS_SSE =
  'data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n' +
  'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"calculator","arguments":"{\\"expression\\":\\"2"}}]}}]}\n\n' +
  'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"calc-0","function":{"arguments":"+2\\"}"}}]}}]}\n\n' +
  'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n' +
  'data: [DONE]\n\n';
const ANSWER_SSE =
  `data: {"choices":[{"delta":{"content":"${ANSWER}"}}]}\n\n` +
  'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n' +
  'data: [DONE]\n\n';

const originalFetch = globalThis.fetch;
const originalXMLHttpRequest = globalThis.XMLHttpRequest;

afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.XMLHttpRequest = originalXMLHttpRequest;
});

describe('G9 remote tool call with an id-less first chunk', () => {
  it('executes the tool and renders its result when the id arrives after the name', async () => {
    installRemoteDiscoveryBoundary();
    const { rtl, view } = await renderMainApp();
    await openRemoteChatThroughApp(rtl, view);

    rtl.fireEvent.press(view.getByTestId('quick-settings-button'));
    const tools = await rtl.waitFor(() => view.getByTestId('quick-tools'));
    await rtl.waitFor(
      () => expect(rtl.within(tools).queryByText('N/A')).toBeNull(),
      { timeout: 8000 },
    );
    rtl.fireEvent.press(tools);
    const calculator = await rtl.waitFor(() =>
      view.getByTestId('tool-picker-row-calculator'),
    );
    rtl.fireEvent(
      rtl.within(calculator).UNSAFE_getByType(Switch),
      'valueChange',
      true,
    );
    await rtl.waitFor(() =>
      expect(rtl.within(calculator).UNSAFE_getByType(Switch).props.value).toBe(
        true,
      ),
    );
    rtl.fireEvent.press(view.getByTestId('tools-back-button'));
    await rtl.waitFor(() =>
      expect(view.getByTestId('chat-screen')).toBeTruthy(),
    );

    installRemoteStream([TOOL_CALLS_SSE, ANSWER_SSE]);
    sendChatMessage(rtl, view, 'What is 2 plus 2?');

    await rtl.waitFor(
      () => {
        const results = view.getAllByTestId('tool-result-label-calculator');
        expect(results).toHaveLength(1);
        expect(results[0]).toHaveTextContent(/2\+2 = 4/);
        expect(view.getAllByText(ANSWER)).toHaveLength(1);
      },
      { timeout: 8000 },
    );

    view.unmount();
  }, 30000);
});
