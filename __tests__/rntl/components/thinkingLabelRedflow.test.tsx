/**
 * RED-FLOW (UI): Q6 — the thinking box shows the DONE label "Thought process" while it is still
 * streaming on the separate reasoning channel (litert/remote). See docs/DEVICE_TEST_LOG.md Q6.
 *
 * This is the shape the whole suite should take: mount the REAL ChatMessage, feed the EXACT shape a
 * mid-stream reasoning message has (getDisplayMessages line 51: content '', reasoningContent set,
 * isStreaming true), and assert WHAT THE USER SEES — the header text. It is RED on HEAD because
 * buildMessageData hardcodes isReasoningComplete:true for the reasoningContent branch, ignoring
 * isStreaming, so the header reads "Thought process" (finished) mid-stream. No mocks — pure render.
 */
import React from 'react';
import { render } from '@testing-library/react-native';
import { ChatMessage } from '../../../src/components/ChatMessage';
import { createMessage } from '../../utils/factories';

describe('thinking label — UI red-flow (assert what the user sees; currently RED)', () => {
  it('shows "Thinking..." while reasoning is still streaming on the separate channel', () => {
    // Exact mid-stream separate-channel shape (no answer yet, reasoning arriving, still streaming).
    const streaming = createMessage({
      role: 'assistant',
      content: '',
      reasoningContent: 'I am still reasoning about this',
      isStreaming: true,
    });

    const { queryByText } = render(<ChatMessage message={streaming} />);

    // Correct: the header reflects the in-progress state. Today it reads "Thought process".
    expect(queryByText('Thinking...')).not.toBeNull();
    expect(queryByText('Thought process')).toBeNull();
  });
});
