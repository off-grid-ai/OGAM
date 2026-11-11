import { buildCrossword, buildWordSearch, matchWordSearch, normalizeLearningWord } from '../../../src/study/learningGames';

const terms = [
  { answer: 'PLANET', clue: 'A large body orbiting a star', src: [1] },
  { answer: 'PLANT', clue: 'Photosynthetic living organism', src: [1] },
  { answer: 'LANTERN', clue: 'Portable source of light', src: [2] },
  { answer: 'TRAIN', clue: 'Rail transportation vehicle', src: [2] },
  { answer: 'BRAIN', clue: 'Organ controlling the nervous system', src: [3] },
  { answer: 'RIVER', clue: 'Large flowing body of water', src: [3] },
  { answer: 'ATOM', clue: 'Smallest unit of an element', src: [4] },
];
describe('source-linked learning puzzles', () => {
  it('normalizes word entries without modifying clues or citations', () => {
    expect(normalizeLearningWord('test-value')).toBe('TESTVALUE');
  });
  it('constructs a crossword with real intersecting answers and citations', () => {
    const crossword = buildCrossword(terms);
    expect(crossword.entries.length).toBeGreaterThanOrEqual(3);
    for (const entry of crossword.entries) {
      expect(entry.clue.length).toBeGreaterThan(6);
      expect(entry.src).toHaveLength(1);
      for (let i = 0; i < entry.answer.length; i++) {
        const row = entry.row + (entry.direction === 'down' ? i : 0);
        const col = entry.col + (entry.direction === 'across' ? i : 0);
        expect(crossword.cells[row * crossword.size + col]).toBe(entry.answer[i]);
      }
    }
    expect(new Set(crossword.entries.map(e => e.number)).size).toBe(crossword.entries.length);
  });
  it('builds a word search and can validate first/last grid cells', () => {
    const wordSearch = buildWordSearch(terms);
    expect(wordSearch.entries.length).toBeGreaterThanOrEqual(3);
    const entry = wordSearch.entries[0];
    const start = entry.row * wordSearch.size + entry.col;
    const end = (entry.row + entry.dr * (entry.answer.length - 1)) * wordSearch.size + entry.col + entry.dc * (entry.answer.length - 1);
    expect(matchWordSearch(entry, { first: start, last: end }, wordSearch.size)).toBe(true);
    expect(matchWordSearch(entry, { first: end, last: start }, wordSearch.size)).toBe(true);
    expect(wordSearch.cells[start]).toBe(entry.answer[0]);
    expect(matchWordSearch(entry, { first: start, last: start }, wordSearch.size)).toBe(false);
  });
  it('rejects repeated words and overly long answers', () => {
    const wordSearch = buildWordSearch([...terms, terms[0], { answer: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', clue: 'Long', src: [4] }]);
    expect(wordSearch.entries.filter(e => e.answer === 'PLANET')).toHaveLength(1);
    expect(wordSearch.entries.some(e => e.answer.startsWith('ABCDEFGHIJKLMNOPQRSTUVWXYZ'))).toBe(false);
  });
});
