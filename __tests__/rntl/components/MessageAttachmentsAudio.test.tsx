/**
 * MessageAttachments — audio transcription rendering (Feature 1).
 *
 * Renders through the real ChatMessage component so we exercise the actual
 * attachment render path. Asserts:
 * - a voice message with a transcription shows the transcribed text
 * - a voice message WITHOUT a transcription shows only "Voice message"
 *   (no stray empty transcription line)
 */
import React from 'react';
import { render } from '@testing-library/react-native';
import { ChatMessage } from '../../../src/components/ChatMessage';
import { createUserMessage, createAudioAttachment } from '../../utils/factories';

jest.mock('../../../src/utils/messageContent', () => ({
  ...jest.requireActual('../../../src/utils/messageContent'),
  stripControlTokens: (content: string) => content,
}));

describe('MessageAttachments — audio transcription', () => {
  it('renders the transcription text under the Voice message label', () => {
    const message = createUserMessage('what is the weather', {
      attachments: [createAudioAttachment({ textContent: 'what is the weather' })],
    });
    const { getByText, getByTestId } = render(<ChatMessage message={message} />);

    expect(getByText('Voice message')).toBeTruthy();
    const transcription = getByTestId('audio-transcription-0');
    expect(transcription.props.children).toBe('what is the weather');
  });

  it('does NOT render a transcription line when the voice message has none', () => {
    const message = createUserMessage('', {
      attachments: [createAudioAttachment({ textContent: undefined })],
    });
    const { getByText, queryByTestId } = render(<ChatMessage message={message} />);

    expect(getByText('Voice message')).toBeTruthy();
    expect(queryByTestId('audio-transcription-0')).toBeNull();
  });
});
