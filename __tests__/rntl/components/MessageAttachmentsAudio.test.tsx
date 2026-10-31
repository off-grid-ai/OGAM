/**
 * Voice messages show the transcript once, as message text.
 *
 * Renders through the real ChatMessage component so we exercise the actual
 * attachment render path. Asserts:
 * - a voice message with a transcription shows the transcribed text once
 * - a voice message WITHOUT a transcription shows only "Voice message"
 *   (no stray empty transcription line)
 */
import React from 'react';
import { render } from '@testing-library/react-native';
import { ChatMessage } from '../../../src/components/ChatMessage';
import { createUserMessage, createAudioAttachment } from '../../utils/factories';


describe('MessageAttachments — audio transcription', () => {
  it('renders the transcription once, outside the Voice message badge', () => {
    const message = createUserMessage('what is the weather', {
      attachments: [createAudioAttachment({ textContent: 'what is the weather' })],
    });
    const { getByText, queryAllByText, queryByText } = render(<ChatMessage message={message} />);

    expect(getByText('Voice message')).toBeTruthy();
    expect(queryAllByText('what is the weather')).toHaveLength(1);
    expect(queryByText('Transcribe again')).toBeNull();
  });

  it('does NOT render a transcription line when the voice message has none', () => {
    const message = createUserMessage('', {
      attachments: [createAudioAttachment({ textContent: undefined })],
    });
    const { getByText, queryByText } = render(<ChatMessage message={message} />);

    expect(getByText('Voice message')).toBeTruthy();
    expect(queryByText('Transcribe again')).toBeNull();
  });
});
