import { buildLesson, type Item } from '../../../src/language/lessons';
import { partItems } from '../../../src/language/board';

const sentence = (n: number): Item => ({ en: `Sentence ${n}`, t: `Esta es la frase número ${n}` });
const word = (n: number): Item => ({ en: `word ${n}`, t: `palabra${n}` });
const shown = (ex: any) => ex.item?.t as string | undefined;

describe('lesson variety', () => {
  const items = [...Array.from({ length: 6 }, (_, i) => word(i)), ...Array.from({ length: 6 }, (_, i) => sentence(i))];

  it('goes through all six sentences, and never shows the same sentence twice in a row', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const list = buildLesson(items, seed, { length: 14, production: 0.3 }).filter((e) => e.kind !== 'match');
      const shownItems = list.map(shown);
      shownItems.slice(1).forEach((t, i) => expect(t).not.toBe(shownItems[i]));
      const phrases = new Set(shownItems.filter((t) => t?.startsWith('Esta es')));
      expect(phrases.size).toBeGreaterThanOrEqual(5);
    }
  });

  it('gives every part of a unit all of its sentences, and shares the single words between the parts', () => {
    const first = partItems(items, 1, 2);
    const second = partItems(items, 2, 2);
    for (const part of [first, second]) expect(part.filter((x) => x.t.startsWith('Esta es'))).toHaveLength(6);
    expect(first.some((x) => x.t === 'palabra0')).toBe(true);
    expect(first.some((x) => x.t === 'palabra5')).toBe(false);
  });
});
