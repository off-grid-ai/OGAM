/** P0 #180 — Gemma-style native reasoning, tool result, and answer render in order. */
import { Switch, Text } from 'react-native';
import type { DownloadedModel } from '../../../src/types';
import {
  openChatWithJourneyModel,
  renderMainApp,
  sendChatMessage,
} from '../../harness/appJourney';

const REASONING = 'I should use the calculator before answering.';
const SECOND_REASONING = 'Now I should explain the calculated result.';
const SECOND_REASONING_PREFIX = 'Now I should explain';
const TOOL_RESULT = '128*256 = 32768';
const ANSWER = 'The answer is 32768.';

function textContent(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number')
    return String(value);
  if (Array.isArray(value)) return value.map(textContent).join('');
  if (value && typeof value === 'object' && 'props' in value)
    return textContent(
      (value as { props?: { children?: unknown } }).props?.children,
    );
  return '';
}

describe('P0 full-App Gemma native thinking and tool journey', () => {
  it('renders thinking, the calculator result, and the clean answer in order', async () => {
    const gemma: DownloadedModel = {
      id: 'test/gemma-4/gemma-4-Q4_K_M.gguf',
      name: 'Gemma 4',
      author: 'test',
      fileName: 'gemma-4-Q4_K_M.gguf',
      filePath: '/docs/models/gemma-4-Q4_K_M.gguf',
      fileSize: 128 * 1024 * 1024,
      quantization: 'Q4_K_M',
      downloadedAt: '2026-07-17T00:00:00.000Z',
      engine: 'llama',
    };
    const { boundary, rtl, view } = await renderMainApp({
      boundary: { llama: true },
      downloadedModels: [gemma],
    });
    await openChatWithJourneyModel(rtl, view);

    rtl.fireEvent.press(view.getByTestId('quick-settings-button'));
    const tools = await rtl.waitFor(() => view.getByTestId('quick-tools'));
    rtl.fireEvent.press(tools);
    const calculator = await rtl.waitFor(() =>
      view.getByTestId('tool-picker-row-calculator'),
    );
    rtl.fireEvent(
      rtl.within(calculator).UNSAFE_getByType(Switch),
      'valueChange',
      true,
    );
    rtl.fireEvent.press(view.getByTestId('tools-back-button'));
    await rtl.waitFor(() =>
      expect(view.getByTestId('chat-screen')).toBeTruthy(),
    );

    rtl.fireEvent.press(view.getByTestId('quick-settings-button'));
    rtl.fireEvent.press(
      await rtl.waitFor(() => view.getByTestId('quick-thinking-toggle')),
    );

    boundary.llama!.scriptCompletions([
      {
        text: '<tool_call>{"name":"calculator","arguments":{"expression":"128*256"}}</tool_call>',
        reasoning: REASONING,
      },
      {
        text: ANSWER,
        reasoning: SECOND_REASONING,
        streamReasoning: `${REASONING}${SECOND_REASONING}`,
        pauseAfter: `${REASONING}${SECOND_REASONING_PREFIX}`,
      },
    ]);
    sendChatMessage(rtl, view, 'Think, then calculate 128 times 256');

    // Some native runtimes briefly replay the previous round at the start of
    // the next cumulative reasoning stream. The live second block must own only
    // round two; waiting for finalization to repair it still leaks stale text.
    const liveThinking = await rtl.waitFor(
      () => {
        const blocks = view.getAllByTestId('thinking-block-content');
        expect(blocks).toHaveLength(1);
        return blocks[0];
      },
      { timeout: 5000 },
    );
    const liveThinkingText = textContent(liveThinking.props.children);
    boundary.llama!.releaseStream();

    await rtl.waitFor(
      () => {
        expect(
          view.getAllByTestId('thinking-block-toggle').length,
        ).toBeGreaterThan(0);
        expect(view.getByTestId('tool-result-label-calculator')).toBeTruthy();
        expect(view.getByText(ANSWER)).toBeTruthy();
        expect(view.queryByText(/<\|channel/)).toBeNull();
        expect(view.queryByTestId('stop-button')).toBeNull();
      },
      { timeout: 8000 },
    );
    expect(liveThinkingText).toBe(SECOND_REASONING_PREFIX);

    const thinkingToggles = view.getAllByTestId('thinking-block-toggle');
    expect(thinkingToggles).toHaveLength(2);
    rtl.fireEvent.press(thinkingToggles[0]);
    rtl.fireEvent.press(thinkingToggles[1]);
    rtl.fireEvent.press(view.getByTestId('tool-result-label-calculator'));
    await rtl.waitFor(() => {
      expect(view.getAllByText(REASONING).length).toBeGreaterThan(0);
      expect(view.getAllByText(SECOND_REASONING).length).toBeGreaterThan(0);
      expect(view.queryByText(`${REASONING}${SECOND_REASONING}`)).toBeNull();
      expect(view.getByText(TOOL_RESULT)).toBeTruthy();
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
    const answerIndex = renderedText.findIndex(text => text.includes(ANSWER));
    expect(reasoningIndex).toBeGreaterThanOrEqual(0);
    expect(toolIndex).toBeGreaterThan(reasoningIndex);
    expect(answerIndex).toBeGreaterThan(toolIndex);
    view.unmount();
  }, 30000);
});
