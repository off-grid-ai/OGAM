/**
 * Language crossword: the clues are in English and the answers are written in the language being
 * learned. Words are placed one at a time so each crosses an earlier one; no two words touch side
 * by side. Works for any script (the letters are whatever the words are written in). Pure and seeded.
 */
import { rng, type Item } from './lessons';
import { gridWord, searchWords } from './wordSearch';

export interface CrossEntry { id: number; en: string; word: string; row: number; col: number; across: boolean; num: number }
export interface Crossword { rows: number; cols: number; cells: (string | null)[]; entries: CrossEntry[] }

/** Letters of a word with accents and case ignored, for checking what the learner typed. */
export const plainLetters = (s: string) => gridWord(s).normalize('NFD').replace(/\p{M}/gu, '');

/** A crossword needs at least this many words that cross. */
export const MIN_WORDS = 4;

type Spot = { row: number; col: number; across: boolean };
type Placed = { word: string[]; en: string; r: number; c: number; across: boolean };

export function buildCrossword(items: Item[], { max = 8, seed = Date.now() }: { max?: number; seed?: number } = {}): Crossword | null {
  const r = rng(seed);
  // Longest first gives the others more letters to cross; the shuffle varies the puzzle between plays.
  const words = searchWords(items, 12).sort(() => r() - 0.5).slice(0, max + 3).sort((a, b) => gridWord(b.t).length - gridWord(a.t).length).slice(0, max);
  const letters = new Map<string, string>();
  const used = new Map<string, { across?: boolean; down?: boolean }>();
  const placed: Placed[] = [];
  const key = (row: number, col: number) => `${row},${col}`;
  const empty = (row: number, col: number) => !letters.has(key(row, col));

  const fits = (word: string[], { row, col, across }: Spot): boolean => {
    const [dr, dc] = across ? [0, 1] : [1, 0];
    if (!empty(row - dr, col - dc) || !empty(row + dr * word.length, col + dc * word.length)) return false;
    let crossings = 0;
    for (let k = 0; k < word.length; k++) {
      const [cr, cc] = [row + dr * k, col + dc * k];
      const there = letters.get(key(cr, cc));
      if (there === undefined) {
        // A new letter may not sit right next to another word's letter.
        if (!empty(cr + dc, cc + dr) || !empty(cr - dc, cc - dr)) return false;
      } else if (there !== word[k] || used.get(key(cr, cc))?.[across ? 'across' : 'down']) return false;
      else crossings++;
    }
    return crossings > 0 && crossings < word.length;
  };
  const put = (word: string[], en: string, { row, col, across }: Spot) => {
    word.forEach((ch, k) => {
      const at = key(row + (across ? 0 : k), col + (across ? k : 0));
      letters.set(at, ch);
      used.set(at, { ...used.get(at), [across ? 'across' : 'down']: true });
    });
    placed.push({ word, en, r: row, c: col, across });
  };

  words.forEach((it, index) => {
    const word = [...gridWord(it.t)];
    if (!index) { put(word, it.en, { row: 0, col: 0, across: true }); return; }
    const options: Spot[] = [];
    for (const p of placed) {
      p.word.forEach((ch, i) => word.forEach((w, k) => {
        if (w !== ch) return;
        // Cross at letter i of the placed word and letter k of this one, the other way round.
        options.push(p.across ? { row: p.r - k, col: p.c + i, across: false } : { row: p.r + i, col: p.c - k, across: true });
      }));
    }
    const spot = options.sort(() => r() - 0.5).find((o) => fits(word, o));
    if (spot) put(word, it.en, spot);
  });
  if (placed.length < MIN_WORDS) return null;

  const rowsAt = [...letters.keys()].map((k) => Number(k.split(',')[0]));
  const colsAt = [...letters.keys()].map((k) => Number(k.split(',')[1]));
  const [top, left] = [Math.min(...rowsAt), Math.min(...colsAt)];
  const rows = Math.max(...rowsAt) - top + 1, cols = Math.max(...colsAt) - left + 1;
  const cells: (string | null)[] = Array(rows * cols).fill(null);
  letters.forEach((ch, k) => { const [row, col] = k.split(',').map(Number); cells[(row - top) * cols + (col - left)] = ch; });

  // Numbers run in reading order; a cell where an across and a down word both start shares one.
  const starts = placed.map((p) => ({ ...p, row: p.r - top, col: p.c - left })).sort((a, b) => a.row - b.row || a.col - b.col);
  const numbers = new Map<string, number>();
  starts.forEach((p) => { if (!numbers.has(key(p.row, p.col))) numbers.set(key(p.row, p.col), numbers.size + 1); });
  const entries = starts.map((p, id) => ({ id, en: p.en, word: p.word.join(''), row: p.row, col: p.col, across: p.across, num: numbers.get(key(p.row, p.col))! }))
    .sort((a, b) => Number(b.across) - Number(a.across) || a.num - b.num);
  return { rows, cols, cells, entries: entries.map((e, id) => ({ ...e, id })) };
}

/** The grid cells (indexes) a word covers. */
export const entryCells = (cw: Crossword, e: CrossEntry): number[] =>
  Array.from({ length: [...e.word].length }, (_, k) => (e.row + (e.across ? 0 : k)) * cw.cols + e.col + (e.across ? k : 0));

/** True when what the learner typed is the entry's word (accents and capitals ignored). */
export const isAnswer = (e: CrossEntry, typed: string) => !!typed.trim() && plainLetters(typed) === plainLetters(e.word);
