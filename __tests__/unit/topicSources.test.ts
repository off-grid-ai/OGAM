import { parsePicks, passages, relevantExcerpts, pickPrompt, type CourseSource } from '../../src/topics/sources';

const source = (title: string, text: string): CourseSource => ({ id: title, title, kind: 'note', text, addedAt: 0 });

describe('topic course sources', () => {
  const ledger = source('Ledger guide', 'A debit is an entry on the left side of an account. A credit is an entry on the right side.\n\nDepreciation spreads the cost of an asset over its useful life. The straight-line method divides cost minus salvage value by the years.');
  const cooking = source('Cooking', 'Whisk the eggs until pale. Fold in the flour slowly. Bake for twenty minutes.');

  it('splits text into passages', () => {
    expect(passages('One. Two.\n\nThree.', 12)).toEqual(['One. Two.', 'Three.']);
  });
  it('finds the passages that match what a square covers, from any source, and nothing unrelated', () => {
    const found = relevantExcerpts([ledger, cooking], 'Depreciation: straight-line method for an asset');
    expect(found).toHaveLength(1);
    expect(found[0].source).toBe('Ledger guide');
    expect(found[0].text).toContain('straight-line');
    expect(relevantExcerpts([ledger, cooking], 'quantum entanglement of photons')).toEqual([]);
  });
  it('keeps the excerpts within the budget', () => {
    const big = source('Big', Array.from({ length: 20 }, (_, i) => `Debit credit account entry number ${i} with a longer sentence to take space in the text.`).join(' '));
    const total = relevantExcerpts([big], 'debit credit account entry', 500).reduce((n, e) => n + e.text.length, 0);
    expect(total).toBeLessThanOrEqual(500);
  });
  it('reads the AI picks, ignoring numbers that are not results and repeats', () => {
    expect(parsePicks('3, 1 and 9, 3', 5)).toEqual([2, 0]);
    expect(parsePicks('none', 5)).toEqual([]);
  });
  it('lists every search result by number for the AI', () => {
    const { user } = pickPrompt({ topic: 'Accounting', goal: 'read accounts', found: [{ title: 'A', snippet: 's', url: 'https://a.test' }, { title: 'B', snippet: 't', url: 'https://b.test' }] });
    expect(user).toContain('1. A');
    expect(user).toContain('2. B');
  });
});
