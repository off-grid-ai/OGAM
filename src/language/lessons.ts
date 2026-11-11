/**
 * Building a lesson from a unit's words, Duolingo-style. Following the course method
 * (teaching.ts), a lesson starts with recognising (pick, listen, match, true or false) and
 * moves to producing (put words in order, type the translation, type what you hear); higher
 * levels produce more. Pure, so it is tested without a device.
 */
export interface Item { en: string; t: string; r?: string }

type BaseExercise =
  | { kind: 'choose'; item: Item; options: string[]; answer: string }
  | { kind: 'meaning'; item: Item; options: string[]; answer: string }
  | { kind: 'listen'; item: Item; options: string[]; answer: string }
  | { kind: 'match'; pairs: Item[] }
  | { kind: 'build'; item: Item; tiles: string[]; answer: string }
  /** Hear a phrase, then tap its words in order (Duolingo's "tap what you hear"). */
  | { kind: 'hear'; item: Item; tiles: string[]; answer: string }
  /** A phrase with one word missing: pick the word that goes in the gap. */
  | { kind: 'blank'; item: Item; shown: string; options: string[]; answer: string }
  /** Type the translation of an English word or sentence. */
  | { kind: 'type'; item: Item; answer: string }
  /** Hear it and type it (dictation). */
  | { kind: 'dictation'; item: Item; answer: string }
  /** Put the letters of a word in order. */
  | { kind: 'scramble'; item: Item; tiles: string[]; answer: string }
  /** Does this sentence mean that? True or false. */
  | { kind: 'truefalse'; item: Item; shownMeaning: string; options: string[]; answer: string }
  /** Say it out loud: the phone's speech recognizer hears it. */
  | { kind: 'speak'; item: Item; answer: string };

/** `again`: a missed exercise repeated at the end of the lesson (not scored a second time). */
export type Exercise = BaseExercise & { again?: boolean };

/** A missed exercise comes back once at the end, as in Duolingo; speed rounds and repeats do not. */
export const repeatMissed = (list: Exercise[], ex: Exercise, gotIt: boolean): Exercise[] =>
  (gotIt || ex.again ? list : [...list, { ...ex, again: true }]);

/** Exercises that count towards the score (repeats do not). */
export const scored = (list: Exercise[]) => list.filter((e) => !e.again).length;

/** Small seeded random so a lesson can be rebuilt the same way in tests. */
export function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}
const shuffle = <T,>(a: T[], r: () => number): T[] => {
  const out = [...a];
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
};
/** How alike two answers look (same start, similar length): harder distractors look like the answer. */
const alike = (a: string, b: string) =>
  (a[0]?.toLowerCase() === b[0]?.toLowerCase() ? 2 : 0) - Math.abs(a.length - b.length) / Math.max(a.length, 1);

/**
 * The right answer among `wrong` distractors. With `hard`, distractors that look like the
 * answer are picked first, so recognising it takes real knowledge, not a lucky guess.
 */
const options = (right: string, pool: string[], o: { r: () => number; wrong?: number; hard?: boolean }) => {
  const { r } = o;
  const others = shuffle([...new Set(pool.filter((p) => p !== right))], r);
  const picked = o.hard ? others.sort((a, b) => alike(b, right) - alike(a, right)) : others;
  return shuffle([right, ...picked.slice(0, o.wrong ?? 3)], r);
};

/** Words of a phrase for the word-order exercise (punctuation kept on its word). */
export const words = (t: string) => t.split(/\s+/).filter(Boolean);

/** The phrase with one word replaced by a gap, and the missing word. */
export function blankOut(t: string, r: () => number): { shown: string; answer: string } | null {
  const w = words(t);
  const candidates = w.map((x, i) => ({ x, i })).filter(({ x }) => x.replace(/[.!?¡¿,]/g, '').length > 1);
  if (w.length < 3 || !candidates.length) return null;
  const pick = candidates[Math.floor(r() * candidates.length)];
  const answer = pick.x.replace(/[.!?¡¿,]/g, '');
  return { shown: w.map((x, i) => (i === pick.i ? x.replace(answer, '____') : x)).join(' '), answer };
}

type Kind = Exercise['kind'];
const RECOGNISE: Kind[] = ['choose', 'meaning', 'listen', 'blank', 'truefalse', 'scramble'];
const PRODUCE: Kind[] = ['build', 'hear', 'type', 'dictation'];
/** With a speech recognizer, speaking takes a turn among the producing games. */
const PRODUCE_SPEAKING: Kind[] = ['build', 'speak', 'hear', 'type', 'dictation'];
/** Phrase-only kinds fall back for single words, and the letter scramble for phrases. */
const FALLBACK: Partial<Record<Kind, Kind>> = { build: 'type', hear: 'dictation', blank: 'meaning' };
const needsPhrase = (k: Kind) => k === 'build' || k === 'hear' || k === 'blank';
const isWord = (it: Item) => words(it.t).length === 1 && it.t.replace(/[^\p{L}]/gu, '').length >= 4;

/** How hard a lesson is: wrong choices offered, look-alike distractors, extra word tiles. */
export interface Difficulty { wrong: number; hard: boolean; extraTiles: number }
export const EASY: Difficulty = { wrong: 3, hard: false, extraTiles: 2 };
/** By CEFR level (1 = A1 .. 6 = C2): more and closer choices, more words that do not belong. */
export const difficultyFor = (level: number): Difficulty =>
  ({ wrong: level <= 1 ? 3 : level <= 3 ? 4 : 5, hard: level >= 2, extraTiles: level <= 1 ? 2 : level <= 3 ? 3 : 4 });

function exerciseFor(kind: Kind, item: Item, ctx: { items: Item[]; r: () => number; d: Difficulty }): Exercise {
  const { items, r, d } = ctx;
  const long = words(item.t).length >= 3;
  let k = needsPhrase(kind) && !long ? FALLBACK[kind]! : kind;
  if (k === 'scramble' && !isWord(item)) k = 'listen';
  if (k === 'build' || k === 'hear') {
    // A few extra words from the other items, so it cannot be solved by using every tile.
    const own = new Set(words(item.t).map((w) => w.toLowerCase()));
    const extra = shuffle([...new Set(items.filter((x) => x !== item).flatMap((x) => words(x.t)))].filter((w) => !own.has(w.toLowerCase())), r)
      .slice(0, Math.min(d.extraTiles + 1, Math.max(d.extraTiles, Math.round(words(item.t).length / 2))));
    return { kind: k, item, tiles: shuffle([...words(item.t), ...extra], r), answer: item.t };
  }
  if (k === 'type' || k === 'dictation' || k === 'speak') return { kind: k, item, answer: item.t };
  if (k === 'scramble') {
    const letters = [...item.t.replace(/[.!?¡¿,]/g, '')];
    let tiles = shuffle(letters, r);
    for (let n = 0; n < 5 && tiles.join('') === letters.join(''); n++) tiles = shuffle(letters, r);
    return { kind: 'scramble', item, tiles, answer: letters.join('') };
  }
  if (k === 'truefalse') {
    const other = items.filter((x) => x.en !== item.en);
    const honest = !other.length || r() < 0.5;
    return { kind: 'truefalse', item, shownMeaning: honest ? item.en : other[Math.floor(r() * other.length)].en, options: ['True', 'False'], answer: honest ? 'True' : 'False' };
  }
  if (k === 'blank') {
    const b = blankOut(item.t, r);
    if (b) {
      const pool = items.flatMap((x) => words(x.t)).map((x) => x.replace(/[.!?¡¿,]/g, '')).filter((x) => x.length > 1);
      return { kind: 'blank', item, shown: b.shown, options: options(b.answer, [...new Set(pool)], { r, ...d }), answer: b.answer };
    }
    return exerciseFor('meaning', item, ctx);
  }
  if (k === 'meaning') return { kind: k, item, options: options(item.en, items.map((x) => x.en), { r, ...d }), answer: item.en };
  return { kind: k as 'choose' | 'listen', item, options: options(item.t, items.map((x) => x.t), { r, ...d }), answer: item.t };
}

/** The kinds for a lesson of `length` exercises: recognition first, then production. */
function planKinds(length: number, { production, speaking }: { production?: number; speaking?: boolean }): Kind[] {
  const nProduce = production === 0 ? 0 : Math.max(2, Math.round((length - 1) * (production ?? 0.2)));
  const produce = speaking ? PRODUCE_SPEAKING : PRODUCE;
  return Array.from({ length: length - 1 }, (_, i) =>
    (i < length - 1 - nProduce ? RECOGNISE[i % RECOGNISE.length] : produce[(i - (length - 1 - nProduce)) % produce.length]));
}

/**
 * How many exercises fill `seconds`, given how long each kind takes (pace.ts). Quick games
 * mean more exercises, slow ones fewer, so lessons last about the same time.
 */
export function lengthForTime(seconds: number, o: { production?: number; speaking?: boolean; secondsOf: (k: Kind) => number }): number {
  const { secondsOf } = o;
  let best = 4;
  for (let n = 4; n <= 40; n++) {
    const total = planKinds(n, o).reduce((t, k) => t + secondsOf(k), secondsOf('match'));
    if (total > seconds) break;
    best = n;
  }
  return best;
}

/** Estimated seconds for a built lesson. */
export const lessonSeconds = (exercises: Exercise[], secondsOf: (k: Kind) => number) =>
  exercises.reduce((t, e) => t + secondsOf(e.kind), 0);

/**
 * A lesson (one exercise is a matching round): recognition first, then production for the
 * `production` share. Sized by `seconds` (a time budget) or `length`. Every item is used
 * before any repeats.
 */
export function buildLesson(items: Item[], seed = Date.now(), opts: { length?: number; production?: number; seconds?: number; secondsOf?: (k: Kind) => number; speaking?: boolean; difficulty?: Difficulty } = {}): Exercise[] {
  const d = opts.difficulty ?? EASY;
  const length = opts.seconds && opts.secondsOf ? lengthForTime(opts.seconds, { ...opts, secondsOf: opts.secondsOf }) : opts.length ?? 10;
  const r = rng(seed);
  const all = shuffle(items, r);
  const plan = planKinds(length, opts);
  const uses = new Map<Item, number>();
  let last: Item | undefined;
  // The least used item first, never the one just shown (unless it is the only choice), so a lesson goes through
  // every sentence before any comes back and never repeats one twice in a row.
  const pickFrom = (candidates: Item[]) => {
    const pool = candidates.length > 1 ? candidates.filter((x) => x !== last) : candidates;
    return pool.reduce((best, x) => ((uses.get(x) ?? 0) < (uses.get(best) ?? 0) ? x : best), pool[0]);
  };
  // Keep one single word back for the letter scramble, so it is not used up first.
  const forScramble = plan.includes('scramble') ? all.find(isWord) : undefined;
  const out: Exercise[] = plan.map((kind) => {
    const spare = (x: Item) => x !== forScramble || uses.has(x);
    const phrases = all.filter((x) => words(x.t).length >= 3);
    const pool = needsPhrase(kind) && phrases.length ? phrases : all.filter((x) => kind === 'scramble' || spare(x));
    const item = (kind === 'scramble' && forScramble && !uses.has(forScramble) && forScramble) || pickFrom(pool.length ? pool : all);
    uses.set(item, (uses.get(item) ?? 0) + 1);
    last = item;
    return exerciseFor(kind, item, { items, r, d });
  });
  out.splice(Math.min(4, out.length), 0, { kind: 'match', pairs: matchPairs(all) });
  return out;
}

const plain = (s: string) => s.toLowerCase().replace(/[.!?¡¿,;:"«»]/g, '').replace(/\s+/g, ' ').trim();
const noAccents = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/** A typed answer: exactly right, right except for accents, or wrong. */
export function checkTyped(typed: string, answer: string): 'right' | 'accents' | 'wrong' {
  if (plain(typed) === plain(answer)) return 'right';
  return noAccents(plain(typed)) === noAccents(plain(answer)) ? 'accents' : 'wrong';
}

/**
 * A spoken answer, as the recognizer wrote it: right when it has nearly all the answer's
 * words (recognizers drop accents and punctuation and sometimes a small word).
 */
export function checkSpoken(heard: string, answer: string): 'right' | 'wrong' {
  const norm = (x: string) => noAccents(plain(x)).split(' ').filter(Boolean);
  const want = norm(answer);
  const got = new Set(norm(heard));
  if (!want.length || !got.size) return 'wrong';
  return want.filter((w) => got.has(w)).length / want.length >= 0.75 ? 'right' : 'wrong';
}

/** Answers are compared without case, accents' spacing or end punctuation. */
export const sameAnswer = (a: string, b: string) => {
  const n = (s: string) => s.toLowerCase().replace(/[.!?¡¿,]/g, '').replace(/\s+/g, ' ').trim();
  return n(a) === n(b);
};

/** 3 stars at 90% right, 2 at 70%, otherwise 1 for finishing. */
export const starsFor = (right: number, total: number) => (right / Math.max(1, total) >= 0.9 ? 3 : right / Math.max(1, total) >= 0.7 ? 2 : 1);

/**
 * Up to five pairs for the matching game. Two pairs with the same English or the same translation
 * (ser / estar both "to be") cannot be told apart by the game and would leave it impossible to finish.
 */
export function matchPairs(items: Item[], n = 5): Item[] {
  const en = new Set<string>();
  const t = new Set<string>();
  const out: Item[] = [];
  for (const item of items) {
    if (out.length >= n) break;
    if (en.has(item.en) || t.has(item.t)) continue;
    en.add(item.en); t.add(item.t);
    out.push(item);
  }
  return out;
}
