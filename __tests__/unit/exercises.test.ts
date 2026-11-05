import { check, groundExercises, practiceSet, readExercises, topicScores, useExerciseStore, type Exercise } from '../../src/study/exercises';

const chunk = { doc: 'Intro Accounting', page: 12, section: 'The accounting equation', text: 'Assets equal liabilities plus equity. A company with $500 of assets and $200 of liabilities has $300 of equity.' };

describe('exercise checking', () => {
  it('checks numbers with formatting and tolerance', () => {
    const ex = { id: 'a', kind: 'calc', prompt: 'x', answer: 1234.5, tolerance: 0.5 } as Exercise;
    expect(check(ex, '$1,234.00').correct).toBe(true);
    expect(check(ex, '1,200').correct).toBe(false);
    expect(check(ex, '').correct).toBe(false);
  });
  it('marks each table row and checks that the statement balances', () => {
    const ex: Exercise = { id: 't', kind: 'table', prompt: 'Complete', rows: [
      { label: 'Row 1', account: 'Cash', amount: 500, group: 'assets' },
      { label: 'Row 2', account: 'Accounts payable', amount: 200, group: 'liab' },
      { label: 'Row 3', account: 'Retained earnings', amount: 300, group: 'equity' },
    ], totals: [{ name: 'Assets = liabilities + equity', groups: ['assets'], equals: ['liab', 'equity'] }] };
    expect(check(ex, [{ account: 'Cash', amount: '500' }, { account: 'Accounts payable', amount: '200' }, { account: 'Retained earnings', amount: '300' }]).correct).toBe(true);
    const wrong = check(ex, [{ account: 'Cash', amount: '500' }, { account: 'Inventory', amount: '200' }, { account: 'Retained earnings', amount: '250' }]);
    expect(wrong.correct).toBe(false); expect(wrong.parts).toEqual([true, false, false]); expect(wrong.note).toMatch(/Does not balance/);
  });
  it('checks order, matching and testlets', () => {
    expect(check({ id: 'o', kind: 'order', prompt: 'p', items: ['a', 'b', 'c'] }, ['a', 'c', 'b'])).toEqual({ correct: false, parts: [true, false, false] });
    expect(check({ id: 'm', kind: 'match', prompt: 'p', pairs: [['x', '1'], ['y', '2']] }, { x: '1', y: '2' }).correct).toBe(true);
    const t: Exercise = { id: 't', kind: 'testlet', prompt: 'p', stem: 's', items: [{ id: 'i1', kind: 'truefalse', prompt: 'q', answer: true }, { id: 'i2', kind: 'mcq', prompt: 'q', choices: ['a', 'b'], answer: 1 }] };
    expect(check(t, [true, 0])).toEqual({ correct: false, parts: [true, false] });
  });
});

describe('grounding model output', () => {
  const good = { kind: 'calc', prompt: 'Equity?', answer: 300, source: { quote: 'has $300 of equity' } };
  it('keeps supported exercises and takes page and section from the real chunk', () => {
    const { kept, dropped } = groundExercises([good], [chunk], 'Accounting equation');
    expect(dropped).toHaveLength(0);
    expect(kept[0].source).toMatchObject({ doc: 'Intro Accounting', page: 12, section: 'The accounting equation' });
  });
  it('drops malformed, unsupported and invented-quote exercises without throwing', () => {
    const raw = readExercises('Sure! ```json\n[{"kind":"mcq","prompt":"q","choices":["a"],"answer":0},{"kind":"calc","prompt":"q","answer":9,"source":{"quote":"Depreciation is always straight line"}}, null, ' + JSON.stringify(good) + ']```');
    const { kept, dropped } = groundExercises(raw, [chunk]);
    expect(kept).toHaveLength(1); expect(dropped.map((d) => d.why).sort()).toEqual(['malformed', 'malformed', 'not supported by the material']);
    expect(readExercises('no json here')).toEqual([]);
    expect(readExercises('[{broken')).toEqual([]);
  });
});

describe('review and scores', () => {
  it('brings missed questions back first and scores topics', () => {
    const a = { id: 'a', kind: 'truefalse', prompt: 'a', answer: true, topic: 'Tax' } as Exercise;
    const b = { id: 'b', kind: 'truefalse', prompt: 'b', answer: true, topic: 'Tax' } as Exercise;
    const c = { id: 'c', kind: 'truefalse', prompt: 'c', answer: true, topic: 'Audit' } as Exercise;
    const s = useExerciseStore.getState();
    s.record('a', true, 0); s.record('b', false, 0); s.record('c', true, 0);
    const now = 1000; // far from due for a (box 1 = 1 day), b missed
    const { progress } = useExerciseStore.getState();
    expect(practiceSet([a, b, c], progress, { now }).map((e) => e.id)[0]).toBe('b');
    expect(topicScores([a, b, c], progress)).toEqual([{ topic: 'Tax', attempts: 2, percent: 50 }, { topic: 'Audit', attempts: 1, percent: 100 }]);
  });
});
