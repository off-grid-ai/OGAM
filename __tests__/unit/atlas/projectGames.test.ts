import {
  acronymMatches, buildCloze, buildPairs, closeEnough, hangmanGuess, hangmanStatus, layoutConceptMap,
  longestOrderedRun, shuffle, similarity, wordleFeedback,
  buildFixItems, fiftyFifty, ladderFallback, scramblePoints, scrambleWord, LADDER_PRIZES,
} from '../../../src/study/games/logic';
import { parseJsonLoose, srcList } from '../../../src/study/games/json';
import { schedule, streakFrom } from '../../../src/study/progress';

jest.mock('../../../src/study/engine', () => {
  const actual = jest.requireActual('../../../src/study/engine');
  return { __esModule: true, ...actual, askModel: jest.fn(), gatherSources: jest.fn() };
});
import * as engine from '../../../src/study/engine';
import { generateGame, PROJECT_GAMES } from '../../../src/study/games/generate';

const terms = [
  { answer: 'BACTERIA', clue: 'Tiny germs killed by boiling', src: [1] },
  { answer: 'SEDIMENT', clue: 'Dirt that settles to the bottom', src: [1] },
  { answer: 'KINDLING', clue: 'Small sticks added after tinder', src: [2] },
  { answer: 'TINDER', clue: 'Dry fluffy material that catches a spark', src: [2] },
];
const sources = [
  { n: 1, doc: 'water.md', part: 1, text: 'Boil water for one minute to kill bacteria. Let it stand so the sediment settles first. Filter cloudy water.' },
  { n: 2, doc: 'fire.md', part: 1, text: 'Put the tinder in the middle of the fire pit. Add kindling slowly once the tinder catches a spark.' },
];

describe('game logic', () => {
  it('shuffles deterministically with a seed', () => {
    expect(shuffle([1, 2, 3, 4, 5], 42)).toEqual(shuffle([1, 2, 3, 4, 5], 42));
    expect(shuffle([1, 2, 3, 4, 5], 42).sort()).toEqual([1, 2, 3, 4, 5]);
  });
  it('builds fill-the-blanks from real sentences', () => {
    const items = buildCloze(terms, sources as any, { max: 10, seed: 1 });
    expect(items.length).toBeGreaterThanOrEqual(3);
    for (const it of items) {
      expect(it.sentence).toContain('_____');
      expect(it.sentence.toUpperCase()).not.toContain(it.answer);
      expect(it.options).toContain(it.answer);
    }
  });
  it('accepts one-letter typos only on longer words', () => {
    expect(closeEnough('bacterie', 'BACTERIA')).toBe(true);
    expect(closeEnough('tindr', 'TINDER')).toBe(true);
    expect(closeEnough('cat', 'CAR')).toBe(false);
  });
  it('plays hangman', () => {
    let s = { answer: 'ABC', guessed: [] as string[], lives: 6 };
    s = hangmanGuess(s, 'a'); s = hangmanGuess(s, 'z'); s = hangmanGuess(s, 'b'); s = hangmanGuess(s, 'c');
    expect(s.lives).toBe(5);
    expect(hangmanStatus(s)).toBe('won');
  });
  it('gives Wordle feedback with repeated letters', () => {
    expect(wordleFeedback('TINDER', 'TINDER')).toBe('gggggg');
    expect(wordleFeedback('ERTIND', 'TINDER')).toBe('yyyyyy');
    expect(wordleFeedback('AABBB', 'ABCDE')).toBe('g-y--');
  });
  it('makes shuffled pairs', () => {
    const cards = buildPairs(terms, 3, 2);
    expect(cards).toHaveLength(6);
    expect(new Set(cards.map((c) => c.pair)).size).toBe(3);
  });
  it('scores ordering with partial credit', () => {
    expect(longestOrderedRun([1, 2, 3, 4])).toBe(4);
    expect(longestOrderedRun([2, 1, 3, 4])).toBe(3);
  });
  it('checks acronyms and similarity', () => {
    expect(acronymMatches('ABC', ['Airway', 'Breathing', 'Circulation'])).toBe(true);
    expect(acronymMatches('ABD', ['Airway', 'Breathing', 'Circulation'])).toBe(false);
    expect(similarity('¿Dónde está el hospital?', 'donde esta el hospital')).toBeGreaterThan(0.8);
  });
  it('lays out a concept map inside the box', () => {
    const nodes = [{ id: 'a', label: 'Water' }, { id: 'b', label: 'Boiling' }, { id: 'c', label: 'Bacteria' }, { id: 'd', label: 'Filter' }];
    const out = layoutConceptMap(nodes, [{ from: 'b', to: 'c', label: 'kills' }, { from: 'd', to: 'a', label: 'cleans' }]);
    for (const n of out) { expect(n.x).toBeGreaterThanOrEqual(0.08); expect(n.x).toBeLessThanOrEqual(0.92); }
  });
});

describe('json and progress', () => {
  it('parses messy model JSON', () => {
    expect(parseJsonLoose('Sure! ```json\n{"a": [1, 2,],}\n```')).toEqual({ a: [1, 2] });
    expect(parseJsonLoose('{statements: [1]}')).toEqual({ statements: [1] });
    expect(parseJsonLoose('no json here')).toBeNull();
    expect(srcList(['[1]', 3, 'source 9'], [1, 2, 3])).toEqual([1, 3]);
  });
  it('schedules with SM-2', () => {
    const first = schedule({ ease: 2.5, interval: 0, reps: 0 }, 'good', 0);
    expect(first.interval).toBe(1);
    const second = schedule(first, 'good', 0);
    expect(second.interval).toBe(6);
    const again = schedule(second, 'again', 0);
    expect(again.interval).toBe(0);
    expect(again.ease).toBeLessThan(second.ease);
  });
  it('counts streaks with one freeze', () => {
    expect(streakFrom(['2026-10-10', '2026-10-11', '2026-10-12'], '2026-10-13')).toBe(3);
    expect(streakFrom(['2026-10-09', '2026-10-11', '2026-10-12'], '2026-10-12')).toBe(3);
    expect(streakFrom([], '2026-10-12')).toBe(0);
  });
});

describe('generateGame (project-based)', () => {
  const ask = engine.askModel as jest.Mock;
  beforeEach(() => {
    ask.mockReset();
    (engine.gatherSources as jest.Mock).mockResolvedValue(sources);
    jest.spyOn(engine, 'termsFromSources').mockResolvedValue(terms as any);
  });
  it('lists 21 project games, including scramble, ladder and fix-the-mistake', () => {
    expect(PROJECT_GAMES).toHaveLength(21);
    expect(PROJECT_GAMES.map((g) => g.type)).toEqual(expect.arrayContaining(['scramble', 'ladder', 'mistake']));
  });
  it('builds a scramble from terms of four letters or more without a model call', async () => {
    const r = await generateGame('p1', 'scramble', { topic: '' });
    expect(r.game?.type).toBe('scramble');
    expect(r.game?.data.terms.every((t: any) => t.answer.length >= 4)).toBe(true);
    expect(ask).not.toHaveBeenCalled();
  });
  it('builds a ladder of ten rungs plus spares, easy to hard', async () => {
    ask.mockResolvedValue(JSON.stringify({ questions: Array.from({ length: 12 }, (_, i) => ({ q: `Q${i}`, options: ['right', 'w1', 'w2', 'w3'], answer: 0, why: '', src: [1], difficulty: (i % 3) + 1 })) }));
    const r = await generateGame('p1', 'ladder', { topic: '' });
    expect(r.game?.data.questions).toHaveLength(10);
    expect(r.game?.data.spares).toHaveLength(2);
    const d = r.game?.data.questions.map((q: any) => q.difficulty);
    expect(d).toEqual([...d].sort((a: number, b: number) => a - b));
  });
  it('turns false statements into pick-the-correction questions', async () => {
    ask.mockResolvedValue(JSON.stringify({ statements: [
      { text: 'Boiling takes ten hours.', true: false, fix: 'Boil for one minute.', src: [1] },
      { text: 'Kindling goes in first.', true: false, fix: 'Tinder goes in first.', src: [2] },
      { text: 'Never filter water.', true: false, fix: 'Filter cloudy water.', src: [1] },
      { text: 'Boiling kills bacteria.', true: true, fix: '', src: [1] },
    ] }));
    const r = await generateGame('p1', 'mistake', { topic: '' });
    expect(r.game?.data.items).toHaveLength(3);
    for (const it of r.game?.data.items) expect(it.options[it.answer]).toBe(it.fix);
  });
  it('builds true/false from model JSON with citations', async () => {
    ask.mockResolvedValue(JSON.stringify({ statements: [
      { text: 'Boiling kills bacteria in water.', true: true, fix: '', src: [1] },
      { text: 'Kindling goes in before tinder.', true: false, fix: 'Tinder first, then kindling.', src: [2] },
      { text: 'Sediment settles if water stands.', true: true, fix: '', src: [1] },
      { text: 'You never need to filter cloudy water.', true: false, fix: 'Filter cloudy water.', src: [9] },
    ] }));
    const r = await generateGame('p1', 'truefalse', { topic: '' });
    expect(r.kind).toBe('game');
    expect(r.game?.data.statements).toHaveLength(4);
    expect(r.game?.data.statements[3].src).toEqual([]); // invalid source number dropped
  });
  it('retries once on invalid JSON', async () => {
    ask.mockResolvedValueOnce('not json').mockResolvedValueOnce(JSON.stringify({ kind: 'steps', items: [
      { text: 'Gather tinder', order: 1, label: 'Step 1', src: [2] }, { text: 'Add kindling', order: 2, label: 'Step 2', src: [2] },
      { text: 'Add fuel', order: 3, label: 'Step 3', src: [2] }, { text: 'Keep watch', order: 4, label: 'Step 4', src: [2] },
    ] }));
    const r = await generateGame('p1', 'timeline', { topic: 'fire' });
    expect(ask).toHaveBeenCalledTimes(2);
    expect(r.game?.data.items.map((x: any) => x.order)).toEqual([1, 2, 3, 4]);
  });
  it('shuffles multiple-choice answers and keeps the right one', async () => {
    ask.mockResolvedValue(JSON.stringify({ questions: Array.from({ length: 6 }, (_, i) => ({ q: `Q${i}`, options: ['right', 'w1', 'w2', 'w3'], answer: 0, why: '', src: [1], difficulty: (i % 3) + 1 })) }));
    const r = await generateGame('p1', 'boss', { topic: '' });
    for (const q of r.game?.data.questions) expect(q.options[q.answer]).toBe('right');
  });
  it('builds pairs, cloze and hangman from grounded terms without extra calls', async () => {
    for (const type of ['pairs', 'cloze', 'hangman'] as const) {
      const r = await generateGame('p1', type, { topic: '' });
      expect(r.game?.type).toBe(type);
    }
    expect(ask).not.toHaveBeenCalled();
  });
  it('refuses a podcast quiz when the project has no podcast', async () => {
    await expect(generateGame('empty-project', 'podcastquiz', { topic: '' })).rejects.toThrow(/podcast/i);
  });
});

describe('quick games logic', () => {
  it('scrambles a word into another order, deterministically', () => {
    for (const w of ['BACTERIA', 'TINDER', 'AB', 'ABBA']) {
      const out = scrambleWord(w, 5);
      expect(out).not.toBe(w);
      expect([...out].sort().join('')).toBe([...w].sort().join(''));
      expect(scrambleWord(w, 5)).toBe(out);
    }
    expect(scrambleWord('AAAA')).toBe('AAAA'); // cannot differ
    expect(scramblePoints(false)).toBe(2);
    expect(scramblePoints(true)).toBe(1);
  });

  it('drops to the last safe prize, never below it', () => {
    expect(ladderFallback(0)).toBe(0);
    expect(ladderFallback(4)).toBe(0); // wrong on the 5th rung: nothing banked yet
    expect(ladderFallback(5)).toBe(LADDER_PRIZES[4]);
    expect(ladderFallback(9)).toBe(LADDER_PRIZES[4]);
  });

  it('50:50 hides two wrong options and never the answer', () => {
    for (let a = 0; a < 4; a++) {
      const hidden = fiftyFifty(4, a, 9);
      expect(hidden).toHaveLength(2);
      expect(hidden).not.toContain(a);
    }
    expect(fiftyFifty(3, 0, 1)).toHaveLength(1); // always leaves a wrong option next to the answer
  });

  it('needs three false statements to build corrections, and keeps the right fix among the options', () => {
    const st = (text: string, isTrue: boolean, fix: string) => ({ text, isTrue, fix, src: [1] });
    expect(buildFixItems([st('a', false, 'fix one'), st('b', false, 'fix two'), st('c', true, '')])).toEqual([]);
    const items = buildFixItems([st('a', false, 'fix one'), st('b', false, 'fix two'), st('c', false, 'fix three'), st('d', false, 'fix four')]);
    expect(items).toHaveLength(4);
    for (const it of items) { expect(it.options[it.answer]).toBe(it.fix); expect(new Set(it.options).size).toBe(it.options.length); }
  });
});
