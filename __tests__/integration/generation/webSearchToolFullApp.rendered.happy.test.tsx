/** P2 #126 — Web Search executes against the remote HTTP boundary in a full-App chat. */
import { Switch, Text } from 'react-native';
import type { DownloadedModel } from '../../../src/types';
import {
  openChatWithJourneyModel,
  renderMainApp,
  sendChatMessage,
} from '../../harness/appJourney';

const PROMPT = 'Search the web for how on-device AI protects privacy.';
const ANSWER =
  'The results confirm that on-device AI can run privately and offline.';
const FIRST_TITLE = 'Off Grid Device AI Guide';
const FIRST_SNIPPET =
  'Runs private AI directly on a phone without sending prompts to a server.';
const SECOND_TITLE = 'Mobile Privacy Research';
const SECOND_SNIPPET =
  'On-device processing can keep sensitive user data local and available offline.';
const SEARCH_HTML = [
  '<html><body>',
  '<div class="result-wrapper">',
  '<a class="result-title" href="https://docs.offgrid.example/device-ai">',
  `${FIRST_TITLE}</a>`,
  `<p class="snippet">${FIRST_SNIPPET}</p>`,
  '</div>',
  '<div class="result-wrapper">',
  '<a class="result-title" href="https://research.example/mobile-privacy">',
  `${SECOND_TITLE}</a>`,
  `<p class="snippet">${SECOND_SNIPPET}</p>`,
  '</div>',
  '</body></html>',
].join('');
const TOOL_MODEL: DownloadedModel = {
  id: 'test/llama-3-web-search/llama-3-web-search-Q4_K_M.gguf',
  name: 'Llama 3 Web Search',
  author: 'test',
  fileName: 'llama-3-web-search-Q4_K_M.gguf',
  filePath: '/docs/models/llama-3-web-search-Q4_K_M.gguf',
  fileSize: 128 * 1024 * 1024,
  quantization: 'Q4_K_M',
  downloadedAt: '2026-07-17T00:00:00.000Z',
  engine: 'llama',
};

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
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

describe('P2 full-App Web Search tool journey', () => {
  it('renders linked remote results before one clean final answer', async () => {
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
    const webSearch = await rtl.waitFor(() =>
      view.getByTestId('tool-picker-row-web_search'),
    );
    const webSearchToggle = rtl.within(webSearch).UNSAFE_getByType(Switch);
    expect(webSearchToggle.props.value).toBe(true);
    rtl.fireEvent(webSearchToggle, 'valueChange', false);
    await rtl.waitFor(() =>
      expect(rtl.within(webSearch).UNSAFE_getByType(Switch).props.value).toBe(
        false,
      ),
    );
    const disabledWebSearchToggle = rtl
      .within(webSearch)
      .UNSAFE_getByType(Switch);
    rtl.fireEvent(disabledWebSearchToggle, 'valueChange', true);
    await rtl.waitFor(() =>
      expect(rtl.within(webSearch).UNSAFE_getByType(Switch).props.value).toBe(
        true,
      ),
    );
    rtl.fireEvent.press(view.getByTestId('tools-back-button'));
    await rtl.waitFor(() =>
      expect(view.getByTestId('chat-screen')).toBeTruthy(),
    );

    globalThis.fetch = async () =>
      new Response(SEARCH_HTML, {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      });
    boundary.llama!.scriptCompletions([
      {
        toolCalls: [
          {
            name: 'web_search',
            arguments: { query: 'on-device AI privacy offline' },
          },
        ],
      },
      { text: ANSWER },
    ]);
    sendChatMessage(rtl, view, PROMPT);

    await rtl.waitFor(
      () => {
        expect(
          view.getAllByTestId('tool-result-label-web_search'),
        ).toHaveLength(1);
        expect(view.getAllByText(ANSWER)).toHaveLength(1);
      },
      { timeout: 8000 },
    );

    rtl.fireEvent.press(view.getByTestId('tool-result-label-web_search'));
    await rtl.waitFor(() => {
      expect(view.getByRole('link', { name: FIRST_TITLE })).toBeTruthy();
      expect(view.getByRole('link', { name: SECOND_TITLE })).toBeTruthy();
      expect(view.getByText(FIRST_SNIPPET)).toBeTruthy();
      expect(view.getByText(SECOND_SNIPPET)).toBeTruthy();
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
      text.includes(SECOND_SNIPPET),
    );
    const answerIndex = renderedText.findIndex(text => text === ANSWER);
    expect(toolResultIndex).toBeGreaterThanOrEqual(0);
    expect(answerIndex).toBeGreaterThan(toolResultIndex);

    view.unmount();
  }, 30000);
});
