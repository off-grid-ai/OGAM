import { createChunkedStorage, type ChunkStore } from '../../../src/utils/chunkedStorage';

/** An in-memory AsyncStorage whose single-key read refuses rows over a limit, like Android's cursor window. */
function memoryStore(readLimit = Infinity, initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  const read = (key: string): string | null => {
    const value = values.get(key) ?? null;
    if (value !== null && value.length > readLimit) {
      throw new Error('Row too big to fit into CursorWindow');
    }
    return value;
  };
  const store: ChunkStore = {
    getItem: async key => read(key),
    multiGet: async keys => keys.map(key => [key, read(key)] as const),
    multiSet: async pairs => {
      for (const [key, value] of pairs) values.set(key, value);
    },
    multiRemove: async keys => {
      for (const key of keys) values.delete(key);
    },
  };
  return { store, values };
}

const LIMIT = 2 * 1024 * 1024;

describe('chunked storage', () => {
  it('reads back a chat history larger than one Android row', async () => {
    const { store, values } = memoryStore(LIMIT);
    const storage = createChunkedStorage(store);
    const history = JSON.stringify({ messages: 'x'.repeat(5 * LIMIT) });

    await storage.setItem('chat', history);

    expect([...values.values()].every(value => value.length <= LIMIT)).toBe(true);
    expect(await createChunkedStorage(store).getItem('chat')).toBe(history);
  });

  it('keeps surrogate pairs whole across parts', async () => {
    const { store, values } = memoryStore();
    const storage = createChunkedStorage(store);
    const history = `${'a'.repeat(256 * 1024 - 1)}😀${'b'.repeat(10)}`;

    await storage.setItem('chat', history);

    for (const [key, value] of values) {
      if (key === 'chat') continue;
      const last = value.charCodeAt(value.length - 1);
      expect(last >= 0xd800 && last <= 0xdbff).toBe(false);
    }
    expect(await storage.getItem('chat')).toBe(history);
  });

  it('removes parts a shorter value no longer uses', async () => {
    const { store, values } = memoryStore();
    const storage = createChunkedStorage(store);
    await storage.setItem('chat', 'x'.repeat(3 * 256 * 1024));

    await storage.setItem('chat', 'short');

    expect([...values.keys()].sort()).toEqual(['chat', 'chat::chunk:0']);
    expect(await createChunkedStorage(store).getItem('chat')).toBe('short');
  });

  it('reads a value saved by an older build as it was', async () => {
    const { store } = memoryStore(LIMIT, { chat: '{"state":{}}' });

    expect(await createChunkedStorage(store).getItem('chat')).toBe('{"state":{}}');
  });

  it('recovers an older row that outgrew the read window, then saves it in parts', async () => {
    const history = 'h'.repeat(LIMIT + 1);
    const { store, values } = memoryStore(LIMIT, { chat: history });
    const storage = createChunkedStorage(store, async key => values.get(key) ?? null);

    expect(await storage.getItem('chat')).toBe(history);
    await storage.setItem('chat', history);

    expect(await createChunkedStorage(store).getItem('chat')).toBe(history);
  });

  it('fails the read rather than return part of a history', async () => {
    const { store, values } = memoryStore();
    await createChunkedStorage(store).setItem('chat', 'x'.repeat(2 * 256 * 1024));
    values.delete('chat::chunk:1');

    await expect(createChunkedStorage(store).getItem('chat')).rejects.toThrow(/missing/);
  });
});
