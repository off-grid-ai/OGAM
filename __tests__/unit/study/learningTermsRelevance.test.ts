import { parseGroundedLearningTerms, isFillerTerm, type Source } from '../../../src/study/engine';

const sources: Source[] = [
  { n: 1, doc: 'Biology notes', part: 1, text: 'Mitochondria release energy. However, chloroplasts capture light through photosynthesis. This is important.' },
];

it('keeps real study terms that occur in the project passages', () => {
  const raw = [
    'TERM: MITOCHONDRIA | CLUE: Organelles that release energy | SRC: 1',
    'TERM: PHOTOSYNTHESIS | CLUE: How plants capture light energy | SRC: 1',
    'TERM: CHLOROPLASTS | CLUE: Plant organelles that capture light | SRC: 1',
  ].join('\n');
  expect(parseGroundedLearningTerms(raw, sources).map(t => t.answer)).toEqual(['MITOCHONDRIA', 'PHOTOSYNTHESIS', 'CHLOROPLASTS']);
});

it('drops filler words even though they occur in the passage', () => {
  const raw = [
    'TERM: HOWEVER | CLUE: A word used to contrast two ideas | SRC: 1',
    'TERM: IMPORTANT | CLUE: Of great significance or value | SRC: 1',
    'TERM: RIBOSOME | CLUE: Not in these notes at all, invented | SRC: 1',
  ].join('\n');
  expect(parseGroundedLearningTerms(raw, sources)).toEqual([]);
  expect(isFillerTerm('because')).toBe(true);
  expect(isFillerTerm('osmosis')).toBe(false);
});
