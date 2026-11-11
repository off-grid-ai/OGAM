/** Pure, source-linked educational puzzle layouts. Nothing is generated from invented facts. */
export interface LearningTerm { answer: string; clue: string; src: number[] }
export interface CrosswordEntry extends LearningTerm { id: number; row: number; col: number; direction: 'across' | 'down'; number: number }
export interface Crossword { size: number; cells: string[]; entries: CrosswordEntry[] }
export interface WordSearchEntry extends LearningTerm { id: number; row: number; col: number; dr: number; dc: number }
export interface WordSearch { size: number; cells: string[]; entries: WordSearchEntry[] }
export const normalizeLearningWord = (text: string) => text.toUpperCase().replace(/[^A-Z]/g, '');

export function buildCrossword(terms: LearningTerm[], size = 17): Crossword {
  if (size < 9) throw new Error('Crossword grid is too small');
  const cells = Array(size * size).fill('');
  const entries: CrosswordEntry[] = [];
  const occupied = (r: number, c: number) => r >= 0 && r < size && c >= 0 && c < size && !!cells[r * size + c];
  const at = (r: number, c: number) => cells[r * size + c];
  const put = (word: string, pos: { row: number; col: number; direction: 'across' | 'down' }) => {
    const { row, col, direction } = pos;
    for (let k = 0; k < word.length; k++) cells[(row + (direction === 'down' ? k : 0)) * size + col + (direction === 'across' ? k : 0)] = word[k];
  };
  const canPlace = (word: string, pos: { row: number; col: number; direction: 'across' | 'down' }) => {
    const { row, col, direction } = pos;
    const dr = direction === 'down' ? 1 : 0, dc = direction === 'across' ? 1 : 0;
    if (row < 0 || col < 0 || row + dr * (word.length - 1) >= size || col + dc * (word.length - 1) >= size) return -1;
    if (occupied(row - dr, col - dc) || occupied(row + dr * word.length, col + dc * word.length)) return -1;
    let overlaps = 0;
    for (let k = 0; k < word.length; k++) {
      const r = row + dr * k, c = col + dc * k, existing = at(r, c);
      if (existing && existing !== word[k]) return -1;
      if (existing) overlaps++;
      else if (direction === 'across' ? (occupied(r - 1, c) || occupied(r + 1, c)) : (occupied(r, c - 1) || occupied(r, c + 1))) return -1;
    }
    return overlaps;
  };
  const unique = new Set<string>();
  const items = terms.map(t => ({ ...t, answer: normalizeLearningWord(t.answer) }))
    .filter(t => t.answer.length >= 3 && t.answer.length <= size - 2 && !!t.clue.trim() && !unique.has(t.answer) && (unique.add(t.answer), true))
    .sort((a, b) => b.answer.length - a.answer.length).slice(0, 14);
  for (const item of items) {
    const word = item.answer;
    let best: { row: number; col: number; dir: 'across' | 'down'; score: number } | null = null;
    if (!entries.length) {
      best = { row: Math.floor(size / 2), col: Math.floor((size - word.length) / 2), dir: 'across', score: 1 };
    } else {
      for (const dir of ['across', 'down'] as const) {
        for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) {
          const overlap = canPlace(word, { row: r, col: c, direction: dir });
          if (overlap <= 0) continue;
          const score = overlap * 100 - Math.abs(r - size / 2) - Math.abs(c - size / 2);
          if (!best || score > best.score) best = { row: r, col: c, dir, score };
        }
      }
    }
    if (!best || canPlace(word, { row: best.row, col: best.col, direction: best.dir }) < 0) continue;
    put(word, { row: best.row, col: best.col, direction: best.dir });
    entries.push({ ...item, id: entries.length, row: best.row, col: best.col, direction: best.dir, number: 0 });
  }
  const numbered = [...entries].sort((a, b) => a.row - b.row || a.col - b.col);
  numbered.forEach((entry, i) => { entry.number = i + 1; });
  return { size, cells, entries };
}

export function buildWordSearch(terms: LearningTerm[], size = 15): WordSearch {
  const cells = Array(size * size).fill('');
  const entries: WordSearchEntry[] = [];
  const dirs = [[0,1],[1,0],[1,1],[1,-1],[0,-1],[-1,0],[-1,-1],[-1,1]];
  const unique = new Set<string>();
  for (const item of terms) {
    const word = normalizeLearningWord(item.answer);
    if (word.length < 3 || word.length > size || unique.has(word)) continue;
    unique.add(word);
    let placed = false;
    for (let trial = 0; trial < size * size * dirs.length && !placed; trial++) {
      const [dr, dc] = dirs[(trial + entries.length * 3) % dirs.length];
      const row = Math.floor((trial * 7 + entries.length * 11) % (size * size) / size);
      const col = (trial * 7 + entries.length * 11) % size;
      const endRow = row + dr * (word.length - 1), endCol = col + dc * (word.length - 1);
      if (endRow < 0 || endCol < 0 || endRow >= size || endCol >= size) continue;
      const fits = [...word].every((char, i) => {
        const prev = cells[(row + dr * i) * size + col + dc * i];
        return !prev || prev === char;
      });
      if (!fits) continue;
      [...word].forEach((char, i) => { cells[(row + dr * i) * size + col + dc * i] = char; });
      entries.push({ ...item, answer: word, id: entries.length, row, col, dr, dc });
      placed = true;
    }
  }
  // Deterministic fillers keep layouts stable when reopening a saved activity.
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  return { size, entries, cells: cells.map((cell, i) => cell || alphabet[(i * 17 + 7) % 26]) };
}

export function matchWordSearch(entry: WordSearchEntry, span: { first: number; last: number }, size: number): boolean {
  const { first, last } = span;
  const start = entry.row * size + entry.col;
  const end = (entry.row + entry.dr * (entry.answer.length - 1)) * size +
    entry.col + entry.dc * (entry.answer.length - 1);
  return (first === start && last === end) || (first === end && last === start);
}
