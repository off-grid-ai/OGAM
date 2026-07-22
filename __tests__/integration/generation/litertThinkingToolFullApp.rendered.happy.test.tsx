/** P1 #182 — LiteRT preserves one clean reason → tool → answer transcript in the real App. */
import { Switch, Text } from 'react-native';
import type { DownloadedModel } from '../../../src/types';
import {
  openChatWithJourneyModel,
  renderMainApp,
  sendChatMessage,
} from '../../harness/appJourney';

const REASONING = 'I should multiply 128 by 256 with the calculator.';
const TOOL_RESULT = '128*256 = 32768';
const ANSWER = 'The answer is 32768.';
const LITERT_MODEL: DownloadedModel = {
  id: 'test/gemma-litert-tools/gemma-litert-tools.litertlm',
  name: 'Gemma LiteRT Tools',
  author: 'test',
  fileName: 'gemma-litert-tools.litertlm',
  filePath: '/docs/models/gemma-litert-tools.litertlm',
  fileSize: 128 * 1024 * 1024,
  quantization: 'LiteRT',
  downloadedAt: '2026-07-17T00:00:00.000Z',
  engine: 'litert',
  liteRTVision: false,
};

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

describe('P1 full-App LiteRT thinking and tool journey', () => {
  it('renders one reasoning block, real result, and clean answer in order', async () => {
    const { boundary, rtl, view } = await renderMainApp({
      downloadedModels: [LITERT_MODEL],
    });
    await openChatWithJourneyModel(rtl, view);

    // LiteRT exposes its native Tools/Thinking capabilities after the selected
    // model is resident. Reach that state through the real first-send lazy load.
    boundary.litert.scriptTurn({ content: 'Ready for the next request.' });
    sendChatMessage(rtl, view, 'Reply when ready.');
    await rtl.waitFor(
      () => {
        expect(view.getByText('Ready for the next request.')).toBeTruthy();
        expect(view.queryByTestId('stop-button')).toBeNull();
      },
      { timeout: 8000 },
    );

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

    boundary.litert.scriptTurn({
      reasoning: REASONING,
      toolCalls: [{ name: 'calculator', arguments: { expression: '128*256' } }],
      content: `<think></think>${ANSWER}`,
    });
    sendChatMessage(rtl, view, 'Think, then calculate 128 times 256.');

    await rtl.waitFor(
      () => {
        expect(view.getAllByTestId('thinking-block-toggle')).toHaveLength(1);
        expect(
          view.getAllByTestId('tool-result-label-calculator'),
        ).toHaveLength(1);
        expect(
          view.getByTestId('tool-result-label-calculator'),
        ).toHaveTextContent(TOOL_RESULT);
        expect(view.getAllByText(ANSWER)).toHaveLength(1);
        expect(
          view.queryByText(/<\/?think>|<\|channel>|<tool_call>|tool_calls/i),
        ).toBeNull();
        expect(view.getByTestId('chat-input').props.value).toBe('');
        expect(view.queryByTestId('stop-button')).toBeNull();
        expect(view.queryByTestId('send-button')).toBeNull();
        expect(view.queryByTestId('queue-indicator')).toBeNull();
      },
      { timeout: 8000 },
    );

    rtl.fireEvent.press(view.getByTestId('thinking-block-toggle'));
    await rtl.waitFor(() =>
      expect(view.getByTestId('thinking-block-content')).toHaveTextContent(
        REASONING,
      ),
    );

    const renderedText = rtl
      .within(view.getByTestId('chat-screen'))
      .UNSAFE_getAllByType(Text)
      .map(node => textContent(node.props.children));
    expect(view.getAllByText(REASONING)).toHaveLength(1);
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
