import React from 'react';
import { render } from '@testing-library/react-native';
import { MessageAudioMode } from '../../../pro/audio/ui/MessageAudioMode';
import { createMessage } from '../../utils/factories';

describe('voice mode prompt enhancement', () => {
  it('shows the live enhanced prompt inside Working before the turn completes', () => {
    const msg = createMessage({
      id: 'enhancing-image',
      role: 'assistant',
      content: '<think>__LABEL:Enhanced prompt__\nA cinematic fox in the snow.</think>',
      isThinking: false,
    });
    const view = render(
      <MessageAudioMode
        msg={msg}
        isStreamingThis
        shouldAnimate={false}
        showGenerationDetails={false}
        onCopy={() => {}}
        onRetry={() => {}}
        onEdit={() => {}}
        onGenerateImage={() => {}}
        onImagePress={() => {}}
      />,
    );

    expect(view.getByTestId('assistant-work-toggle').props.accessibilityLabel).toBe('Working');
    expect(view.getByText('Enhanced prompt')).toBeTruthy();
    expect(view.getByTestId('thinking-block-content')).toBeTruthy();
    expect(view.getByText('A cinematic fox in the snow.')).toBeTruthy();
    expect(view.queryByTestId('audio-bubble-enhancing-image')).toBeNull();
    expect(view.getByTestId('audio-response-loader')).toBeTruthy();
  });

  it('shows the shared loader while an audio reply is pending and removes it when complete', () => {
    const msg = createMessage({ id: 'audio-reply', role: 'assistant', content: '' });
    const props = {
      msg,
      shouldAnimate: false,
      showGenerationDetails: false,
      onCopy: () => {},
      onRetry: () => {},
      onEdit: () => {},
      onGenerateImage: () => {},
      onImagePress: () => {},
    };
    const view = render(<MessageAudioMode {...props} isStreamingThis />);
    expect(view.getByTestId('audio-response-loader')).toBeTruthy();

    view.rerender(<MessageAudioMode {...props} msg={{ ...msg, content: 'Hello.' }} isStreamingThis={false} />);
    expect(view.queryByTestId('audio-response-loader')).toBeNull();
  });
});
