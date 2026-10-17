/**
 * The collapsed "Thought process" preview shows the first two lines of the reasoning as plain text
 * and ends in an ellipsis, never a box that slices through the middle of a word.
 *
 * Real ChatMessage, no mocks of our code (ChatMessage.test.tsx replaces part of messageContent, so
 * this lives in its own file). Drawing the "…" glyph is the native text renderer's job; what the app
 * decides, and what this asserts, is that the preview is one plain-text run clamped to two lines with
 * a tail ellipsis, inside a box that does not clip it at a fixed height. A person confirms the drawn
 * ellipsis on a device.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { render, fireEvent, screen } from '@testing-library/react-native';
import { ChatMessage } from '../../../src/components/ChatMessage';
import { createAssistantMessage } from '../../utils/factories';

const REASONING =
  '## Planning the reply\n**First**, check what the person asked for. Then compare the three options, ' +
  'weigh the cost of each one against the time it saves, and pick the one that fits a small team. ' +
  'Finally, write the answer in plain words with the reason up front.';

describe('ChatMessage thinking preview', () => {
  it('shows the reasoning as plain text clamped to two lines that ends in an ellipsis', () => {
    render(<ChatMessage message={createAssistantMessage(`<think>${REASONING}</think>Pick option two.`)} />);

    // Before: the work section is collapsed, so no preview is on screen.
    expect(screen.queryByTestId('thinking-block-preview')).toBeNull();

    fireEvent.press(screen.getByTestId('assistant-work-toggle'));

    const preview = screen.getByTestId('thinking-block-preview');
    const text = screen.getByText(/^Planning the reply First, check what the person asked for\./);
    expect(preview).toContainElement(text);
    // Plain words, no Markdown marks.
    expect(text).not.toHaveTextContent(/[#*]/);
    // Two lines, then a tail ellipsis …
    expect(text.props.numberOfLines).toBe(2);
    expect(text.props.ellipsizeMode).toBe('tail');
    // … and no fixed-height box clipping the text part-way through a line.
    const box = StyleSheet.flatten(preview.props.style) ?? {};
    expect(box.maxHeight).toBeUndefined();
    expect(box.overflow).not.toBe('hidden');

    // Opening the thought process replaces the preview with the full reasoning.
    fireEvent.press(screen.getByTestId('thinking-block-toggle'));
    expect(screen.queryByTestId('thinking-block-preview')).toBeNull();
    expect(screen.getByTestId('thinking-block-content')).toHaveTextContent(/Finally, write the answer in plain words/);
  });
});
