import { superscript, citedNumbers, markSources, sourcesBefore } from '../../src/study/replySources';

const search = [
  'Results from Brave:', '',
  '1. [Tax deadlines](https://irs.example/deadlines)', '   Returns are due April 15.',
  '2. [Penalties](https://irs.example/penalties)', '   The late fee is 5% a month.',
].join('\n');

describe('source numbers in a reply', () => {
  it('writes numbers as raised digits', () => {
    expect(superscript(1)).toBe('¹');
    expect(superscript(12)).toBe('¹²');
  });
  it('finds the numbers a reply cites, ignoring links and numbers beyond the sources', () => {
    expect(citedNumbers('Due April 15 [1]. Fee is 5% [2][1]. See [3] and [link](https://x.test) and [1](u).', 2)).toEqual([1, 2]);
    expect(citedNumbers('No citations here.', 5)).toEqual([]);
    expect(citedNumbers('A list [0] and [7]', 3)).toEqual([]);
  });
  it('shows each citation as a small raised number and leaves other brackets alone', () => {
    expect(markSources('Due April 15 [1]. Fee 5% [2]. Array [9] and [text](https://x.test).', 2)).toBe('Due April 15¹. Fee 5%². Array [9] and [text](https://x.test).');
  });
  it('changes nothing when there are no sources', () => expect(markSources('Look at [1].', 0)).toBe('Look at [1].'));

  const messages = [
    { id: 'u1', role: 'user', content: 'When are taxes due?' },
    { id: 't1', role: 'tool', toolName: 'web_search', content: search },
    { id: 'a1', role: 'assistant', content: 'Due April 15 [1].' },
    { id: 'u2', role: 'user', content: 'thanks' },
    { id: 'a2', role: 'assistant', content: 'You are welcome [1].' },
  ];
  it('takes the sources from the search that led to the reply', () => {
    const s = sourcesBefore(messages, 'a1');
    expect(s.map((c) => c.title)).toEqual(['Tax deadlines', 'Penalties']);
  });
  it('does not reach back past the user message before the reply', () => {
    expect(sourcesBefore(messages, 'a2')).toEqual([]);
  });
});

import { sourcesFromChunks, setTurnSources, turnSources } from '../../src/services/rag/turnSources';
describe('document excerpts as numbered sources', () => {
  it('numbers the excerpts in the order the prompt shows them', () => {
    const s = sourcesFromChunks([{ name: 'tax-guide.pdf', position: 2, content: 'Returns   are due\nApril 15.' }, { name: 'penalties.md', position: 0, content: 'x'.repeat(500) }]);
    expect(s[0]).toEqual({ title: 'tax-guide.pdf (part 3)', quote: 'Returns are due April 15.' });
    expect(s[1].quote).toHaveLength(200);
  });
  it('remembers which project document an excerpt came from, so it can be opened', () => {
    const s = sourcesFromChunks([{ name: 'tax-guide.pdf', position: 0, content: 'x' }, { name: 'gone.md', position: 1, content: 'y' }], [{ name: 'tax-guide.pdf', path: '/docs/tax-guide.pdf', size: 900 }]);
    expect(s[0].file).toEqual({ path: '/docs/tax-guide.pdf', name: 'tax-guide.pdf', size: 900 });
    expect(s[1].file).toBeUndefined();
  });
  it('keeps the latest turn sources until they are replaced', () => {
    setTurnSources([{ title: 'a', quote: 'q' }]);
    expect(turnSources()).toHaveLength(1);
    setTurnSources([]);
    expect(turnSources()).toEqual([]);
  });
});
