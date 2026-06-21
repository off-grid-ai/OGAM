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
    const out = getDisplayMessages(msgs, { ...base(), isThinking: true, isStreamingForThisConversation: true });
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
});
