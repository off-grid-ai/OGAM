import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { ChatMessage } from '../../../src/components/ChatMessage';
import { createGenerationMeta, createMessage } from '../../utils/factories';

describe('synced assistant tool timeline', () => {
  it('shows thought, tools, answer, time, and details in that order and opens each disclosure', () => {
    const message = createMessage({
      id: 'synced-tool-reply',
      role: 'assistant',
      content: 'The answer is ready.',
      reasoningContent: 'I checked the sources.',
      toolArtifacts: [
        { name: 'web_search', result: 'First source.' },
        { name: 'web_search', result: 'Second source.' },
      ],
      generationMeta: {
        ...createGenerationMeta(),
        routedToolNames: ['web_search'],
      },
    });
    const view = render(<ChatMessage message={message} showGenerationDetails />);
    const row = view.getByTestId('assistant-message');
    const visibleOrder = row.findAll(node => [
      'thinking-block', 'tool-message', 'message-bubble', 'message-meta-row',
      'tools-sent-collapsible', 'generation-details-toggle',
    ].includes(node.props.testID)).map(node => node.props.testID);

    const firstPosition = (testID: string): number => visibleOrder.indexOf(testID);
    expect([
      'thinking-block', 'tool-message', 'message-bubble', 'message-meta-row',
      'tools-sent-collapsible', 'generation-details-toggle',
    ].map(firstPosition)).toEqual([
      ...['thinking-block', 'tool-message', 'message-bubble', 'message-meta-row',
        'tools-sent-collapsible', 'generation-details-toggle'].map(firstPosition),
    ].sort((a, b) => a - b));
    expect(view.getAllByText('Web search result')).toHaveLength(2);
    expect(view.getByText('The answer is ready.')).toBeTruthy();

    fireEvent.press(view.getAllByText('Web search result')[0]);
    expect(view.getByText('First source.')).toBeTruthy();
    fireEvent.press(view.getByText('Tools sent in request (1)'));
    expect(view.getByText('• web_search')).toBeTruthy();
    fireEvent.press(view.getByText('Generation details'));
    expect(view.getByTestId('generation-meta')).toBeTruthy();
  });
});
