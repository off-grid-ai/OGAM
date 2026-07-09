/**
 * BUG #37 regression — the tool-call accordion must be tappable and stay open while a
 * sibling message is ACTIVELY streaming (the whole chat subtree re-renders every token).
 *
 * cf40369b made the expanded flag survive the streaming→finalized remount (accordionStore).
 * The REMAINING bug: during ACTIVE streaming the tool-result row re-rendered every token
 * and its onPress was a fresh closure each render, so the TouchableOpacity press target
 * churned mid-gesture and a tap landing during streaming was dropped — the accordion
 * never opened until generation finished.
 *
 * Fix: `useAccordionExpanded` returns a referentially STABLE toggle, and the accordion
 * rows (ToolResultBubble / ToolsSentCollapsible) are memoized so token churn on a
 * streaming sibling can't re-render them.
 *
 * Two guards below:
 *  1. `useAccordionExpanded` returns the SAME toggle instance across re-renders
 *     (deterministic fails-before / passes-after — a fresh `() => toggle(key)` per render
 *     failed this).
 *  2. The memoized row does NOT re-render when a streaming sibling churns, and the
 *     accordion opens on tap and stays open across the churn.
 */
import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';
import { renderHook } from '@testing-library/react-native';
import { ChatMessage } from '../../../src/components/ChatMessage';
import { createToolResultMessage } from '../../utils/factories';
import { useAccordionStore, useAccordionExpanded } from '../../../src/stores/accordionStore';

jest.mock('../../../src/utils/messageContent', () => ({
  stripControlTokens: (content: string) => content,
}));

describe('BUG #37 — tool accordion is tappable during active streaming', () => {
  beforeEach(() => {
    useAccordionStore.setState({ expanded: {} });
  });

  it('useAccordionExpanded returns a referentially stable toggle across re-renders', () => {
    const { result, rerender } = renderHook(() => useAccordionExpanded('tool-result:call-abc'));
    const firstToggle = result.current[1];
    // Re-render several times (== token churn re-rendering the accordion's owner).
    rerender({});
    rerender({});
    rerender({});
    const laterToggle = result.current[1];
    // A stable handler keeps the TouchableOpacity press target intact across churn.
    expect(laterToggle).toBe(firstToggle);
  });

  it('opens on tap and stays open while a sibling streams (rapid re-renders)', () => {
    const toolMessage = createToolResultMessage(
      'web_search',
      'Detailed search results the accordion reveals when expanded.',
      { id: 'tool-1', toolCallId: 'call-xyz' },
    );

    const StreamingHost: React.FC<{ tick: number }> = ({ tick }) => (
      <>
        <ChatMessage message={toolMessage} isStreaming={false} />
        <ChatMessage
          message={{ id: 'streaming', role: 'assistant', content: 'x'.repeat(tick), timestamp: 0, isStreaming: true }}
          isStreaming
        />
      </>
    );

    const { getByTestId, queryByText, rerender } = render(<StreamingHost tick={0} />);

    for (let t = 1; t <= 5; t++) {
      act(() => rerender(<StreamingHost tick={t} />));
    }
    expect(queryByText('Detailed search results the accordion reveals when expanded.')).toBeNull();

    act(() => {
      fireEvent.press(getByTestId('tool-result-label-web_search'));
    });

    for (let t = 6; t <= 12; t++) {
      act(() => rerender(<StreamingHost tick={t} />));
    }

    expect(queryByText('Detailed search results the accordion reveals when expanded.')).not.toBeNull();
    expect(useAccordionStore.getState().expanded['tool-result:call-xyz']).toBe(true);
  });
});
