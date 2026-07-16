/**
 * Regression tests for tool-accordion expand-state persistence across the
 * streaming→finalized remount.
 *
 * The chat FlatList keys rows by `message.id`, and the in-progress assistant
 * reply renders with `id === 'streaming'` until it finalizes into a real id.
 * That key change unmounts/remounts the row and every accordion inside it. When
 * an accordion held its expanded flag in a local `useState`, the flag reset to
 * collapsed on finalize — the "tap does nothing, then suddenly opens later" bug.
 *
 * These tests prove the flag now survives the remount because it lives in a
 * shared store keyed by a STABLE identity (toolCallId for tool results, the real
 * message id for the routed-tools list), NOT by the transient message id.
 *
 * Written to FAIL against the old local-useState implementation (a remount would
 * reset to collapsed) and PASS after moving the state into the accordion store.
 */

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { ChatMessage } from '../../../src/components/ChatMessage';
import { ToolsSentCollapsible } from '../../../src/components/ChatMessage/components/ToolsSentCollapsible';
import { useAccordionStore } from '../../../src/stores';
import { createMessage } from '../../utils/factories';
import type { Message } from '../../../src/types';

jest.mock('../../../src/utils/messageContent', () => ({
  ...jest.requireActual('../../../src/utils/messageContent'),
  stripControlTokens: (content: string) => content,
}));

const makeToolResult = (overrides: Partial<Message>): Message =>
  createMessage({
    id: 'streaming',
    role: 'tool',
    content: 'Detailed search results',
    toolName: 'web_search',
    toolCallId: 'tc-stable-1',
    ...overrides,
  } as any);

describe('Tool accordion — expand-state persistence across remount', () => {
  beforeEach(() => {
    useAccordionStore.setState({ expanded: {} });
  });

  describe('ToolResultBubble (role === "tool")', () => {
    it('KEEPS expanded state when the message id changes streaming→finalized (regression)', () => {
      // Render the in-progress tool result (id === 'streaming') and expand it.
      const streaming = makeToolResult({ id: 'streaming', toolCallId: 'tc-stable-1' });
      const first = render(<ChatMessage message={streaming} />);
      fireEvent.press(first.getByTestId('tool-result-label-web_search'));
      expect(first.getByText('Detailed search results')).toBeTruthy();

      // Simulate the FlatList row remount: the SAME logical message now has a
      // real id (finalize), but the stable toolCallId is unchanged. Unmount +
      // fresh mount mimics the keyExtractor 'streaming' → realId transition.
      first.unmount();
      const finalized = makeToolResult({ id: 'assistant-real-42', toolCallId: 'tc-stable-1' });
      const second = render(<ChatMessage message={finalized} />);

      // Old local-useState would reset to collapsed here (detail region gone).
      // With the store keyed by toolCallId, it stays expanded.
      expect(second.getByText('Detailed search results')).toBeTruthy();
    });

    it('toggles open and closed on tap', () => {
      const msg = makeToolResult({ id: 'm1', toolCallId: 'tc-a' });
      const { getByTestId, queryByText, getByText } = render(<ChatMessage message={msg} />);

      // Starts collapsed: detail content not shown.
      expect(queryByText('Detailed search results')).toBeNull();

      // Open.
      fireEvent.press(getByTestId('tool-result-label-web_search'));
      expect(getByText('Detailed search results')).toBeTruthy();

      // Close.
      fireEvent.press(getByTestId('tool-result-label-web_search'));
      expect(queryByText('Detailed search results')).toBeNull();
    });

    it('keeps two different tool results independent (distinct toolCallIds)', () => {
      // Render both in one tree so a single store update projects to both rows.
      const { getAllByTestId, getByText, queryByText } = render(
        <>
          <ChatMessage message={makeToolResult({ id: 'ma', toolCallId: 'tc-a', content: 'Result A body' })} />
          <ChatMessage message={makeToolResult({ id: 'mb', toolCallId: 'tc-b', content: 'Result B body' })} />
        </>,
      );

      // Expand only the first (tc-a).
      const labels = getAllByTestId('tool-result-label-web_search');
      fireEvent.press(labels[0]);

      expect(getByText('Result A body')).toBeTruthy();
      // The second (tc-b) is untouched and stays collapsed.
      expect(queryByText('Result B body')).toBeNull();
    });
  });

  describe('ToolsSentCollapsible', () => {
    const styles = {
      systemInfoContainer: {},
      toolStatusRow: {},
      toolStatusText: {},
      toolDetailContainer: {},
    };
    const colors = { textMuted: '#888' };

    it('KEEPS expanded state across a remount with the same stableKey (regression)', () => {
      const names = ['web_search', 'calculator'];
      const first = render(
        <ToolsSentCollapsible names={names} stableKey="assistant-real-7" styles={styles} colors={colors} />,
      );
      fireEvent.press(first.getByText(/Tools sent in request/));
      expect(first.getByText('• web_search')).toBeTruthy();

      // Remount with the SAME stable key (survives the finalize).
      first.unmount();
      const second = render(
        <ToolsSentCollapsible names={names} stableKey="assistant-real-7" styles={styles} colors={colors} />,
      );
      expect(second.getByText('• web_search')).toBeTruthy();
    });

    it('toggles open and closed', () => {
      const names = ['web_search'];
      const { getByText, queryByText } = render(
        <ToolsSentCollapsible names={names} stableKey="k1" styles={styles} colors={colors} />,
      );
      expect(queryByText('• web_search')).toBeNull();
      fireEvent.press(getByText(/Tools sent in request/));
      expect(getByText('• web_search')).toBeTruthy();
      fireEvent.press(getByText(/Tools sent in request/));
      expect(queryByText('• web_search')).toBeNull();
    });

    it('two collapsibles with different stableKeys stay independent', () => {
      const { getAllByText, getByText, queryByText } = render(
        <>
          <ToolsSentCollapsible names={['web_search']} stableKey="ka" styles={styles} colors={colors} />
          <ToolsSentCollapsible names={['calculator']} stableKey="kb" styles={styles} colors={colors} />
        </>,
      );
      // Expand only the first collapsible.
      fireEvent.press(getAllByText(/Tools sent in request/)[0]);
      expect(getByText('• web_search')).toBeTruthy();
      expect(queryByText('• calculator')).toBeNull();
    });
  });
});
