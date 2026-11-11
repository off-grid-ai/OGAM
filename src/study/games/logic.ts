/** Pure, unit-tested rules for the project learning games (no React, no model). */
import type { LearningTerm } from '../learningGames';
import type { Source } from '../engine';

/** Deterministic PRNG so a saved game replays the same layout. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(items: T[], seed = Date.now()): T[] {
  const r = rng(seed);
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ------------------------------------------------------------- cloze (fill the blanks)
export interface ClozeItem { sentence: string; answer: string; options: string[]; src: number[] }

/** Sentences from the sources that contain a known term, with that term blanked. No model needed. */
export function buildCloze(terms: LearningTerm[], sources: Source[], opts: { max?: number; seed?: number } = {}): ClozeItem[] {
  const { max = 10, seed = 1 } = opts;
  const out: ClozeItem[] = [];
  const used = new Set<string>();
  const words = terms.map((t) => t.answer);
  for (const term of shuffle(terms, seed)) {
    const re = new RegExp(`\\b${term.answer}\\b`, 'i');
    for (const s of sources) {
      const sentence = (s.text.match(/[^.!?]+[.!?]*/g) ?? []).map((x) => x.trim()).find((x) => {
        const n = x.split(/\s+/).length;
        return n >= 6 && n <= 40 && re.test(x);
      });
      if (!sentence || used.has(sentence)) continue;
      used.add(sentence);
      const shown = sentence.replace(re, '_____');
      const distractors = shuffle(words.filter((w) => w !== term.answer), seed + out.length).slice(0, 3);
      out.push({ sentence: shown, answer: term.answer, options: shuffle([term.answer, ...distractors], seed * 7 + out.length), src: [s.n] });
      break;
    }
    if (out.length >= max) break;
  }
  return out;
}

/** Typed answers within one letter of the target count (spelling slips). */
export function editDistance(a: string, b: string): number {
  const x = a.toUpperCase(), y = b.toUpperCase();
  const row = Array.from({ length: y.length + 1 }, (_, i) => i);
  for (let i = 1; i <= x.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= y.length; j++) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (x[i - 1] === y[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[y.length];
}
export const closeEnough = (typed: string, answer: string) =>
  editDistance(typed.replace(/[^A-Za-z]/g, ''), answer) <= (answer.length >= 6 ? 1 : 0);

/** 0-1 similarity used by the phrase trainer and short answers. */
export function similarity(a: string, b: string): number {
  // Plain punctuation strip (no Unicode property escapes: older Hermes lacks them).
  const clean = (t: string) => t.toLowerCase().replace(/[.,!?\u00BF\u00A1;:'"()\-\u3002\uFF1F\uFF01\u060C]/g, '').replace(/\s+/g, ' ').trim();
  const x = clean(a);
  const y = clean(b);
  if (!x && !y) return 1;
  return 1 - editDistance(x, y) / Math.max(x.length, y.length, 1);
}

// ------------------------------------------------------------- hangman / term guess
export interface HangmanState { answer: string; guessed: string[]; lives: number }
export const HANGMAN_LIVES = 6;
export function hangmanGuess(state: HangmanState, letter: string): HangmanState {
  const l = letter.toUpperCase();
  if (!/^[A-Z]$/.test(l) || state.guessed.includes(l) || hangmanStatus(state) !== 'playing') return state;
  return { ...state, guessed: [...state.guessed, l], lives: state.answer.includes(l) ? state.lives : state.lives - 1 };
}
export function hangmanStatus(state: HangmanState): 'won' | 'lost' | 'playing' {
  if ([...state.answer].every((c) => state.guessed.includes(c))) return 'won';
  return state.lives <= 0 ? 'lost' : 'playing';
}
export const hangmanMask = (state: HangmanState) =>
  [...state.answer].map((c) => (state.guessed.includes(c) ? c : '_')).join(' ');

/** Wordle-style feedback: 'g' right place, 'y' in the word, '-' not in it. */
export function wordleFeedback(guess: string, answer: string): string {
  const g = guess.toUpperCase(), a = answer.toUpperCase();
  const res = Array(g.length).fill('-');
  const left: Record<string, number> = {};
  for (let i = 0; i < a.length; i++) {
    if (g[i] === a[i]) res[i] = 'g';
    else left[a[i]] = (left[a[i]] || 0) + 1;
  }
  for (let i = 0; i < g.length; i++) {
    if (res[i] === 'g') continue;
    if (left[g[i]]) { res[i] = 'y'; left[g[i]]--; }
  }
  return res.join('');
}

// ------------------------------------------------------------- memory pairs
export interface PairCard { id: number; pair: number; text: string; kind: 'term' | 'clue' }
export function buildPairs(terms: LearningTerm[], pairs = 6, seed = 1): PairCard[] {
  const chosen = terms.slice(0, pairs);
  const cards: PairCard[] = chosen.flatMap((t, i) => [
    { id: i * 2, pair: i, text: t.answer, kind: 'term' as const },
    { id: i * 2 + 1, pair: i, text: t.clue.length > 70 ? `${t.clue.slice(0, 67)}...` : t.clue, kind: 'clue' as const },
  ]);
  return shuffle(cards, seed);
}

// ------------------------------------------------------------- ordering
/** Length of the longest run of cards in correct relative order (partial credit). */
export function longestOrderedRun(order: number[]): number {
  // Longest increasing subsequence of the true positions.
  const tails: number[] = [];
  for (const x of order) {
    let lo = 0, hi = tails.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (tails[mid] < x) lo = mid + 1; else hi = mid; }
    tails[lo] = x;
  }
  return tails.length;
}

// ------------------------------------------------------------- mnemonics
/** True when the acronym's letters are the first letters of the list, in order. */
export function acronymMatches(acronym: string, items: string[]): boolean {
  const letters = acronym.toUpperCase().replace(/[^A-Z]/g, '');
  const firsts = items.map((i) => i.trim()[0]?.toUpperCase() ?? '').join('');
  return letters.length > 0 && letters === firsts;
}

// ------------------------------------------------------------- concept map layout
export interface MapNode { id: string; label: string; x?: number; y?: number }
export interface MapEdge { from: string; to: string; label: string }
/** Small force-directed layout in a 0..1 box (fixed iterations, deterministic). */
export function layoutConceptMap(nodes: MapNode[], edges: MapEdge[], opts: { iterations?: number; seed?: number } = {}): Required<MapNode>[] {
  const { iterations = 300, seed = 3 } = opts;
  const r = rng(seed);
  const pos = nodes.map((n, i) => ({
    ...n,
    x: 0.5 + 0.35 * Math.cos((2 * Math.PI * i) / Math.max(1, nodes.length)) + (r() - 0.5) * 0.02,
    y: 0.5 + 0.35 * Math.sin((2 * Math.PI * i) / Math.max(1, nodes.length)) + (r() - 0.5) * 0.02,
  }));
  const index = new Map(pos.map((p, i) => [p.id, i]));
  const k = Math.sqrt(1 / Math.max(1, nodes.length)) * 0.9;
  for (let it = 0; it < iterations; it++) {
    const temp = 0.08 * (1 - it / iterations);
    const disp = pos.map(() => ({ x: 0, y: 0 }));
    for (let i = 0; i < pos.length; i++) {
      for (let j = i + 1; j < pos.length; j++) {
        const dx = pos[i].x - pos[j].x, dy = pos[i].y - pos[j].y;
        const d = Math.max(0.01, Math.hypot(dx, dy));
        const f = (k * k) / d;
        disp[i].x += (dx / d) * f; disp[i].y += (dy / d) * f;
        disp[j].x -= (dx / d) * f; disp[j].y -= (dy / d) * f;
      }
    }
    for (const e of edges) {
      const a = index.get(e.from), b = index.get(e.to);
      if (a === undefined || b === undefined || a === b) continue;
      const dx = pos[a].x - pos[b].x, dy = pos[a].y - pos[b].y;
      const d = Math.max(0.01, Math.hypot(dx, dy));
      const f = (d * d) / k;
      disp[a].x -= (dx / d) * f; disp[a].y -= (dy / d) * f;
      disp[b].x += (dx / d) * f; disp[b].y += (dy / d) * f;
    }
    for (let i = 0; i < pos.length; i++) {
      const d = Math.max(0.0001, Math.hypot(disp[i].x, disp[i].y));
      pos[i].x = Math.min(0.92, Math.max(0.08, pos[i].x + (disp[i].x / d) * Math.min(d, temp)));
      pos[i].y = Math.min(0.92, Math.max(0.08, pos[i].y + (disp[i].y / d) * Math.min(d, temp)));
    }
  }
  return pos;
}

// ------------------------------------------------------------- scoring helpers
export function stars(score: number, max: number): number {
  if (max <= 0) return 0;
  const p = score / max;
  return p >= 0.9 ? 3 : p >= 0.6 ? 2 : p > 0 ? 1 : 0;
}

// ------------------------------------------------------------- word scramble
/** The word's letters in another order. Always differs from the word unless it cannot (one letter, or all the same). */
export function scrambleWord(word: string, seed = 1): string {
  const letters = [...word.toUpperCase()];
  if (new Set(letters).size < 2) return letters.join('');
  for (let attempt = 0; attempt < 12; attempt++) {
    const out = shuffle(letters, seed + attempt * 101).join('');
    if (out !== letters.join('')) return out;
  }
  return [...letters].reverse().join('') !== letters.join('') ? [...letters].reverse().join('') : letters.slice(1).concat(letters[0]).join('');
}

/** Scramble points: 2 for a clean answer, 1 if the first-letter hint was used. */
export const scramblePoints = (usedHint: boolean) => (usedHint ? 1 : 2);

// ------------------------------------------------------------- prize ladder (millionaire style)
export const LADDER_PRIZES = [100, 200, 300, 500, 1000, 2000, 4000, 8000, 16000, 32000];
/** Rungs (0-based) after which a wrong answer no longer loses everything: the 5th and the last. */
export const LADDER_SAFE = [4, 9];

/** What the player takes home after a wrong answer on `rung`: the last safe prize they passed. */
export function ladderFallback(rung: number): number {
  const passed = LADDER_SAFE.filter((s) => s < rung);
  return passed.length ? LADDER_PRIZES[passed[passed.length - 1]] : 0;
}

/** Two wrong options to hide for the 50:50 lifeline (indices), deterministic for a question. */
export function fiftyFifty(optionCount: number, answer: number, seed = 1): number[] {
  const wrong = Array.from({ length: optionCount }, (_, i) => i).filter((i) => i !== answer);
  return shuffle(wrong, seed).slice(0, Math.max(0, Math.min(2, wrong.length - 1)));
}

// ------------------------------------------------------------- fix the mistake
export interface FixItem { text: string; options: string[]; answer: number; fix: string; src: number[] }

/**
 * From true/false statements: each FALSE statement becomes "which correction makes this true?",
 * with the corrections of other false statements as wrong options. Needs three false statements.
 */
export function buildFixItems(statements: { text: string; isTrue: boolean; fix: string; src: number[] }[], seed = 1): FixItem[] {
  const falses = statements.filter((s) => !s.isTrue && s.fix.trim().length > 3);
  if (falses.length < 3) return [];
  return falses.map((s, i) => {
    const others = shuffle(falses.filter((o) => o !== s && o.fix !== s.fix).map((o) => o.fix), seed + i).slice(0, 3);
    const options = shuffle([s.fix, ...others], seed * 31 + i);
    return { text: s.text, options, answer: options.indexOf(s.fix), fix: s.fix, src: s.src };
  }).filter((x) => x.options.length >= 3);
}
