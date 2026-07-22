/** P1 #183 — remote reasoning, tool result, and answer survive one parse-once App journey. */
import { Switch, Text } from 'react-native';
import { renderMainApp, sendChatMessage } from '../../harness/appJourney';
import {
  installRemoteDiscoveryBoundary,
  openRemoteChatThroughApp,
} from '../../harness/fullAppRemoteJourney';
import { installRemoteStream } from '../../harness/remoteHarness';

const REASONING = 'I should multiply 128 by 256 with the calculator.';
const TOOL_RESULT = '128*256 = 32768';
const ANSWER = 'The remote answer is 32768.';
const TOOL_TURN_SSE =
  'data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n' +
  'data: {"choices":[{"delta":{"reasoning_content":"I should multiply 128"}}]}\n\n' +
  'data: {"choices":[{"delta":{"reasoning_content":" by 256 with the calculator."}}]}\n\n' +
  'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"calc-remote","type":"function","function":{"name":"calculator","arguments":"{\\"expression\\":\\"128"}}]}}]}\n\n' +
  'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"*256\\"}"}}]}}]}\n\n' +
  'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n' +
  'data: [DONE]\n\n';
const ANSWER_TURN_SSE =
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

describe('P1 full-App remote thinking and tool journey', () => {
  it('renders one reasoning block, real result, and clean answer in order', async () => {
    installRemoteDiscoveryBoundary({
      supportsThinking: true,
      supportsToolCalling: true,
    });
    const { rtl, view } = await renderMainApp();
    await openRemoteChatThroughApp(rtl, view);

    rtl.fireEvent.press(view.getByTestId('quick-settings-button'));
    const thinking = await rtl.waitFor(() =>
      view.getByTestId('quick-thinking-toggle'),
    );
    expect(rtl.within(thinking).getByText('OFF')).toBeTruthy();
    rtl.fireEvent.press(thinking);
    await rtl.waitFor(() =>
      expect(
        rtl.within(view.getByTestId('quick-thinking-toggle')).getByText('ON'),
      ).toBeTruthy(),
    );

    const tools = view.getByTestId('quick-tools');
    expect(rtl.within(tools).queryByText('N/A')).toBeNull();
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

    installRemoteStream([TOOL_TURN_SSE, ANSWER_TURN_SSE]);
    sendChatMessage(rtl, view, 'Think, then calculate 128 times 256.');

    await rtl.waitFor(
      () => {
        expect(view.getAllByTestId('thinking-block-toggle')).toHaveLength(1);
        expect(view.getAllByTestId('tool-call-message')).toHaveLength(1);
        expect(
          view.getAllByTestId('tool-result-label-calculator'),
        ).toHaveLength(1);
        expect(
          view.getByTestId('tool-result-label-calculator'),
        ).toHaveTextContent(/128\*256 = 32768/);
        expect(view.getAllByText(ANSWER)).toHaveLength(1);
        expect(
          view.queryByText(
            /reasoning_content|tool_calls|finish_reason|data:|\[DONE\]|choices/,
          ),
        ).toBeNull();
        expect(view.getByTestId('chat-input').props.value).toBe('');
        expect(view.queryByTestId('stop-button')).toBeNull();
        expect(view.queryByTestId('send-button')).toBeNull();
        expect(view.queryByTestId('queue-indicator')).toBeNull();
      },
      { timeout: 8000 },
    );

    rtl.fireEvent.press(view.getByTestId('thinking-block-toggle'));
    await rtl.waitFor(() => {
      expect(view.getAllByText(REASONING)).toHaveLength(1);
      expect(view.getByTestId('thinking-block-content')).toHaveTextContent(
        REASONING,
      );
    });

    const renderedText = rtl
      .within(view.getByTestId('chat-screen'))
      .UNSAFE_getAllByType(Text)
      .map(node => textContent(node.props.children));
    const reasoningIndex = renderedText.findIndex(text =>
      text.includes(REASONING),
    );
    const toolIndex = renderedText.findIndex(text =>
      text.includes(TOOL_RESULT),
    );
    const answerIndex = renderedText.findIndex(text => text === ANSWER);
    expect(reasoningIndex).toBeGreaterThanOrEqual(0);
    expect(toolIndex).toBeGreaterThan(reasoningIndex);
    expect(answerIndex).toBeGreaterThan(toolIndex);

    view.unmount();
  }, 30000);
});
