/**
 * MessageAudioMode (pro) — RNTL tests
 *
 * MessageAudioMode is the pro component behind the `message.audioMode` slot. It
 * chooses HOW an audio-mode chat message is presented based on the message shape:
 *  - a USER voice message (audio attachment)   → user audio bubble
 *  - an ASSISTANT streaming/thinking message   → in-progress "generating" audio bubble
 *  - a completed ASSISTANT text answer         → assistant audio bubble
 *  - a completed ASSISTANT with tool calls/img  → full ChatMessage (+ audio bubble for image)
 *  - an all-thinking / empty-answer message     → thinking block only, NO audio bubble
 *  - a system-info message                      → falls back to a normal ChatMessage
 *
 * These tests render the REAL MessageAudioMode + the REAL AudioMessageBubble /
 * ChatMessage it delegates to, drive the REAL useTTSStore, and assert what the
 * user SEES (which bubble/testID appears) per branch and what pressing controls
 * DOES (the copy handler receives the transcript).
 */
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { MessageAudioMode } from '@offgrid/pro/audio/ui/MessageAudioMode';
import type { MessageAudioModeProps } from '@offgrid/pro/audio/ui/MessageAudioMode';
import { useTTSStore } from '@offgrid/pro/audio/ttsStore';
import type { Message } from '@offgrid/core/types';
import {
  createUserMessage,
  createAssistantMessage,
  createAudioAttachment,
} from '../../../utils/factories';

// The file player decodes real audio files off a native module — a genuine
// native/IO boundary. Return a stable empty waveform so decode never runs.
jest.mock('@offgrid/pro/audio/audioFilePlayer', () => ({
  decodeFileWaveform: jest.fn(async () => [] as number[]),
}));

const baseProps: Omit<MessageAudioModeProps, 'msg'> = {
  isStreamingThis: false,
  shouldAnimate: false,
  showGenerationDetails: false,
  onCopy: jest.fn(),
  onRetry: jest.fn(),
  onEdit: jest.fn(),
  onGenerateImage: jest.fn(),
  onImagePress: jest.fn(),
};

const renderMode = (msg: Message, overrides: Partial<MessageAudioModeProps> = {}) =>
  render(<MessageAudioMode {...baseProps} msg={msg} {...overrides} />);

const initialTTSState = useTTSStore.getState();

afterEach(() => {
  jest.clearAllMocks();
  useTTSStore.setState(initialTTSState, true);
});

describe('MessageAudioMode', () => {
  it('renders a USER voice message as an audio bubble', () => {
    const msg = createUserMessage('what is the weather', {
      attachments: [createAudioAttachment({ textContent: 'what is the weather' })],
    });
    const { getByTestId } = renderMode(msg);
    expect(getByTestId(`audio-bubble-${msg.id}`)).toBeTruthy();
  });

  it('falls back to a normal chat message for a USER text message (no audio attachment)', () => {
    const msg = createUserMessage('plain text, no audio');
    const { getByTestId, queryByTestId } = renderMode(msg);
    // No audio attachment → not the user audio bubble; renders the ChatMessage bubble.
    expect(queryByTestId(`audio-bubble-${msg.id}`)).toBeNull();
    expect(getByTestId('user-message')).toBeTruthy();
  });

  it('renders an in-progress assistant message as a loading audio bubble while streaming', () => {
    const msg = createAssistantMessage('partial answer so far');
    const { getByTestId, queryByText } = renderMode(msg, { isStreamingThis: true });
    // The in-progress path renders an AudioMessageBubble with isLoading. The
    // completed-only "•••" action hint is gated behind !isLoading, so it is absent.
    expect(getByTestId(`audio-bubble-${msg.id}`)).toBeTruthy();
    expect(queryByText('•••')).toBeNull();
  });

  it('renders an in-progress bubble for a thinking placeholder even when not streaming', () => {
    const msg = createAssistantMessage('', { isThinking: true });
    const { getByTestId, queryByText } = renderMode(msg, { isStreamingThis: false });
    expect(getByTestId(`audio-bubble-${msg.id}`)).toBeTruthy();
    expect(queryByText('•••')).toBeNull();
  });

  it('renders a completed assistant text answer as a (non-loading) audio bubble', () => {
    const msg = createAssistantMessage('The weather is sunny.');
    const { getByTestId, getByText } = renderMode(msg);
    expect(getByTestId(`audio-bubble-${msg.id}`)).toBeTruthy();
    // Completed bubble is NOT loading → the "•••" action hint is shown.
    expect(getByText('•••')).toBeTruthy();
  });

  it('pressing copy on a completed assistant bubble passes the transcript to onCopy', () => {
    const onCopy = jest.fn();
    const msg = createAssistantMessage('Speak this answer.');
    const { getByText, getByTestId } = renderMode(msg, { onCopy });
    // Open the action menu via the "•••" hint, then press Copy — the bubble
    // forwards the built transcript to onCopy.
    fireEvent.press(getByText('•••'));
    fireEvent.press(getByTestId('action-copy'));
    expect(onCopy).toHaveBeenCalledWith('Speak this answer.');
  });

  it('regenerate on a completed assistant bubble calls onRetry with the message', () => {
    const onRetry = jest.fn();
    const msg = createAssistantMessage('Regenerate this.');
    const { getByText, getByTestId } = renderMode(msg, { onRetry });
    fireEvent.press(getByText('•••'));
    fireEvent.press(getByTestId('action-retry'));
    expect(onRetry).toHaveBeenCalledWith(msg);
  });

  it('resend on a user voice bubble calls onRetry with the message', () => {
    const onRetry = jest.fn();
    const msg = createUserMessage('resend me', {
      attachments: [createAudioAttachment({ textContent: 'resend me' })],
    });
    const { getByText, getByTestId } = renderMode(msg, { onRetry });
    fireEvent.press(getByText('•••'));
    fireEvent.press(getByTestId('action-retry'));
    expect(onRetry).toHaveBeenCalledWith(msg);
  });

  it('regenerate on an image message audio bubble calls onRetry with the message', () => {
    const onRetry = jest.fn();
    const msg = createAssistantMessage('a generated dog', {
      attachments: [{ id: 'img2', type: 'image', uri: 'file:///dog.png' }],
    });
    const { getAllByText, getByTestId } = renderMode(msg, { onRetry });
    // The image path renders a ChatMessage AND an audio bubble; press the audio
    // bubble's "•••" (the last one) to reach its retry action.
    const hints = getAllByText('•••');
    fireEvent.press(hints[hints.length - 1]);
    fireEvent.press(getByTestId('action-retry'));
    expect(onRetry).toHaveBeenCalledWith(msg);
  });

  it('toggles the thinking block on an assistant message that has both reasoning and an answer', () => {
    const msg = createAssistantMessage('<think>some reasoning here</think>the spoken answer');
    const { getByTestId } = renderMode(msg);
    // hasThinking → the thinking block renders; hasAnswer → the audio bubble too.
    expect(getByTestId(`audio-bubble-${msg.id}`)).toBeTruthy();
    const toggle = getByTestId('thinking-block-toggle');
    fireEvent.press(toggle);
    // The toggle handler ran without throwing; block still present after toggle.
    expect(getByTestId('thinking-block')).toBeTruthy();
  });

  it('renders ONLY a thinking block (no audio bubble) for an all-thinking message', () => {
    // Pure reasoning, no speakable answer → thinking block, but NO audio bubble
    // (avoids a phantom empty 0:00 note).
    const msg = createAssistantMessage('<think>just reasoning, no answer</think>');
    const { queryByTestId } = renderMode(msg);
    expect(queryByTestId(`audio-bubble-${msg.id}`)).toBeNull();
  });

  it('renders a full ChatMessage for an assistant message with tool calls', () => {
    const msg = createAssistantMessage('used a tool', {
      toolCalls: [{ id: 't1', name: 'search', arguments: '{}' }],
    });
    const { getByTestId, queryByTestId } = renderMode(msg);
    // Tool-call messages render the real ChatMessage (proper tool-call UI),
    // NOT an audio-only bubble.
    expect(getByTestId('tool-call-message')).toBeTruthy();
    expect(queryByTestId(`audio-bubble-${msg.id}`)).toBeNull();
  });

  it('renders a full ChatMessage AND an audio bubble for an assistant image message', () => {
    const msg = createAssistantMessage('a generated cat', {
      attachments: [{ id: 'img1', type: 'image', uri: 'file:///cat.png' }],
    });
    const { getByTestId } = renderMode(msg);
    // Image messages get the ChatMessage (shows the image) plus an audio bubble
    // below so the caption text can still be played.
    expect(getByTestId('assistant-message')).toBeTruthy();
    expect(getByTestId(`audio-bubble-${msg.id}`)).toBeTruthy();
  });

  it('falls back to a normal chat message for a system-info message', () => {
    const msg = createAssistantMessage('system notice', { isSystemInfo: true });
    const { getByTestId, queryByTestId } = renderMode(msg);
    // isSystemInfo → not an audio assistant → fallback ChatMessage, no audio bubble.
    expect(queryByTestId(`audio-bubble-${msg.id}`)).toBeNull();
    expect(getByTestId('system-info-message')).toBeTruthy();
  });
});
