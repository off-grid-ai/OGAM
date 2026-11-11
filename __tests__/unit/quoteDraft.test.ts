import { quoteForAsk } from '../../src/utils/quoteDraft';

describe('quoting a reply into a question', () => {
  it('marks each line as a quote and leaves a blank line to type under', () => {
    expect(quoteForAsk('One.\n\nTwo.')).toBe('> One.\n>\n> Two.\n\n');
  });
  it('cuts a long reply at a word and says so', () => {
    const q = quoteForAsk('word '.repeat(200), 50);
    expect(q.length).toBeLessThan(70);
    expect(q).toMatch(/\.\.\.\n\n$/);
  });
  it('gives nothing for an empty reply', () => expect(quoteForAsk('  ')).toBe(''));
});
