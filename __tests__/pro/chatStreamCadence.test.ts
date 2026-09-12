import {
  ChatStreamCadence,
  chatStreamCadenceKey,
} from '../../pro/sync/chatStreamCadence';

test('token bursts are sampled while lifecycle changes are immediate', async () => {
  const delivered: string[] = [];
  const cadence = new ChatStreamCadence(state => {
    if (state && !('completion' in state)) delivered.push(state.content);
  });
  const first = { conversationId: 'chat-1', content: 'a' };
  const second = { conversationId: 'chat-1', content: 'ab' };

  cadence.submit(first, chatStreamCadenceKey(first, 0));
  cadence.submit(second, chatStreamCadenceKey(second, 0));
  expect(delivered).toEqual(['a']);

  await new Promise(resolve => setTimeout(resolve, 70));
  expect(delivered).toEqual(['a', 'ab']);

  const changed = {
    conversationId: 'chat-1',
    content: 'ab',
    phase: 'thinking' as const,
  };
  cadence.submit(changed, chatStreamCadenceKey(changed, 0));
  expect(delivered).toEqual(['a', 'ab', 'ab']);
  cadence.stop();
});
