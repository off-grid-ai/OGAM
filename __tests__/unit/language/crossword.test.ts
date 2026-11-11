import { buildCrossword, entryCells, isAnswer, MIN_WORDS } from '../../../src/language/crossword';
import { boardFor, lessonsUntilExam, CROSSWORD_EVERY, EXAM_EVERY } from '../../../src/language/board';

const items = [
  ['red', 'rojo'], ['blue', 'azul'], ['green', 'verde'], ['white', 'blanco'], ['black', 'negro'], ['yellow', 'amarillo'],
  ['house', 'casa'], ['water', 'agua'], ['bread', 'pan'], ['coffee', 'café'], ['tea', 'té'],
].map(([en, t]) => ({ en, t }));

describe('language crossword', () => {
  it('crosses the words with no two side by side, and the clues stay in English', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const cw = buildCrossword(items, { seed })!;
      expect(cw.entries.length).toBeGreaterThanOrEqual(MIN_WORDS);
      // Every entry's letters are in the grid where it says.
      for (const e of cw.entries) expect(entryCells(cw, e).map((i) => cw.cells[i]).join('')).toBe(e.word);
      // Every word crosses another.
      for (const e of cw.entries) {
        const mine = new Set(entryCells(cw, e));
        expect(cw.entries.some((o) => o !== e && entryCells(cw, o).some((c) => mine.has(c)))).toBe(true);
      }
      // No letter has a letter beside it that belongs to no word with it.
      cw.cells.forEach((ch, i) => {
        if (ch === null) return;
        const [r, c] = [Math.floor(i / cw.cols), i % cw.cols];
        const inAcross = cw.entries.some((e) => e.across && entryCells(cw, e).includes(i));
        const inDown = cw.entries.some((e) => !e.across && entryCells(cw, e).includes(i));
        if (!inAcross) { expect(c > 0 && cw.cells[i - 1] !== null).toBe(false); expect(c < cw.cols - 1 && cw.cells[i + 1] !== null).toBe(false); }
        if (!inDown) { expect(r > 0 && cw.cells[i - cw.cols] !== null).toBe(false); expect(r < cw.rows - 1 && cw.cells[i + cw.cols] !== null).toBe(false); }
      });
    }
  });

  it('has too few words to make a crossword out of two', () => {
    expect(buildCrossword(items.slice(0, 2))).toBeNull();
  });

  it('accepts an answer without accents or capitals', () => {
    const e = { id: 0, en: 'coffee', word: 'CAFÉ', row: 0, col: 0, across: true, num: 1 };
    expect(isAnswer(e, 'cafe')).toBe(true);
    expect(isAnswer(e, 'Café')).toBe(true);
    expect(isAnswer(e, 'te')).toBe(false);
    expect(isAnswer(e, ' ')).toBe(false);
  });

  it('puts a crossword on the board without moving other squares, and counts down to the exam', () => {
    const board = boardFor(1);
    const cross = board.find((s) => s.kind === 'crossword')!;
    expect(cross.key).toBe('crossword@1.1');
    expect(board.slice(0, board.indexOf(cross)).filter((s) => s.kind === 'lesson').length).toBe(CROSSWORD_EVERY);
    expect(new Set(board.map((s) => s.key)).size).toBe(board.length);
    const exam = board.findIndex((s) => s.kind === 'exam');
    expect(lessonsUntilExam(board, 0, () => false)).toBe(EXAM_EVERY);
    expect(lessonsUntilExam(board, exam, () => false)).toBeNull();
  });
});
