import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { MessageRenderer } from '../../../src/screens/ChatScreen/MessageRenderer';
import { Message } from '../../../src/types';

const question: Message = { id: 'q1', role: 'user', content: '[test] what is rust?', timestamp: 1 };

const base = {
  item: question,
  index: 0,
  displayMessagesLength: 1,
  animateLastN: 0,
  imageModelLoaded: false,
  isStreaming: false,
  isGeneratingImage: false,
  isBusy: false,
  showTryAgain: true,
  showGenerationDetails: false,
  onCopy: jest.fn(),
  onRetry: jest.fn(),
  onEdit: jest.fn(),
  onGenerateImage: jest.fn(),
  onImagePress: jest.fn(),
};

describe('<MessageRenderer/> question with no answer', () => {
  it('shows Try again under the last question and asks it again on tap', () => {
    const onRetry = jest.fn();
    const view = render(<MessageRenderer {...base} onRetry={onRetry} />);
    fireEvent.press(view.getByTestId('unanswered-retry'));
    expect(onRetry).toHaveBeenCalledWith(question);
  });

  it('hides Try again while a reply is being made', () => {
    const view = render(<MessageRenderer {...base} isBusy />);
    expect(view.queryByTestId('unanswered-retry')).toBeNull();
  });

  it('hides Try again while text streams', () => {
    const view = render(<MessageRenderer {...base} isStreaming />);
    expect(view.queryByTestId('unanswered-retry')).toBeNull();
  });

  it('hides Try again when the screen says the question has an answer', () => {
    const view = render(<MessageRenderer {...base} showTryAgain={false} />);
    expect(view.queryByTestId('unanswered-retry')).toBeNull();
  });

  it('never shows Try again under an answer', () => {
    const answer: Message = { id: 'a1', role: 'assistant', content: 'A language.', timestamp: 2 };
    const view = render(<MessageRenderer {...base} item={answer} showTryAgain={false} />);
    expect(view.queryByTestId('unanswered-retry')).toBeNull();
  });
});
