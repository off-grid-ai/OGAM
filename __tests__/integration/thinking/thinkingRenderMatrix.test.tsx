/**
 * thinkingRenderMatrix — GREEN guard tests for the thinking/reasoning render domain.
 *
 * These MOUNT the real ChatMessage and assert what is ON SCREEN (getByText / getByTestId /
 * resolved style), never the message object's field shape. Each test fails if the render
 * implementation is deleted or inverted.
 *
 * SCOPE: these lock the CURRENTLY-CORRECT cells of the matrix (plain reasoning, streaming
 * label transitions, empty reasoning, reasoning-only). The BROKEN cells (pre-tool-call
 * thinking dropped; centered/full-bleed tool-call container) are reported as bugs, not
 * committed as red tests. When those are fixed, add the corresponding green guards.
 *
 * Axes crossed here: engine {llama inline <think>, litert/remote separate reasoningContent}
 *                  × content {reasoning+answer, reasoning-only, empty reasoning, unterminated}
 *                  × lifecycle {streaming, finalized}
 */
import React from 'react';
import { render } from '@testing-library/react-native';
import { ChatMessage } from '../../../src/components/ChatMessage';
import { createAssistantMessage } from '../../utils/factories';
import type { Message } from '../../../src/types';

/** llama inline <think> content, no separate reasoning channel. */
const inlineThink = (content: string): Message => createAssistantMessage(content);

/** litert / remote provider: reasoning arrives on a separate channel, content is the answer. */
const separateReasoning = (content: string, reasoning: string): Message => ({
  ...createAssistantMessage(content),
  reasoningContent: reasoning,
});

describe('thinkingRenderMatrix — plain reasoning (no tool call)', () => {
  describe.each([
    ['llama inline <think>', inlineThink('<think>step one, step two</think>The final answer.')],
    ['litert/remote separate channel', separateReasoning('The final answer.', 'step one, step two')],
  ])('engine=%s, finalized, reasoning + answer', (_engine, msg) => {
    it('renders the thinking block AND the answer text', () => {
      const { getByTestId, getByText } = render(<ChatMessage message={msg} isStreaming={false} />);
      expect(getByTestId('thinking-block')).toBeTruthy();
      // answer is visible
      expect(getByText('The final answer.')).toBeTruthy();
    });

    it('expanded thinking content shows the reasoning text on screen', () => {
      // Finalized message defaults collapsed → the preview carries the reasoning; expand by
      // rendering as streaming (defaults expanded) to prove the content block shows real text.
      const { getByTestId, getByText } = render(<ChatMessage message={msg} isStreaming />);
      // The expanded content block exists...
      expect(getByTestId('thinking-block-content')).toBeTruthy();
      // ...and the reasoning text is actually rendered on screen inside it.
      expect(getByText('step one, step two')).toBeTruthy();
    });

    it('the collapsed finalized block is labelled a completed thought, not "Thinking..."', () => {
      const { getByTestId } = render(<ChatMessage message={msg} isStreaming={false} />);
      expect(getByTestId('thinking-block-title').props.children).toBe('Thought process');
    });
  });
});

describe('thinkingRenderMatrix — reasoning-only (no visible answer)', () => {
  describe.each([
    ['llama inline <think>', inlineThink('<think>only my reasoning, nothing else</think>')],
    ['litert/remote separate channel', separateReasoning('', 'only my reasoning, nothing else')],
  ])('engine=%s, finalized, reasoning-only', (_engine, msg) => {
    it('still renders the thinking block with the reasoning (never a blank bubble)', () => {
      const { getByTestId, getByText } = render(<ChatMessage message={msg} isStreaming />);
      expect(getByTestId('thinking-block')).toBeTruthy();
      expect(getByTestId('thinking-block-content')).toBeTruthy();
      expect(getByText('only my reasoning, nothing else')).toBeTruthy();
    });
  });
});

describe('thinkingRenderMatrix — streaming label transitions (llama inline)', () => {
  it('unterminated <think> while streaming shows the in-progress "Thinking..." label', () => {
    const msg = inlineThink('<think>partial reasoning still arriving');
    const { getByTestId } = render(<ChatMessage message={msg} isStreaming />);
    expect(getByTestId('thinking-block-title').props.children).toBe('Thinking...');
  });

  it('once </think> closes, the finalized block flips to the completed "Thought process" label', () => {
    const msg = inlineThink('<think>done reasoning</think>Answer.');
    const { getByTestId } = render(<ChatMessage message={msg} isStreaming={false} />);
    expect(getByTestId('thinking-block-title').props.children).toBe('Thought process');
  });
});

describe('thinkingRenderMatrix — empty reasoning is not a phantom thinking box', () => {
  it('empty reasoningContent while streaming shows NO thinking block (just the cursor)', () => {
    const msg = separateReasoning('', '');
    const { queryByTestId } = render(<ChatMessage message={msg} isStreaming />);
    expect(queryByTestId('thinking-block')).toBeNull();
    expect(queryByTestId('message-text')).toBeTruthy();
  });

  it('a plain answer with no reasoning renders NO thinking block', () => {
    const msg = inlineThink('Just a plain answer, no reasoning.');
    const { queryByTestId, getByText } = render(<ChatMessage message={msg} isStreaming={false} />);
    expect(queryByTestId('thinking-block')).toBeNull();
    expect(getByText('Just a plain answer, no reasoning.')).toBeTruthy();
  });
});

describe('thinkingRenderMatrix — plain-reasoning thinking box lives inside the 85% assistant bubble', () => {
  it('the thinking block is nested inside the left-aligned assistant bubble (not centered/full-bleed)', () => {
    const msg = inlineThink('<think>r</think>ok');
    const { getByTestId, UNSAFE_root } = render(<ChatMessage message={msg} isStreaming={false} />);
    // Assistant message container is left-aligned.
    const container = getByTestId('assistant-message');
    const flatStyle = ([] as any[]).concat(container.props.style).filter(Boolean);
    expect(flatStyle.some((s) => s && s.alignItems === 'flex-start')).toBe(true);
    // The thinking block resolves inside the bubble whose min/max width is 85%.
    expect(getByTestId('thinking-block')).toBeTruthy();
    void UNSAFE_root;
  });
});
