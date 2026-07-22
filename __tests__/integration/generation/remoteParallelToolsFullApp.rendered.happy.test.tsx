/** P1 #143 — one remote turn can stream and execute parallel tool calls in the real App. */
import { Switch, Text } from 'react-native';
import { renderMainApp, sendChatMessage } from '../../harness/appJourney';
import {
  installRemoteDiscoveryBoundary,
  openRemoteChatThroughApp,
} from '../../harness/fullAppRemoteJourney';
import { installRemoteStream } from '../../harness/remoteHarness';

const FIRST_RESULT = '500*321 = 160500';
const SECOND_RESULT = '12+13 = 25';
const ANSWER = 'The remote model confirms the results are 160500 and 25.';
const TOOL_CALLS_SSE =
  'data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n' +
  'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"calc-0","function":{"name":"calculator","arguments":"{\\"expression\\":\\"500"}},{"index":1,"id":"calc-1","function":{"name":"calculator","arguments":"{\\"expression\\":\\"12"}}]}}]}\n\n' +
  'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"*321\\"}"}},{"index":1,"function":{"arguments":"+13\\"}"}}]}}]}\n\n' +
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

function textContent(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number')
    return String(value);
  if (Array.isArray(value)) return value.map(textContent).join('');
  if (value && typeof value === 'object' && 'props' in value) {
    return textContent(
      (value as { props?: { children?: unknown } }).props?.children,
    );
  }
  return '';
}

describe('P1 full-App remote parallel tool journey', () => {
  it('renders two indexed results before one clean remote answer', async () => {
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
    const calculatorToggle = rtl.within(calculator).UNSAFE_getByType(Switch);
    expect(calculatorToggle.props.value).toBe(false);
    rtl.fireEvent(calculatorToggle, 'valueChange', true);
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
    sendChatMessage(rtl, view, 'Calculate 500 times 321 and 12 plus 13.');

    await rtl.waitFor(
      () => {
        const results = view.getAllByTestId('tool-result-label-calculator');
        expect(results).toHaveLength(2);
        expect(results[0]).toHaveTextContent(/500\*321 = 160500/);
        expect(results[1]).toHaveTextContent(/12\+13 = 25/);
        expect(view.getAllByText(ANSWER)).toHaveLength(1);
        expect(view.getAllByTestId('tool-call-message')).toHaveLength(1);
        expect(
          view.queryByText(/data:|tool_calls|\[DONE\]|choices/),
        ).toBeNull();
        expect(view.getByTestId('chat-input').props.value).toBe('');
        expect(view.queryByTestId('stop-button')).toBeNull();
        expect(view.queryByTestId('send-button')).toBeNull();
        expect(view.queryByTestId('queue-indicator')).toBeNull();
      },
      { timeout: 8000 },
    );

    const renderedText = rtl
      .within(view.getByTestId('chat-screen'))
      .UNSAFE_getAllByType(Text)
      .map(node => textContent(node.props.children));
    const firstResultIndex = renderedText.findIndex(text =>
      text.includes(FIRST_RESULT),
    );
    const secondResultIndex = renderedText.findIndex(text =>
      text.includes(SECOND_RESULT),
    );
    const answerIndex = renderedText.findIndex(text => text === ANSWER);
    expect(firstResultIndex).toBeGreaterThanOrEqual(0);
    expect(secondResultIndex).toBeGreaterThan(firstResultIndex);
    expect(answerIndex).toBeGreaterThan(secondResultIndex);

    view.unmount();
  }, 30000);
});
