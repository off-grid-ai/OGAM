import { needsReadingInParts, partChars, splitIntoParts, readInParts, MAX_PARTS } from '../../src/services/readInParts';

const para = (k: number) => `Paragraph ${k}. ${'word '.repeat(60)}`;

describe('reading a very long message in parts', () => {
  it('is needed only when the message would take most of the context', () => {
    expect(needsReadingInParts('short question', 4096)).toBe(false);
    expect(needsReadingInParts('x'.repeat(5000), 4096)).toBe(false);
    expect(needsReadingInParts('x'.repeat(9000), 4096)).toBe(true);
  });
  it('cuts at paragraph breaks and keeps every part within the limit', () => {
    const text = Array.from({ length: 30 }, (_, i) => para(i)).join('\n\n');
    const parts = splitIntoParts(text, 1500);
    expect(parts.length).toBeGreaterThan(3);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(1500);
    expect(parts.join(' ').replace(/\s+/g, ' ').trim()).toBe(text.replace(/\s+/g, ' ').trim());
    expect(parts.slice(0, -1).every((p) => /word$|\.$/.test(p))).toBe(true);
  });
  it('splits a text with no breaks at the limit', () => {
    expect(splitIntoParts('a'.repeat(3500), 1500).map((p) => p.length)).toEqual([1500, 1500, 500]);
  });

  it('returns null for a message that fits', async () => {
    const ask = jest.fn();
    expect(await readInParts({ text: 'short', contextTokens: 4096, ask })).toBeNull();
    expect(ask).not.toHaveBeenCalled();
  });
  it('keeps the start and end, adds notes for each part, and reports progress', async () => {
    const text = `START REQUEST: summarise the budget\n\n${Array.from({ length: 20 }, (_, i) => para(i)).join('\n\n')}\n\nEND: answer in two lines`;
    const seen: string[] = [];
    const progress: Array<[number, number]> = [];
    const out = await readInParts({
      text, contextTokens: 2048,
      ask: async (_s, user) => { seen.push(user); return /PART 2 OF/.test(user) ? 'nothing relevant' : `notes ${seen.length}`; },
      onProgress: (d, t) => progress.push([d, t]),
    });
    expect(out).toContain('START REQUEST: summarise the budget');
    expect(out).toContain('END: answer in two lines');
    expect(out).toMatch(/read the rest of this long message in \d+ parts/);
    expect(out).toContain('Part 1: notes 1');
    expect(out).not.toContain('Part 2:'); // "nothing relevant" is left out
    expect(seen.every((u) => u.includes('START REQUEST') && u.includes('END: answer in two lines'))).toBe(true); // each part sees the request
    expect(progress.at(-1)).toEqual([progress.at(-1)![1], progress.at(-1)![1]]);
    expect(out!.length).toBeLessThan(text.length / 2);
  });
  it('reads at most the cap and says how many parts were left out', async () => {
    const text = 'y'.repeat(partChars(2048) * (MAX_PARTS + 5) + 1200);
    const out = await readInParts({ text, contextTokens: 2048, ask: async () => 'a note' });
    expect(out).toMatch(/\d+ more parts were too much to read/);
  });
  it('gives up (null) when stopped', async () => {
    const text = 'z'.repeat(20000);
    expect(await readInParts({ text, contextTokens: 2048, ask: async () => 'n', shouldStop: () => true })).toBeNull();
  });
});
