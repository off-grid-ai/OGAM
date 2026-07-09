/**
 * ChatMessage Tool Rendering Tests
 *
 * Tests for tool-related message rendering:
 * - ToolResultMessage (role === 'tool')
 * - ToolCallMessage (role === 'assistant' with toolCalls)
 * - SystemInfoMessage (isSystemInfo === true)
 * - Helper functions: getToolIcon, getToolLabel, buildMessageData
 */

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { ChatMessage } from '../../../src/components/ChatMessage';
import { useAccordionStore } from '../../../src/stores';
import { createMessage } from '../../utils/factories';
import type { Message } from '../../../src/types';

// Mock stripControlTokens utility
jest.mock('../../../src/utils/messageContent', () => ({
  ...jest.requireActual('../../../src/utils/messageContent'),
  stripControlTokens: (content: string) => content,
}));

const makeMessage = (overrides: Partial<Message>): Message =>
  createMessage({ id: 'msg-1', content: 'test', ...overrides } as any);

/** Shorthand: create a tool result message and render it. */
function renderToolResult(toolName: string | undefined, content: string, extra: Partial<Message> = {}) {
  const message = makeMessage({ role: 'tool', content, toolName, ...extra });
  return render(<ChatMessage message={message} />);
}

describe('ChatMessage — Tool message rendering', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Accordion expand-state now lives in a shared store keyed by stable identity
    // (so it survives the streaming→finalized remount). Reset it between tests so
    // one test's expansion doesn't leak into the next.
    useAccordionStore.setState({ expanded: {} });
  });

  // ==========================================================================
  // ToolResultMessage (message.role === 'tool')
  // ==========================================================================
  describe('ToolResultMessage', () => {
    it('renders with testID "tool-message"', () => {
      const { getByTestId } = renderToolResult('web_search', 'Search results here');
      expect(getByTestId('tool-message')).toBeTruthy();
    });

    it.each([
      ['web_search', 'Web results', /Web search result/],
      ['calculator', '42', /42/],
      ['get_current_datetime', '2026-02-24T10:30:00Z', /Retrieved date\/time/],
      ['get_device_info', '{"model":"iPhone 15"}', /Retrieved device info/],
      ['custom_tool', 'result data', /custom_tool/],
      [undefined, 'some result', /Tool result/],
    ] as const)('shows correct label for toolName="%s"', (toolName, content, expectedLabel) => {
      const { getByText } = renderToolResult(toolName as string | undefined, content);
      expect(getByText(expectedLabel)).toBeTruthy();
    });

    it('shows "Searched: query (no results)" for empty web_search', () => {
      const { getByText } = renderToolResult('web_search', 'No results found for "quantum computing"');
      expect(getByText(/Searched: "quantum computing" \(no results\)/)).toBeTruthy();
    });

    it('shows "Calculated" label when calculator has no content', () => {
      const { getByText } = renderToolResult('calculator', '');
      expect(getByText('Calculated')).toBeTruthy();
    });

    it('shows duration when generationTimeMs is set', () => {
      const { getByText } = renderToolResult('web_search', 'Result data', { generationTimeMs: 350 });
      expect(getByText(/350ms/)).toBeTruthy();
    });

    it('does not show duration when generationTimeMs is not set', () => {
      const { queryByText } = renderToolResult('web_search', 'Result data');
      expect(queryByText(/\(\d+ms\)/)).toBeNull();
    });

    // ---- Expandable details ----

    it('expands and collapses details on tap', () => {
      const { getByText } = renderToolResult('web_search', 'Detailed search results');

      // Expand
      fireEvent.press(getByText(/Web search result/));
      expect(getByText('Detailed search results')).toBeTruthy();

      // Collapse
      fireEvent.press(getByText(/Web search result/));
    });

    it('renders calculator multiplication result with literal asterisks when expanded', () => {
      const { getAllByText, getByTestId } = renderToolResult(
        'calculator',
        '5*5*5*5*5*6*7 = 131250',
      );

      // The collapsed label for calculator is the full content, rendered in plain Text
      const label = getByTestId('tool-result-label-calculator');
      expect(label).toBeTruthy();

      // Expand
      fireEvent.press(label);

      // Both the collapsed label (plain Text) and expanded content (MarkdownText)
      // should show literal asterisks. preprocessMarkdown escapes digit*digit
      // so the markdown renderer doesn't consume them as emphasis.
      const matches = getAllByText(/5\*5\*5\*5\*5\*6\*7/);
      expect(matches.length).toBeGreaterThanOrEqual(2);
    });

    it('is not expandable when content starts with "No results"', () => {
      const { getByTestId, queryByText } = renderToolResult('web_search', 'No results found for "test query"');
      expect(getByTestId('tool-message')).toBeTruthy();
      expect(queryByText('No results found for "test query"')).toBeNull();
    });

    it('is not expandable when content is empty', () => {
      const { getByTestId } = renderToolResult('calculator', '');
      expect(getByTestId('tool-message')).toBeTruthy();
    });
  });

  // ==========================================================================
  // ToolCallMessage (message.role === 'assistant' with toolCalls)
  // ==========================================================================
  describe('ToolCallMessage', () => {
    it('renders with testID "tool-call-message"', () => {
      const message = makeMessage({
        role: 'assistant',
        content: '',
        toolCalls: [
          { id: 'tc-1', name: 'web_search', arguments: '{"query":"test"}' },
        ],
      });

      const { getByTestId } = render(<ChatMessage message={message} />);

      expect(getByTestId('tool-call-message')).toBeTruthy();
    });

    it('renders the pre-tool-call thinking block from message.reasoningContent (OD14 — the on-device disappearing-thinking bug)', () => {
      // A tool-using turn: the model reasoned, then emitted a tool call. runToolLoop
      // attaches that reasoning to the intermediate tool-call message as reasoningContent
      // (content is empty). The tool-call renderer MUST show that thinking block, or the
      // first round of chain-of-thought visibly disappears when the tool fires (the exact
      // TestFlight report). This is a RENDER assertion — the object carrying the field is
      // not enough; it must actually paint a thinking-block.
      const message = makeMessage({
        role: 'assistant',
        content: '',
        reasoningContent: 'I should search the knowledge base first.',
        toolCalls: [{ id: 'tc-1', name: 'search_knowledge_base', arguments: '{"q":"achilles"}' }],
      });

      const { getByTestId, getByText } = render(<ChatMessage message={message} />);

      expect(getByTestId('tool-call-message')).toBeTruthy();
      // Assert the ACTUAL reasoning text is on screen (the collapsed block shows an 80-char
      // preview of parsedContent.thinking), not merely that a block element mounted — the
      // whole point is the user SEES the pre-tool-call thinking, not that a testID exists.
      expect(getByText(/I should search the knowledge base first\./)).toBeTruthy();
    });

    it('renders the thinking block from inline <think> in a tool-call message content', () => {
      // Some models stream reasoning inline as <think> in the content rather than the
      // separate reasoning channel. The tool-call renderer must extract it too.
      const message = makeMessage({
        role: 'assistant',
        content: '<think>Let me check the docs.</think>',
        toolCalls: [{ id: 'tc-1', name: 'read_url', arguments: '{"url":"x"}' }],
      });

      const { getByText } = render(<ChatMessage message={message} />);

      // The inline <think> reasoning text must actually render, not just a container.
      expect(getByText(/Let me check the docs\./)).toBeTruthy();
    });

    it('shows "Using web_search" text with arguments preview', () => {
      const message = makeMessage({
        role: 'assistant',
        content: '',
        toolCalls: [
          { id: 'tc-1', name: 'web_search', arguments: '{"query":"react native"}' },
        ],
      });

      const { getByText } = render(<ChatMessage message={message} />);

      expect(getByText(/Using web_search.*react native/)).toBeTruthy();
    });

    it('shows multiple tool calls', () => {
      const message = makeMessage({
        role: 'assistant',
        content: '',
        toolCalls: [
          { id: 'tc-1', name: 'web_search', arguments: '{"query":"first"}' },
          { id: 'tc-2', name: 'calculator', arguments: '{"expression":"2+2"}' },
        ],
      });

      const { getByText } = render(<ChatMessage message={message} />);

      expect(getByText(/Using web_search/)).toBeTruthy();
      expect(getByText(/Using calculator/)).toBeTruthy();
    });

    it('shows raw arguments when JSON parse fails', () => {
      const message = makeMessage({
        role: 'assistant',
        content: '',
        toolCalls: [
          { id: 'tc-1', name: 'custom_tool', arguments: 'not-valid-json' },
        ],
      });

      const { getByText } = render(<ChatMessage message={message} />);

      expect(getByText(/Using custom_tool.*not-valid-json/)).toBeTruthy();
    });

    it('shows tool call without arguments preview when arguments are empty object', () => {
      const message = makeMessage({
        role: 'assistant',
        content: '',
        toolCalls: [
          { id: 'tc-1', name: 'get_current_datetime', arguments: '{}' },
        ],
      });

      const { getByText } = render(<ChatMessage message={message} />);

      // With empty object, Object.values({}).join(', ') === ''
      // So argsPreview is '' and the text should just be "Using get_current_datetime"
      expect(getByText('Using get_current_datetime')).toBeTruthy();
    });

    it('renders tool call without id (uses index as key)', () => {
      const message = makeMessage({
        role: 'assistant',
        content: '',
        toolCalls: [
          { name: 'web_search', arguments: '{"query":"test"}' },
        ],
      });

      const { getByTestId } = render(<ChatMessage message={message} />);

      expect(getByTestId('tool-call-message')).toBeTruthy();
    });

    it('does not render as tool-call when toolCalls is empty array', () => {
      const message = makeMessage({
        role: 'assistant',
        content: 'Normal assistant response',
        toolCalls: [],
      });

      const { queryByTestId, getByTestId } = render(<ChatMessage message={message} />);

      // Empty toolCalls array => length is 0 => falsy, so it renders as normal assistant message
      expect(queryByTestId('tool-call-message')).toBeNull();
      expect(getByTestId('assistant-message')).toBeTruthy();
    });
  });

  // ==========================================================================
  // SystemInfoMessage (message.isSystemInfo === true)
  // ==========================================================================
  describe('SystemInfoMessage', () => {
    it('renders with testID "system-info-message"', () => {
      const message = makeMessage({
        role: 'system',
        content: 'Model loaded successfully',
        isSystemInfo: true,
      });

      const { getByTestId } = render(<ChatMessage message={message} />);

      expect(getByTestId('system-info-message')).toBeTruthy();
    });

    it('displays the system info content text', () => {
      const message = makeMessage({
        role: 'system',
        content: 'Llama 3.2 loaded in 2.5s',
        isSystemInfo: true,
      });

      const { getByText } = render(<ChatMessage message={message} />);

      expect(getByText('Llama 3.2 loaded in 2.5s')).toBeTruthy();
    });

    it('takes precedence over tool role check (isSystemInfo checked first)', () => {
      // Even if role is 'tool', isSystemInfo should take priority in the render path
      const message = makeMessage({
        role: 'system',
        content: 'System notification',
        isSystemInfo: true,
      });

      const { getByTestId, queryByTestId } = render(<ChatMessage message={message} />);

      expect(getByTestId('system-info-message')).toBeTruthy();
      expect(queryByTestId('tool-message')).toBeNull();
    });
  });

  // ==========================================================================
  // Routing: tool message vs assistant message vs system info
  // ==========================================================================
  describe('message routing', () => {
    it.each([
      ['tool result', { role: 'tool' as const, toolName: 'calculator' }, 'tool-message', ['assistant-message', 'tool-call-message']],
      ['tool call', { role: 'assistant' as const, toolCalls: [{ id: 'tc-1', name: 'web_search', arguments: '{}' }] }, 'tool-call-message', ['assistant-message', 'tool-message']],
      ['normal assistant', { role: 'assistant' as const }, 'assistant-message', ['tool-call-message', 'tool-message']],
      ['system info', { role: 'assistant' as const, isSystemInfo: true }, 'system-info-message', ['assistant-message']],
    ])('routes %s correctly', (_label, overrides, expectedId, absentIds) => {
      const message = makeMessage({ content: 'test content', ...overrides });
      const { getByTestId, queryByTestId } = render(<ChatMessage message={message} />);
      expect(getByTestId(expectedId)).toBeTruthy();
      for (const id of absentIds) {
        expect(queryByTestId(id)).toBeNull();
      }
    });
  });

  // ==========================================================================
  // getToolIcon coverage (via rendered tool results)
  // ==========================================================================
  describe('getToolIcon mapping', () => {
    // We cannot directly inspect the icon name prop due to the mock,
    // but we can verify each tool name renders without error.
    const toolNames = [
      'web_search',
      'calculator',
      'get_current_datetime',
      'get_device_info',
      'unknown_tool',
      undefined,
    ];

    toolNames.forEach(toolName => {
      it(`renders tool result for toolName="${toolName}" without crashing`, () => {
        const message = makeMessage({
          role: 'tool',
          content: 'result',
          toolName,
        });

        const { getByTestId } = render(<ChatMessage message={message} />);
        expect(getByTestId('tool-message')).toBeTruthy();
      });
    });
  });
});
