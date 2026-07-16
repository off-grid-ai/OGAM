/**
 * OD8 — voice-mode thinking must STREAM token-by-token in the DISPLAY.
 *
 * In TEXT mode the assistant's reasoning streams live: every reasoning token
 * updates `streamingReasoningContent` in the REAL chatStore, `getDisplayMessages`
 * rebuilds the in-progress `streaming` message (carrying the live reasoning), and
 * the message UI re-renders it. VOICE mode renders the same in-progress message
 * through the `message.audioMode` slot (MessageAudioMode).
 *
 * The bug (OD8): while streaming, MessageAudioMode showed only a loading audio
 * bubble and threw the live reasoning away — the thinking text appeared all at
 * once at completion, not per-token.
 *
 * This test drives the REAL chatStore with a DYNAMIC sequence of reasoning-token
 * appends, and at each step builds the in-progress message via the REAL
 * getDisplayMessages and renders the REAL MessageAudioMode. It asserts the
 * DISPLAYED thinking text reflects each increment ('' → partial → more), not
 * only the final complete string. A static mock cannot prove per-token streaming,
 * so the sequence is genuinely incremental and driven through the real store.
 */
import React from 'react';
import { render, within } from '@testing-library/react-native';
import { MessageAudioMode } from '@offgrid/pro/audio/ui/MessageAudioMode';
import type { MessageAudioModeProps } from '@offgrid/pro/audio/ui/MessageAudioMode';
import { useChatStore } from '@offgrid/core/stores/chatStore';
import { getDisplayMessages } from '../../../../src/screens/ChatScreen/types';
import type { Message } from '@offgrid/core/types';

// The file player decodes real audio off a native module — a genuine boundary.
jest.mock('@offgrid/pro/audio/audioFilePlayer', () => ({
  decodeFileWaveform: jest.fn(async () => [] as number[]),
}));

const baseProps: Omit<MessageAudioModeProps, 'msg'> = {
  isStreamingThis: true,
  shouldAnimate: false,
  showGenerationDetails: false,
  onCopy: jest.fn(),
  onRetry: jest.fn(),
  onEdit: jest.fn(),
  onGenerateImage: jest.fn(),
  onImagePress: jest.fn(),
};

const initialChatState = useChatStore.getState();

afterEach(() => {
  jest.clearAllMocks();
  useChatStore.setState(initialChatState, true);
});

/** Build the in-progress `streaming` message the UI renders, from live store state. */
function currentStreamingMessage(conversationId: string): Message {
  const s = useChatStore.getState();
  const items = getDisplayMessages([], {
    isThinking: s.isThinking,
    streamingMessage: s.streamingMessage,
    streamingReasoningContent: s.streamingReasoningContent,
    isStreamingForThisConversation:
      s.streamingForConversationId === conversationId,
  });
  return items[items.length - 1] as Message;
}

describe('MessageAudioMode — voice thinking streams per token (OD8)', () => {
  it('reflects each reasoning increment in the displayed thinking, not only the final string', () => {
    const conversationId = 'conv-od8';
    const store = useChatStore.getState();
    store.startStreaming(conversationId);
    // A separate-channel model streams reasoning via streamingReasoningContent.
    store.appendToStreamingReasoningContent('Let me');

    // Renders the in-progress message and returns the live thinking text shown
    // inside the (expanded-while-streaming) thinking block.
    const renderThinking = () => {
      const msg = currentStreamingMessage(conversationId);
      const utils = render(<MessageAudioMode {...baseProps} msg={msg} />);
      const block = utils.getByTestId('thinking-block-content');
      return { utils, block };
    };

    // Step 1: partial reasoning is already visible while streaming.
    const step1 = renderThinking();
    expect(within(step1.block).getByText(/Let me/)).toBeTruthy();
    expect(within(step1.block).queryByText(/think about/)).toBeNull();
    step1.utils.unmount();

    // Step 2: another token arrives — the DISPLAY grows to include it.
    useChatStore.getState().appendToStreamingReasoningContent(' think about');
    const step2 = renderThinking();
    expect(within(step2.block).getByText(/Let me think about/)).toBeTruthy();
    expect(within(step2.block).queryByText(/the weather/)).toBeNull();
    step2.utils.unmount();

    // Step 3: more tokens — still growing, still mid-stream (not gated on completion).
    useChatStore.getState().appendToStreamingReasoningContent(' the weather');
    const step3 = renderThinking();
    expect(
      within(step3.block).getByText(/Let me think about the weather/),
    ).toBeTruthy();
    step3.utils.unmount();
  });
});
