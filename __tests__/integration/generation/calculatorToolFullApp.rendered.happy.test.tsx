/** P1 #123 — a text-chat calculator request completes the real full-App tool loop. */
import { Switch, Text } from 'react-native';
import type { DownloadedModel } from '../../../src/types';
import {
  openChatWithJourneyModel,
  renderMainApp,
  sendChatMessage,
} from '../../harness/appJourney';

const PROMPT = 'Use the calculator for 500 times 321';
const TOOL_RESULT = '500*321 = 160500';
const ANSWER = 'The answer is 160500.';
const TOOL_MODEL: DownloadedModel = {
  id: 'test/llama-3-tools/llama-3-tools-Q4_K_M.gguf',
  name: 'Llama 3 Tools',
  author: 'test',
  fileName: 'llama-3-tools-Q4_K_M.gguf',
  filePath: '/docs/models/llama-3-tools-Q4_K_M.gguf',
  fileSize: 128 * 1024 * 1024,
  quantization: 'Q4_K_M',
  downloadedAt: '2026-07-17T00:00:00.000Z',
  engine: 'llama',
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

describe('P1 full-App Calculator tool journey', () => {
  it('executes one calculator call and renders its result before one clean answer', async () => {
    const { boundary, rtl, view } = await renderMainApp({
      boundary: { llama: true },
      downloadedModels: [TOOL_MODEL],
    });
    await openChatWithJourneyModel(rtl, view);

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

    boundary.llama!.scriptCompletions([
      {
        toolCalls: [
          {
            name: 'calculator',
            arguments: { expression: '500*321' },
          },
        ],
      },
      { text: ANSWER },
    ]);
    sendChatMessage(rtl, view, PROMPT);

    await rtl.waitFor(
      () => {
        const toolResults = view.getAllByTestId('tool-result-label-calculator');
        expect(toolResults).toHaveLength(1);
        expect(toolResults[0]).toHaveTextContent(/500\*321 = 160500/);
        expect(view.getAllByText(ANSWER)).toHaveLength(1);
        expect(view.queryByText(/<tool_call>|tool_calls/)).toBeNull();
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
    const toolResultIndex = renderedText.findIndex(text =>
      text.includes(TOOL_RESULT),
    );
    const answerIndex = renderedText.findIndex(text => text === ANSWER);
    expect(toolResultIndex).toBeGreaterThanOrEqual(0);
    expect(answerIndex).toBeGreaterThan(toolResultIndex);

    view.unmount();
  }, 30000);
});
