/** P2 #124 — a text-chat datetime request completes the real full-App tool loop. */
import { Switch, Text } from 'react-native';
import type { DownloadedModel } from '../../../src/types';
import {
  openChatWithJourneyModel,
  renderMainApp,
  sendChatMessage,
} from '../../harness/appJourney';

const PROMPT = 'What is the current date and time in UTC?';
const ANSWER = 'I retrieved the current date and time in UTC.';
const TOOL_MODEL: DownloadedModel = {
  id: 'test/llama-3-datetime/llama-3-datetime-Q4_K_M.gguf',
  name: 'Llama 3 Date & Time',
  author: 'test',
  fileName: 'llama-3-datetime-Q4_K_M.gguf',
  filePath: '/docs/models/llama-3-datetime-Q4_K_M.gguf',
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

describe('P2 full-App Date & Time tool journey', () => {
  it('executes one datetime call and renders its UTC result before one clean answer', async () => {
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
    const datetime = await rtl.waitFor(() =>
      view.getByTestId('tool-picker-row-get_current_datetime'),
    );
    const datetimeToggle = rtl.within(datetime).UNSAFE_getByType(Switch);
    expect(datetimeToggle.props.value).toBe(false);
    rtl.fireEvent(datetimeToggle, 'valueChange', true);
    await rtl.waitFor(() =>
      expect(rtl.within(datetime).UNSAFE_getByType(Switch).props.value).toBe(
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
            name: 'get_current_datetime',
            arguments: { timezone: 'UTC' },
          },
        ],
      },
      { text: ANSWER },
    ]);
    sendChatMessage(rtl, view, PROMPT);

    await rtl.waitFor(
      () => {
        expect(
          view.getAllByTestId('tool-result-label-get_current_datetime'),
        ).toHaveLength(1);
        expect(view.getAllByText(ANSWER)).toHaveLength(1);
      },
      { timeout: 8000 },
    );

    rtl.fireEvent.press(
      view.getByTestId('tool-result-label-get_current_datetime'),
    );
    await rtl.waitFor(() => {
      expect(
        view.getByText(/Current date and time:.*Coordinated Universal Time/),
      ).toBeTruthy();
      expect(
        view.getByText(/ISO 8601: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/),
      ).toBeTruthy();
      expect(view.getByText(/Unix timestamp: \d{10}/)).toBeTruthy();
      expect(view.getAllByTestId('tool-call-message')).toHaveLength(1);
      expect(view.queryByText(/<tool_call>|tool_calls/)).toBeNull();
      expect(view.getByTestId('chat-input').props.value).toBe('');
      expect(view.queryByTestId('stop-button')).toBeNull();
      expect(view.queryByTestId('send-button')).toBeNull();
      expect(view.queryByTestId('queue-indicator')).toBeNull();
    });

    const renderedText = rtl
      .within(view.getByTestId('chat-screen'))
      .UNSAFE_getAllByType(Text)
      .map(node => textContent(node.props.children));
    const toolResultIndex = renderedText.findIndex(text =>
      text.includes('Current date and time:'),
    );
    const answerIndex = renderedText.findIndex(text => text === ANSWER);
    expect(toolResultIndex).toBeGreaterThanOrEqual(0);
    expect(answerIndex).toBeGreaterThan(toolResultIndex);

    view.unmount();
  }, 30000);
});
