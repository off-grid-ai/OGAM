/**
 * Language word search: the word bank is in English and the grid hides the same words in the
 * language being learned. Works for any script: filler letters come from the hidden words
 * themselves, so a Russian grid is all Cyrillic and a Spanish one keeps ñ. Pure and seeded.
 */
import { rng } from './lessons';
import type { Item } from './lessons';

export interface Hidden { id: number; word: string; en: string; row: number; col: number; dr: number; dc: number }
export interface LangWordSearch { size: number; cells: string[]; hidden: Hidden[] }

const DIRS: [number, number][] = [[0, 1], [1, 0], [1, 1], [1, -1], [0, -1], [-1, 0], [-1, -1], [-1, 1]];

/** A word as it goes in the grid: capitals, letters only (accents kept). */
export const gridWord = (t: string) => [...t.toLocaleUpperCase().normalize('NFC')].filter((ch) => /\p{L}/u.test(ch)).join('');

/** Single words from the items that fit the grid (3+ letters), one each. */
export function searchWords(items: Item[], size: number): Item[] {
  const seen = new Set<string>();
  return items.filter((x) => {
    const w = gridWord(x.t);
    if (x.t.trim().split(/\s+/).length !== 1 || [...w].length < 3 || [...w].length > size || seen.has(w)) return false;
    seen.add(w);
    return true;
  });
}

export function buildLangWordSearch(items: Item[], { size = 10, max = 8, seed = Date.now() }: { size?: number; max?: number; seed?: number } = {}): LangWordSearch {
  const r = rng(seed);
  const cells: string[] = Array(size * size).fill('');
  const hidden: Hidden[] = [];
  for (const it of searchWords(items, size).slice(0, max)) {
    const word = [...gridWord(it.t)];
    for (let trial = 0; trial < 400; trial++) {
      const [dr, dc] = DIRS[Math.floor(r() * DIRS.length)];
      const row = Math.floor(r() * size), col = Math.floor(r() * size);
      const endR = row + dr * (word.length - 1), endC = col + dc * (word.length - 1);
      if (endR < 0 || endC < 0 || endR >= size || endC >= size) continue;
      if (!word.every((ch, k) => { const prev = cells[(row + dr * k) * size + col + dc * k]; return !prev || prev === ch; })) continue;
      word.forEach((ch, k) => { cells[(row + dr * k) * size + col + dc * k] = ch; });
      hidden.push({ id: hidden.length, word: word.join(''), en: it.en, row, col, dr, dc });
      break;
    }
  }
  const letters = hidden.flatMap((h) => [...h.word]);
  const fill = letters.length ? letters : ['A'];
  return { size, hidden, cells: cells.map((c) => c || fill[Math.floor(r() * fill.length)]) };
}

/**
 * The cells of a straight line (row, column or diagonal) from one tapped letter to another,
 * or null when the two are not in line.
 */
export function lineCells([a, b]: [number, number], size: number): number[] | null {
  const [r0, c0, r1, c1] = [Math.floor(a / size), a % size, Math.floor(b / size), b % size];
  const dr = Math.sign(r1 - r0), dc = Math.sign(c1 - c0);
  const n = Math.max(Math.abs(r1 - r0), Math.abs(c1 - c0));
  if (n === 0 || (r1 - r0 !== dr * n) || (c1 - c0 !== dc * n)) return null;
  return Array.from({ length: n + 1 }, (_, k) => (r0 + dr * k) * size + c0 + dc * k);
}

/**
 * The hidden word the learner found by tapping its first and last letter, either way round,
 * also where the filler letters happen to spell it a second time. Null when the line is not a
 * word still to find.
 */
export function wordAt(puzzle: LangWordSearch, tap: [number, number], left: Hidden[]): { hidden: Hidden; cells: number[] } | null {
  const cells = lineCells(tap, puzzle.size);
  if (!cells) return null;
  const text = cells.map((i) => puzzle.cells[i]).join('');
  const back = [...text].reverse().join('');
  const hidden = left.find((h) => h.word === text || h.word === back);
  return hidden ? { hidden, cells } : null;
}
