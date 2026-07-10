/**
 * MANUAL SPEAK (chat mode) terminal-artifact guards.
 *
 * The manual "speak" control on an assistant chat bubble is the pro
 * `message.speakButton` slot; MessageRenderer decides the exact `text` prop it
 * receives. We render the REAL MessageRenderer, register a capturing slot, and
 * assert the string it hands the speaker — the terminal artifact a user hears.
 *
 * ChatMessage is stubbed to a thin host that just renders `metaExtra` (the slot),
 * so the assertion is purely about MessageRenderer's text decision, not markdown
 * rendering.
 *
 * FINDING (documented by the divergence test at the bottom): manual chat-mode
 * speak passes stripControlTokens(content) — markdown is NOT stripped — while
 * voice-mode auto-speak passes stripMarkdownForSpeech(stripControlTokens(content)).
 * So the SAME reply is read with literal "asterisk asterisk" / backticks / pipes
 * when spoken via the chat button, but clean in voice mode.
 */
import React from 'react';
import { render } from '@testing-library/react-native';

// Stub ChatMessage: render only metaExtra so we can inspect the slot's props.
jest.mock('../../../src/components', () => {
  const RC = require('react');
  return {
    ChatMessage: (props: { metaExtra?: React.ReactNode }) =>
      RC.createElement(RC.Fragment, null, props.metaExtra ?? null),
  };
});

import { MessageRenderer } from '../../../src/screens/ChatScreen/MessageRenderer';
import { registerSlot, SLOTS } from '../../../src/bootstrap/slotRegistry';
import { useUiModeStore } from '../../../src/stores';
import { stripControlTokens, stripMarkdownForSpeech } from '../../../src/utils/messageContent';
import type { Message } from '../../../src/types';

// Capture the text handed to the speak slot.
let capturedSpeakText: string | null = null;
beforeAll(() => {
  registerSlot(SLOTS.messageSpeakButton, (p: { text: string; messageId: string }) => {
    capturedSpeakText = p.text;
    return null;
  });
});

beforeEach(() => {
  capturedSpeakText = null;
  useUiModeStore.setState({ interfaceMode: 'chat' });
});

function renderAssistant(content: string, extra: Partial<Message> = {}): void {
  const msg: Message = {
    id: 'm1',
    role: 'assistant',
    content,
    timestamp: 0,
    ...extra,
  } as Message;
  render(
    <MessageRenderer
      item={msg}
      index={0}
      displayMessagesLength={1}
      animateLastN={0}
      imageModelLoaded={false}
      isStreaming={false}
      isGeneratingImage={false}
      showGenerationDetails={false}
      onCopy={() => {}}
      onRetry={() => {}}
      onEdit={() => {}}
      onGenerateImage={() => {}}
      onImagePress={() => {}}
    />
  );
}

describe('manual chat-mode speak: text handed to the speaker', () => {
  it('plain assistant message gets a speak control', () => {
    renderAssistant('Just a plain sentence.');
    expect(capturedSpeakText).toBe('Just a plain sentence.');
  });

  it('a tool-using assistant message (toolCalls) gets NO speak control', () => {
    renderAssistant('ran a tool', { toolCalls: [{ id: 't', name: 'x', arguments: {} }] as any });
    expect(capturedSpeakText).toBeNull();
  });

  it('inline <think> in stored content is NOT spoken by the manual button', () => {
    renderAssistant('<think>hidden</think>The visible answer.');
    expect(capturedSpeakText).not.toBeNull();
    expect(capturedSpeakText).not.toContain('hidden');
  });

  // ── The divergence: manual chat-speak reads raw markdown aloud ──────────────
  it('BUG: manual speak keeps raw markdown that voice-mode strips', () => {
    const content = '## Title\n\nHere is **bold** and `code` and | a | b |.';
    renderAssistant(content);
    const manual = capturedSpeakText!;
    const voiceMode = stripMarkdownForSpeech(stripControlTokens(content));
    // Current (buggy) behavior: the two DIVERGE — manual keeps markdown symbols.
    expect(manual).toContain('**');
    expect(manual).toContain('`');
    expect(manual).toContain('##');
    expect(manual).not.toEqual(voiceMode);
    // Documented expectation once fixed (manual should match voice-mode cleaning):
    // expect(manual).toEqual(voiceMode);
  });
});
