import { duplicateGroups, mergeAllDuplicates, mergeGroup } from '../../src/chats/mergeDuplicates';
import type { Conversation } from '../../src/types';

const msg = (role: 'user' | 'assistant', content: string, timestamp: number) => ({ id: `${timestamp}`, role, content, timestamp } as any);
const chat = (id: string, title: string, messages: any[], extra: Partial<Conversation> = {}): Conversation =>
  ({ id, title, modelId: 'm', messages, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z', ...extra });

describe('merging chats that share a title', () => {
  const a = chat('a', 'Trip to Japan', [msg('user', 'Plan 5 days', 1), msg('assistant', 'Day 1: Tokyo', 2)]);
  const b = chat('b', 'Trip to Japan', [msg('user', 'Plan 5 days', 1), msg('assistant', 'Day 1: Tokyo', 2), msg('user', 'Add Kyoto', 3), msg('assistant', 'Day 3: Kyoto', 4)], { updatedAt: '2026-01-05T00:00:00.000Z', isPinned: true });
  const c = chat('c', 'Trip to Japan (sync conflict)', [msg('user', 'What about food?', 5)]);

  it('finds chats that share a title, ignoring sync suffixes, and leaves generic titles and locked chats alone', () => {
    const groups = duplicateGroups([a, b, c, chat('x', 'New Chat', []), chat('y', 'New Chat', []), chat('l1', 'Secret', [], { pinVerifier: 'v' }), chat('l2', 'Secret', [], { pinVerifier: 'v' })]);
    expect(groups).toHaveLength(1);
    expect(groups[0].map((x) => x.id).sort()).toEqual(['a', 'b', 'c']);
  });
  it('merges a set into one chat with every message in time order, no repeats, and the clean title', () => {
    const merged = mergeGroup([a, b, c]);
    expect(merged.id).toBe('b');
    expect(merged.title).toBe('Trip to Japan');
    expect(merged.messages.map((m) => m.content)).toEqual(['Plan 5 days', 'Day 1: Tokyo', 'Add Kyoto', 'Day 3: Kyoto', 'What about food?']);
    expect(merged.isPinned).toBe(true);
    expect(merged.updatedAt).toBe('2026-01-05T00:00:00.000Z');
  });
  it('replaces each set with one chat and leaves the others, counting what went away', () => {
    const other = chat('z', 'Recipes', [msg('user', 'hi', 1)]);
    const result = mergeAllDuplicates([a, b, c, other]);
    expect(result.merged).toBe(2);
    expect(result.chats.map((x) => x.id).sort()).toEqual(['b', 'z']);
    expect(mergeAllDuplicates([other]).merged).toBe(0);
  });
});
