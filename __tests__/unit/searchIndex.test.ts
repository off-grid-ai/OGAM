import { searchEverything, type SearchData } from '../../src/search/searchIndex';

const data: SearchData = {
  conversations: [
    { id: 'c1', title: 'Trip to Madrid', messages: [{ role: 'user', content: 'Plan three days in Madrid' }, { role: 'assistant', content: 'Day 1: the Prado museum' }] },
    { id: 'c2', title: 'Recipes', messages: [{ role: 'user', content: 'How long do I bake sourdough?' }] },
    { id: 'c3', title: 'Secret madrid plans', messages: [{ role: 'user', content: 'madrid' }], pinVerifier: 'x' },
  ],
  projects: [
    { id: 'p1', name: 'Chemistry', description: 'Notes for the exam' },
    { id: 'spanish-learning', name: 'Learn a language', description: 'Lessons', course: 'language' },
  ],
  models: [{ id: 'm1', name: 'Qwen 3.5 4B Q4_0' }],
};

describe('search everything', () => {
  it('finds settings pages by the words people use for them', () => {
    expect(searchEverything('dark mode', data)[0]).toMatchObject({ kind: 'screen', route: 'Appearance' });
    expect(searchEverything('delete files', data).map((h) => h.route)).toContain('StorageSettings');
    expect(searchEverything('pin', data).map((h) => h.route)).toContain('SecuritySettings');
    expect(searchEverything('threads', data).map((h) => h.route)).toContain('ModelSettings');
  });

  it('finds chats by title or by what was said, with the words around the match, and skips locked chats', () => {
    const hits = searchEverything('madrid', data).filter((h) => h.kind === 'chat');
    expect(hits.map((h) => h.id)).toEqual(['c1']);
    const said = searchEverything('sourdough', data).find((h) => h.kind === 'chat')!;
    expect(said.id).toBe('c2');
    expect(said.detail).toMatch(/sourdough/);
    expect(said.params).toEqual({ conversationId: 'c2' });
  });

  it('finds projects and models, never the hidden course project, and ignores very short queries', () => {
    expect(searchEverything('chem', data).find((h) => h.kind === 'project')?.route).toBe('ProjectDetail');
    expect(searchEverything('learn a language', data).some((h) => h.kind === 'project')).toBe(false);
    expect(searchEverything('qwen', data).find((h) => h.kind === 'model')?.params).toEqual({ modelId: 'm1' });
    expect(searchEverything('m', data)).toEqual([]);
    expect(searchEverything('  ', data)).toEqual([]);
  });

  it('puts a title match ahead of a keyword match, and ignores accents and capitals', () => {
    expect(searchEverything('APPEARANCE', data)[0].route).toBe('Appearance');
    expect(searchEverything('cafe', { ...data, conversations: [{ id: 'c9', title: 'Café plans', messages: [] }] }).some((h) => h.id === 'c9')).toBe(true);
  });
});
