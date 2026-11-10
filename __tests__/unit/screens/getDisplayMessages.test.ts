import { getDisplayMessages } from '../../../src/screens/ChatScreen/types';
import { Message } from '../../../src/types';

const base = (): StreamingArg => ({
  isThinking: false,
  streamingMessage: '',
  streamingReasoningContent: '',
  isStreamingForThisConversation: false,
});
type StreamingArg = Parameters<typeof getDisplayMessages>[1];

const msgs: Message[] = [
  { id: 'u1', role: 'user', content: 'hi', timestamp: 1 } as Message,
];

describe('getDisplayMessages', () => {
  it('shows a "Loading <model>" bubble while the model loads for this reply', () => {
    const out = getDisplayMessages(msgs, {
      ...base(),
      isModelLoading: true,
      loadingModelName: 'Qwen3.5-0.8B',
      isGeneratingForThisConversation: true,
    });
    const last = out[out.length - 1] as any;
    expect(last.id).toBe('thinking');
    expect(last.isThinking).toBe(true);
    expect(last.content).toBe('Loading Qwen3.5-0.8B...');
  });

  it('falls back to "Loading model..." when the name is unknown', () => {
    const out = getDisplayMessages(msgs, {
      ...base(),
      isModelLoading: true,
      isGeneratingForThisConversation: true,
    });
    expect((out[out.length - 1] as any).content).toBe('Loading model...');
  });

  it('does NOT show the loading bubble when the load is not for this conversation', () => {
    const out = getDisplayMessages(msgs, {
      ...base(),
      isModelLoading: true,
      loadingModelName: 'X',
      isGeneratingForThisConversation: false,
    });
    expect(out).toHaveLength(msgs.length);
  });

  it('shows a bare thinking bubble (no loading text) once generating', () => {
    const out = getDisplayMessages(msgs, {
      ...base(),
      isThinking: true,
      isStreamingForThisConversation: true,
    });
    const last = out[out.length - 1] as any;
    expect(last.id).toBe('thinking');
    expect(last.content).toBe('');
  });

  it('shows the streaming bubble once tokens arrive', () => {
    const out = getDisplayMessages(msgs, {
      ...base(),
      streamingMessage: 'hello',
      isStreamingForThisConversation: true,
    });
    const last = out[out.length - 1] as any;
    expect(last.id).toBe('streaming');
    expect(last.content).toBe('hello');
  });

  it('loading bubble yields to streaming once tokens exist', () => {
    const out = getDisplayMessages(msgs, {
      ...base(),
      isModelLoading: true,
      isGeneratingForThisConversation: true,
      streamingMessage: 'partial',
      isStreamingForThisConversation: true,
    });
    expect((out[out.length - 1] as any).id).toBe('streaming');
  });

  it('keeps remote thought and text while a generated image is loading', () => {
    const out = getDisplayMessages(msgs, {
      ...base(),
      remotePreviews: [
        {
          id: 'remote-image-turn',
          messageId: 'message-1',
          deviceId: 'the-mac',
          content: 'I will make that image.',
          reasoning: 'I should use the image tool.',
          phase: 'generating_image',
          progress: { current: 3, total: 8 },
        },
      ],
    });

    expect(out.at(-1)).toMatchObject({
      content: 'I will make that image.',
      reasoningContent: 'I should use the image tool.',
      statusText: 'Generating image... 3/8',
      isStreaming: true,
    });
  });

  it('shows the image-model loader without replacing remote thought or text', () => {
    const out = getDisplayMessages(msgs, {
      ...base(),
      remotePreviews: [
        {
          id: 'remote-image-turn',
          messageId: 'message-1',
          deviceId: 'the-mac',
          content: 'I will make that image.',
          reasoning: 'I should use the image tool.',
          phase: 'loading_image_model',
        },
      ],
    });

    expect(out.at(-1)).toMatchObject({
      content: 'I will make that image.',
      reasoningContent: 'I should use the image tool.',
      statusText: 'Loading image model...',
      isStreaming: true,
    });
  });

  it('projects a peer loading its TEXT model as status, not as "Preparing reply..."', () => {
    // The phone says "Loading Qwen3.5 2B" for tens of seconds before it can write a word. That state
    // had no phase, so the frame fell through to `waiting` and this device told the user the peer
    // was "Preparing reply..." for the whole wait - the one part of a slow reply worth explaining.
    const out = getDisplayMessages(msgs, {
      ...base(),
      remotePreviews: [
        {
          id: 'remote-text-turn',
          messageId: 'message-1',
          deviceId: 'the-phone',
          content: '',
          phase: 'loading_model',
        },
      ],
    });

    expect(out.at(-1)).toMatchObject({
      statusText: 'Loading model...',
      suppressMessageBubble: true,
      isStreaming: true,
    });
  });

  it('projects a lifecycle-only remote image frame as status without a sentinel bubble', () => {
    const out = getDisplayMessages(msgs, {
      ...base(),
      remotePreviews: [
        {
          id: 'remote-image-turn',
          messageId: 'message-1',
          deviceId: 'the-mac',
          content: ' - ',
          phase: 'loading_image_model',
        },
      ],
    });

    expect(out.at(-1)).toMatchObject({
      statusText: 'Loading image model...',
      suppressMessageBubble: true,
      isStreaming: true,
    });
  });

  it('projects a remote tool as soon as its running frame arrives', () => {
    const out = getDisplayMessages(msgs, {
      ...base(),
      remotePreviews: [
        {
          id: 'remote-tool-turn',
          messageId: 'message-1',
          deviceId: 'the-mac',
          content: 'I will make that image.',
          phase: 'answering',
          tools: [{ name: 'generate_image', status: 'running' }],
        },
      ],
    });

    expect(out.at(-1)).toMatchObject({
      content: 'I will make that image.',
      isStreaming: true,
      toolArtifacts: [
        { name: 'generate_image', result: '', status: 'running' },
      ],
    });
  });

  it('keeps a peer\'s tool calls on the live preview until the durable answer replaces it', () => {
    const out = getDisplayMessages(msgs, {
      ...base(),
      remotePreviews: [
        {
          id: 'remote-tools-turn',
          messageId: 'message-1',
          deviceId: 'the-phone',
          content: '',
          phase: 'thinking',
          tools: [
            { name: 'search_knowledge_base', result: 'Found it.', status: 'completed' },
            { name: 'web_search', result: 'Found more.', status: 'completed' },
          ],
        },
      ],
    });

    expect(out.at(-1)?.toolArtifacts).toEqual([
      { name: 'search_knowledge_base', result: 'Found it.', status: 'completed' },
      { name: 'web_search', result: 'Found more.', status: 'completed' },
    ]);
  });

  it('removes a remote preview when its durable message is visible', () => {
    const durableMessage = {
      id: 'local-record-id',
      uuid: 'remote-message-id',
      role: 'assistant',
      content: 'The complete reply.',
      timestamp: 2,
    } as Message;

    const out = getDisplayMessages([...msgs, durableMessage], {
      ...base(),
      remotePreviews: [
        {
          id: 'remote-stream:remote-message-id',
          messageId: 'remote-message-id',
          deviceId: 'the-iphone',
          content: 'The complete reply.',
          phase: 'answering',
        },
      ],
    });

    expect(out).toHaveLength(2);
    expect(out.at(-1)).toBe(durableMessage);
  });

  it('removes the same remote answer when an older sender used a different preview id', () => {
    const durableMessage = {
      id: 'local-record-id',
      uuid: 'durable-message-id',
      role: 'assistant',
      content: 'The complete reply.',
      timestamp: 2,
      provenance: {
        originDeviceId: 'the-iphone',
        originDeviceName: 'iPhone',
      },
    } as Message;

    const out = getDisplayMessages([...msgs, durableMessage], {
      ...base(),
      remotePreviews: [
        {
          id: 'remote-stream:legacy-preview-id',
          messageId: 'legacy-preview-id',
          deviceId: 'the-iphone',
          content: 'The complete reply.',
          phase: 'answering',
        },
      ],
    });

    expect(out).toHaveLength(2);
    expect(out.at(-1)).toBe(durableMessage);
  });
});

describe('getDisplayMessages tool pairing', () => {
  const settled = (): StreamingArg => base();

  it('pairs a result with its call when the parsed call has no id (one search, one row)', () => {
    const out = getDisplayMessages([
      { id: 'u', role: 'user', content: '[test] trail', timestamp: 1 } as Message,
      { id: 'c', role: 'assistant', content: '', timestamp: 2, toolCalls: [{ name: 'web_search', arguments: '{"query":"trail"}' }] } as Message,
      { id: 'r', role: 'tool', content: 'Sinhagad Fort', timestamp: 3, toolName: 'web_search' } as Message,
      { id: 'a', role: 'assistant', content: 'Try Sinhagad.', timestamp: 4 } as Message,
    ], settled());
    const answer = out[1] as Message;
    expect(answer.toolArtifacts).toHaveLength(1);
    expect(answer.toolArtifacts![0]).toMatchObject({ name: 'web_search', result: 'Sinhagad Fort', status: 'completed' });
    expect(answer.timeline!.filter(entry => entry.kind === 'tool')).toHaveLength(1);
  });

  it('pairs two id-less searches in order', () => {
    const out = getDisplayMessages([
      { id: 'u', role: 'user', content: '[test] two', timestamp: 1 } as Message,
      { id: 'c1', role: 'assistant', content: '', timestamp: 2, toolCalls: [{ name: 'web_search', arguments: '{"query":"a"}' }] } as Message,
      { id: 'r1', role: 'tool', content: 'first', timestamp: 3, toolName: 'web_search' } as Message,
      { id: 'c2', role: 'assistant', content: '', timestamp: 4, toolCalls: [{ name: 'web_search', arguments: '{"query":"b"}' }] } as Message,
      { id: 'r2', role: 'tool', content: 'second', timestamp: 5, toolName: 'web_search' } as Message,
      { id: 'a', role: 'assistant', content: 'Done.', timestamp: 6 } as Message,
    ], settled());
    const artifacts = (out[1] as Message).toolArtifacts!;
    expect(artifacts.map(artifact => artifact.result)).toEqual(['first', 'second']);
  });

  it('a result for a call id already answered starts its own row', () => {
    const out = getDisplayMessages([
      { id: 'u', role: 'user', content: '[test] dup', timestamp: 1 } as Message,
      { id: 'c', role: 'assistant', content: '', timestamp: 2, toolCalls: [{ id: 'x', name: 'calculator', arguments: '{}' }] } as Message,
      { id: 'r1', role: 'tool', content: '4', timestamp: 3, toolCallId: 'x', toolName: 'calculator' } as Message,
      { id: 'r2', role: 'tool', content: '5', timestamp: 4, toolCallId: 'x', toolName: 'calculator' } as Message,
      { id: 'a', role: 'assistant', content: 'Done.', timestamp: 5 } as Message,
    ], settled());
    expect((out[1] as Message).toolArtifacts!.map(artifact => artifact.result)).toEqual(['4', '5']);
  });
});
