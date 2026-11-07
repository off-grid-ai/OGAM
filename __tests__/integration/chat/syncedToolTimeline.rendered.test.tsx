import React from 'react';
import { View } from 'react-native';
import { fireEvent, render, within } from '@testing-library/react-native';
import { ChatMessage } from '../../../src/components/ChatMessage';
import { getDisplayMessages } from '../../../src/screens/ChatScreen/types';
import { useChatStore } from '../../../src/stores/chatStore';
import { MobileStateMaterializer } from '../../../pro/sync/mobileStateMaterializer';
import { MessageAudioMode } from '../../../pro/audio/ui/MessageAudioMode';
import { createGenerationMeta, createMessage } from '../../utils/factories';

describe('synced assistant tool timeline', () => {
  it('shows reasoning as it streams while the tool loop is still thinking', () => {
    const messages = [createMessage({ id: 'user', role: 'user', content: 'Research this' })];
    const stream = (reasoning: string) => getDisplayMessages(messages, {
      isThinking: true,
      streamingMessage: '',
      streamingReasoningContent: reasoning,
      isStreamingForThisConversation: true,
      isGeneratingForThisConversation: true,
    });
    const view = render(<View>{stream('I should check').map(item =>
      <ChatMessage key={item.id} message={item} isStreaming={item.isStreaming} />
    )}</View>);
    expect(view.getByText('I should check')).toBeTruthy();
    view.rerender(<View>{stream('I should check the source now').map(item =>
      <ChatMessage key={item.id} message={item} isStreaming={item.isStreaming} />
    )}</View>);
    expect(view.getByText('I should check the source now')).toBeTruthy();
  });

  it('keeps an earlier tool-backed answer visible while the next reply loads', () => {
    const display = getDisplayMessages([
      createMessage({ id: 'first-user', role: 'user', content: 'First question' }),
      createMessage({ id: 'first-call', role: 'assistant', content: '', reasoningContent: 'Check the source', toolCalls: [{ id: 'call-1', name: 'web_search', arguments: '{}' }] }),
      createMessage({ id: 'first-result', role: 'tool', content: 'Found it', toolCallId: 'call-1', toolName: 'web_search' }),
      createMessage({ id: 'first-answer', role: 'assistant', content: 'The first answer.' }),
      createMessage({ id: 'second-user', role: 'user', content: 'Second question' }),
    ], {
      isThinking: true, streamingMessage: '', streamingReasoningContent: '',
      isStreamingForThisConversation: true, isGeneratingForThisConversation: true,
    });
    const view = render(<View>{display.map(item => <ChatMessage key={item.id} message={item} isStreaming={item.isStreaming} />)}</View>);
    expect(view.getByText('The first answer.')).toBeTruthy();
    expect(view.getByText('How I got this')).toBeTruthy();
    expect(view.getByTestId('thinking-indicator')).toBeTruthy();
    const audioView = render(<View>{display.map(item => <MessageAudioMode
      key={item.id} msg={item} isStreamingThis={item.isStreaming === true}
      shouldAnimate={false} showGenerationDetails={false}
      onCopy={() => {}} onRetry={() => {}} onEdit={() => {}}
      onGenerateImage={() => {}} onImagePress={() => {}}
    />)}</View>);
    expect(audioView.getByTestId('audio-bubble-first-answer')).toBeTruthy();
  });

  it('shows stopped work and preserves each thinking and tool step', () => {
    const display = getDisplayMessages([
      createMessage({ id: 'user', role: 'user', content: 'Research this' }),
      createMessage({ id: 'call-1', role: 'assistant', content: 'Searching now', reasoningContent: 'Plan the search', toolCalls: [{ id: 'search', name: 'web_search', arguments: '{}' }] }),
      createMessage({ id: 'result-1', role: 'tool', content: 'Search result', toolCallId: 'search', toolName: 'web_search' }),
      createMessage({ id: 'call-2', role: 'assistant', content: '', reasoningContent: 'Check another source', toolCalls: [{ id: 'read', name: 'read_page', arguments: '{}' }] }),
      createMessage({ id: 'result-2', role: 'tool', content: 'Page result', toolCallId: 'read', toolName: 'read_page' }),
      { ...createMessage({ id: 'stopped', role: 'assistant', content: '', reasoningContent: 'Summarize findings' }), turnStatus: 'cancelled' as const },
    ], {
      isThinking: false, streamingMessage: '', streamingReasoningContent: '',
      isStreamingForThisConversation: false,
    });
    expect(display[1].timeline).toHaveLength(5);
    const view = render(<View>{display.map(item => <ChatMessage key={item.id} message={item} />)}</View>);
    expect(view.getAllByTestId('assistant-work-toggle')).toHaveLength(1);
    expect(view.getByText('Stopped')).toBeTruthy();
    fireEvent.press(view.getByTestId('assistant-work-toggle'));
    expect(view.getByText('Plan the search')).toBeTruthy();
    expect(view.getByText('Check another source')).toBeTruthy();
    expect(view.getByText('Summarize findings')).toBeTruthy();
    expect(view.getAllByText('Thought process')).toHaveLength(3);
    expect(view.getByText('Searched the web')).toBeTruthy();
    expect(view.getByTestId('tool-result-label-read_page')).toBeTruthy();
    const audioView = render(<MessageAudioMode
      msg={display[1]} isStreamingThis={false} shouldAnimate={false}
      showGenerationDetails={false} onCopy={() => {}} onRetry={() => {}}
      onEdit={() => {}} onGenerateImage={() => {}} onImagePress={() => {}}
    />);
    expect(audioView.getByText('Stopped')).toBeTruthy();
    fireEvent.press(audioView.getByTestId('assistant-work-toggle'));
    expect(audioView.getAllByText('Thought process')).toHaveLength(3);
    expect(audioView.getByText('Searched the web')).toBeTruthy();
    expect(audioView.getByTestId('tool-result-label-read_page')).toBeTruthy();
  });

  it('groups durable peer work with its live preview under one Working accordion', () => {
    const display = getDisplayMessages(
      [
        createMessage({
          id: 'peer-tool-call',
          role: 'assistant',
          content: '',
          reasoningContent: 'I am checking the live sources.',
          toolCalls: [
            {
              id: 'peer-search',
              name: 'web_search',
              arguments: '{"query":"latest news"}',
            },
          ],
        }),
        createMessage({
          id: 'peer-tool-result',
          role: 'tool',
          content: 'The first search is complete.',
          toolCallId: 'peer-search',
          toolName: 'web_search',
        }),
      ],
      {
        isThinking: false,
        streamingMessage: '',
        streamingReasoningContent: '',
        isStreamingForThisConversation: false,
        remotePreviews: [
          {
            id: 'remote-stream:peer-reply',
            messageId: 'peer-reply',
            content: '',
            reasoning: '',
            phase: 'thinking',
            deviceId: 'peer-phone',
            tools: [
              { name: 'web_search', status: 'running' },
            ],
          },
        ],
      },
    );
    const view = render(
      <View>
        {display.map(item => (
          <ChatMessage key={item.id} message={item} />
        ))}
      </View>,
    );

    expect(view.getAllByTestId('assistant-work-toggle')).toHaveLength(1);
    expect(view.getByText('Finding your answer')).toBeTruthy();
    expect(view.getByTestId('thinking-indicator')).toBeTruthy();
    expect(view.queryByText('Thinking...')).toBeNull();
    expect(view.getByText('I am checking the live sources.')).toBeTruthy();
    expect(view.getAllByText('Searched the web')).toHaveLength(1);

    view.unmount();
    const audioView = render(
      <View>
        {display.map(item => (
          <MessageAudioMode
            key={item.id}
            msg={item}
            isStreamingThis={item.isStreaming === true}
            shouldAnimate={false}
            showGenerationDetails={false}
            onCopy={() => {}}
            onRetry={() => {}}
            onEdit={() => {}}
            onGenerateImage={() => {}}
            onImagePress={() => {}}
          />
        ))}
      </View>,
    );
    expect(audioView.getByText('Finding your answer')).toBeTruthy();
    expect(audioView.getAllByText('Searched the web')).toHaveLength(1);
    expect(audioView.queryAllByTestId(/^audio-bubble-/)).toHaveLength(0);
    expect(audioView.queryByTestId('streaming-thinking-hint')).toBeNull();
  });

  it('closes failed peer work under one Could not finish accordion', () => {
    const display = getDisplayMessages(
      [
        createMessage({
          id: 'failed-tool-call',
          role: 'assistant',
          content: '',
          reasoningContent: 'I checked the request.',
          toolCalls: [
            {
              id: 'failed-search',
              name: 'web_search',
              arguments: '{"query":"latest news"}',
            },
          ],
        }),
        createMessage({
          id: 'failed-tool-result',
          role: 'tool',
          content: 'The search completed.',
          toolCallId: 'failed-search',
          toolName: 'web_search',
        }),
        {
          ...createMessage({
            id: 'failed-terminal',
            role: 'assistant',
            content: '',
          }),
          turnStatus: 'failed' as const,
        },
      ],
      {
        isThinking: false,
        streamingMessage: '',
        streamingReasoningContent: '',
        isStreamingForThisConversation: false,
      },
    );
    const view = render(
      <View>
        {display.map(item => (
          <ChatMessage key={item.id} message={item} />
        ))}
      </View>,
    );

    expect(view.getAllByTestId('assistant-work-toggle')).toHaveLength(1);
    expect(view.getByText('Could not finish')).toBeTruthy();
    expect(view.queryByText('I checked the request.')).toBeNull();
    fireEvent.press(view.getByTestId('assistant-work-toggle'));
    expect(view.getByText('I checked the request.')).toBeTruthy();
    expect(view.getByText('Searched the web')).toBeTruthy();
  });

  it('shows stopped peer work without an empty answer card', () => {
    const display = getDisplayMessages(
      [
        createMessage({
          id: 'stopped-tool-call',
          role: 'assistant',
          content: '',
          toolCalls: [
            {
              id: 'stopped-search',
              name: 'web_search',
              arguments: '{"query":"latest news"}',
            },
          ],
        }),
        createMessage({
          id: 'stopped-tool-result',
          role: 'tool',
          content: 'The search completed.',
          toolCallId: 'stopped-search',
          toolName: 'web_search',
        }),
        {
          ...createMessage({
            id: 'stopped-terminal',
            role: 'assistant',
            content: '',
          }),
          turnStatus: 'cancelled' as const,
        },
      ],
      {
        isThinking: false,
        streamingMessage: '',
        streamingReasoningContent: '',
        isStreamingForThisConversation: false,
      },
    );
    const view = render(
      <View>
        {display.map(item => (
          <ChatMessage key={item.id} message={item} />
        ))}
      </View>,
    );

    expect(view.getAllByTestId('assistant-work-toggle')).toHaveLength(1);
    expect(view.getByText('Stopped')).toBeTruthy();
    expect(view.queryByTestId('message-bubble')).toBeNull();
    expect(view.queryByTestId('message-meta-row')).toBeNull();
  });

  it('keeps an inline enhanced prompt and completed image in one result bubble', () => {
    const message = createMessage({
      role: 'assistant',
      content:
        '<think>__LABEL:Enhanced prompt__\nVibrant orange Lamborghini in the desert.</think>\n\nGenerated for: a lamborghini',
      reasoningContent: 'Vibrant orange Lamborghini in the desert.',
      timeline: [
        { kind: 'thinking', text: 'Plan the image request.' },
        { kind: 'tool', toolIndex: 0 },
        { kind: 'thinking', text: 'Verify the generated result.' },
      ],
      toolArtifacts: [
        {
          name: 'generate_image',
          result: 'Image generation started - it will appear in the chat.',
          status: 'completed',
        },
      ],
      attachments: [
        {
          id: 'lamborghini-image',
          type: 'image',
          uri: 'file:///tmp/lamborghini.png',
          width: 768,
          height: 768,
        },
      ],
    });
    const view = render(<ChatMessage message={message} />);
    const resultBubble = view.getByTestId('message-bubble');

    expect(resultBubble).toBeTruthy();
    expect(within(resultBubble).getByTestId('generated-image')).toBeTruthy();
    expect(
      within(resultBubble).getByText('Generated for: a lamborghini'),
    ).toBeTruthy();
    expect(view.getAllByTestId('assistant-work-toggle')).toHaveLength(1);
    fireEvent.press(view.getByTestId('assistant-work-toggle'));
    expect(
      view
        .getAllByText(/^(Thought process|Generated image|Enhanced prompt)$/)
        .map(node => React.Children.toArray(node.props.children).join('')),
    ).toEqual([
      'Thought process',
      'Generated image',
      'Thought process',
      'Enhanced prompt',
    ]);
  });

  it('keeps legacy peer rows coherent when no portable timeline is present', () => {
    const materializer = new MobileStateMaterializer();
    useChatStore.getState().clearAllConversations();
    materializer.put('conversation', 'synced-image-chat', {
      title: 'Synced image chat',
      created_at: '2026-09-15T02:00:00.000Z',
      updated_at: '2026-09-15T02:00:01.000Z',
      project_id: null,
    });
    materializer.put('message', 'synced-image-thinking-before', {
      conversation_id: 'synced-image-chat',
      role: 'assistant',
      content: '<think>Plan the image request.</think>',
      context: null,
      created_at: '2026-09-15T02:00:00.100Z',
    });
    materializer.put('message', 'synced-image-tool', {
      conversation_id: 'synced-image-chat',
      role: 'tool',
      content: 'Created the requested image.',
      context: JSON.stringify({
        tool: { name: 'generate_image', status: 'completed' },
      }),
      created_at: '2026-09-15T02:00:00.200Z',
    });
    materializer.put('message', 'synced-image-thinking-after', {
      conversation_id: 'synced-image-chat',
      role: 'assistant',
      content: '<think>Verify the generated result.</think>',
      context: null,
      created_at: '2026-09-15T02:00:00.300Z',
    });
    materializer.put('message', 'synced-image-prompt', {
      conversation_id: 'synced-image-chat',
      role: 'assistant',
      content:
        '<think>__LABEL:Enhanced prompt__\nA cinematic horse at sunset.</think>',
      context: null,
      created_at: '2026-09-15T02:00:00.400Z',
    });
    materializer.put('message', 'synced-image-answer', {
      conversation_id: 'synced-image-chat',
      role: 'assistant',
      content: 'Generated image for: a horse',
      context: JSON.stringify({
        toolsOffered: ['generate_image'],
        metrics: { modelName: 'Qwen3 8B', totalSeconds: 2.6 },
      }),
      created_at: '2026-09-15T02:00:01.000Z',
    });
    const messages = useChatStore
      .getState()
      .getConversationMessages('synced-image-chat');
    const display = getDisplayMessages(messages, {
      isThinking: false,
      streamingMessage: '',
      streamingReasoningContent: '',
      isStreamingForThisConversation: false,
    });
    const view = render(
      <View>
        {display.map(item => (
          <ChatMessage
            key={item.id}
            message={item}
            supportingContext={
              'supportingContext' in item ? item.supportingContext : undefined
            }
          />
        ))}
      </View>,
    );

    expect(view.getAllByTestId('assistant-work-toggle')).toHaveLength(1);
    fireEvent.press(view.getByTestId('assistant-work-toggle'));
    expect(view.getAllByText('Thought process')).toHaveLength(2);
    expect(view.getAllByText('Enhanced prompt')).toHaveLength(1);
    expect(view.getAllByText('Generated image')).toHaveLength(1);
    expect(view.getByText('Generated image for: a horse')).toBeTruthy();
    const resultBubble = view.getByTestId('message-bubble');
    expect(resultBubble).toBeTruthy();
    expect(within(resultBubble).getByTestId('message-attachments')).toBeTruthy();

    view.unmount();
    const voiceView = render(
      <View>
        {display.map(item => (
          <MessageAudioMode
            key={item.id}
            msg={item}
            supportingContext={
              'supportingContext' in item ? item.supportingContext : undefined
            }
            isStreamingThis={false}
            shouldAnimate={false}
            showGenerationDetails
            onCopy={() => {}}
            onRetry={() => {}}
            onEdit={() => {}}
            onGenerateImage={() => {}}
            onImagePress={() => {}}
          />
        ))}
      </View>,
    );

    expect(voiceView.getAllByTestId('assistant-work-toggle')).toHaveLength(1);
    fireEvent.press(voiceView.getByTestId('assistant-work-toggle'));
    expect(voiceView.getAllByText('Thought process')).toHaveLength(2);
    expect(voiceView.getAllByText('Enhanced prompt')).toHaveLength(1);
    expect(voiceView.getAllByText('Generated image')).toHaveLength(1);
    expect(voiceView.getAllByTestId('message-meta-row')).toHaveLength(1);
    expect(voiceView.getAllByTestId('tools-sent-collapsible')).toHaveLength(1);
    expect(voiceView.getAllByTestId('generation-details-toggle')).toHaveLength(
      1,
    );

    const renderedOrder = voiceView.root
      .findAll(node =>
        [
          'tool-message',
          'audio-bubble-synced-image-answer',
          'message-meta-row',
          'tools-sent-collapsible',
          'generation-details-toggle',
        ].includes(node.props.testID),
      )
      .map(node => node.props.testID)
      .filter((testID, index, all) => index === 0 || testID !== all[index - 1]);
    expect(renderedOrder).toEqual([
      'tool-message',
      'audio-bubble-synced-image-answer',
      'message-meta-row',
      'tools-sent-collapsible',
      'generation-details-toggle',
    ]);
  });

  it('keeps completed work closed while the answer and footer controls stay available', () => {
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
    const view = render(
      <ChatMessage message={message} showGenerationDetails />,
    );
    expect(view.getAllByTestId('assistant-work-toggle')).toHaveLength(1);
    expect(view.queryByTestId('thinking-block')).toBeNull();
    expect(view.getByText('The answer is ready.')).toBeTruthy();
    expect(view.getByTestId('message-meta-row')).toBeTruthy();
    expect(view.getByTestId('generation-details-toggle')).toBeTruthy();
    // The tools it was offered stay inside Details until it opens.
    expect(view.queryByTestId('tools-sent-list')).toBeNull();

    fireEvent.press(view.getByTestId('assistant-work-toggle'));
    expect(view.getByTestId('thinking-block')).toBeTruthy();
    expect(view.getAllByText('Searched the web')).toHaveLength(2);

    fireEvent.press(view.getAllByText('Searched the web')[0]);
    expect(view.getByText('First source.')).toBeTruthy();
    fireEvent.press(view.getByTestId('generation-details-toggle'));
    expect(view.getByTestId('generation-meta')).toBeTruthy();
    expect(view.getByTestId('tools-sent-list')).toHaveTextContent('Tools it had for this reply: Web search');
  });
});
