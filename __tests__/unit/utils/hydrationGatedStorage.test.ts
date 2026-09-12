import type { StateStorage } from 'zustand/middleware';
import { createHydrationGatedStorage } from '../../../src/utils/hydrationGatedStorage';

type StoredState = {
  conversations: readonly { id: string }[];
  activeConversationId: string | null;
  streamingMessage?: string;
};

test('ephemeral stream changes do not rewrite durable chat storage', async () => {
  let raw = JSON.stringify({
    state: { conversations: [{ id: 'chat-1' }], activeConversationId: 'chat-1' },
    version: 1,
  });
  let writes = 0;
  const base: StateStorage = {
    getItem: async () => raw,
    setItem: async (_name, value) => {
      writes += 1;
      raw = value;
    },
    removeItem: async () => undefined,
  };
  const gated = createHydrationGatedStorage<StoredState>(
    base,
    (previous, next) =>
      previous.conversations === next.conversations &&
      previous.activeConversationId === next.activeConversationId,
  );
  const loaded = await gated.storage.getItem('chat');
  gated.markHydrated();
  const durable = loaded!.state;

  await gated.storage.setItem('chat', {
    state: { ...durable, streamingMessage: 'one token' },
    version: 1,
  });
  expect(writes).toBe(0);

  await gated.storage.setItem('chat', {
    state: {
      ...durable,
      conversations: [...durable.conversations, { id: 'chat-2' }],
    },
    version: 1,
  });
  expect(writes).toBe(1);
});
