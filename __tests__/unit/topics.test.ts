import { parsePlan, parseContent, parseGrade, planMessages, starsForShare, FORMATS, subjectAdvice } from '../../src/topics/formats';

const plan = (squares: object[]) => JSON.stringify({ title: 'Accounting basics', summary: 'Read a balance sheet', style: 'Worked examples first', theme: 'The Ledger Road', units: [{ title: 'Foundations', squares }] });

describe('topic courses: what the AI plans', () => {
  it('reads a plan, makes the keys, and keeps the formats the AI chose', () => {
    const p = parsePlan(plan([
      { format: 'lesson', title: 'Assets and liabilities', focus: 'what each is' },
      { format: 'practice', title: 'Classify items', focus: 'sort 10 items' },
      { format: 'match', title: 'Accounts to types', focus: 'pair them' },
      { format: 'quiz', title: 'Check', focus: 'all of it' },
    ]));
    expect(p?.squares.map((s) => s.format)).toEqual(['lesson', 'practice', 'match', 'quiz']);
    expect(p?.squares.map((s) => s.key)).toEqual(['s1', 's2', 's3', 's4']);
    expect(p?.theme).toBe('The Ledger Road');
    expect(p?.squares[3].checkpoint).toBe(true);
  });
  it('adds a final quiz when the plan does not end with one, and treats an unknown format as a lesson', () => {
    const p = parsePlan(plan([{ format: 'lesson', title: 'a', focus: 'a' }, { format: 'hologram', title: 'b', focus: 'b' }, { format: 'cards', title: 'c', focus: 'c' }]));
    expect(p?.squares).toHaveLength(4);
    expect(p?.squares[1].format).toBe('lesson');
    expect(p?.squares[3]).toMatchObject({ format: 'quiz', title: 'Final quiz', checkpoint: true });
  });
  it('refuses a plan that is too small or not JSON', () => {
    expect(parsePlan(plan([{ format: 'lesson', title: 'only', focus: 'x' }]))).toBeNull();
    expect(parsePlan('Sure! Here is a course')).toBeNull();
  });
  it('asks the AI to choose formats to suit the subject, and shows it the whole menu', () => {
    const { user } = planMessages({ topic: 'Python', goal: 'automate files', level: 'Beginner', how: 'lots of practice', minutes: 10 });
    for (const f of FORMATS) expect(user).toContain(f.id);
    expect(user).toContain('Python');
    expect(user).toContain('lots of practice');
  });
});

describe('topic courses: what the AI writes for a square', () => {
  it('reads each kind of square and drops anything unusable', () => {
    expect(parseContent('lesson', JSON.stringify({ sections: [{ heading: 'Debit', text: 'Left side.' }, { text: '' }], keyPoints: ['a', ''] }))).toEqual({
      kind: 'lesson', sections: [{ heading: 'Debit', text: 'Left side.', example: undefined }], keyPoints: ['a'],
    });
    const quiz = parseContent('quiz', JSON.stringify({ questions: [
      { q: 'Q1', options: ['a', 'b'], answer: 1, why: 'because' }, { q: 'Q2', options: ['a', 'b'], answer: 5, why: '' }, { q: 'Q3', options: ['x', 'y', 'z'], answer: 0, why: 'w' },
    ] }));
    expect(quiz && quiz.kind === 'quiz' && quiz.questions.map((q) => q.q)).toEqual(['Q1', 'Q3']);
    expect(parseContent('cards', JSON.stringify({ cards: [{ front: 'a', back: 'b' }, { front: 'c', back: 'd' }] }))).toBeNull(); // too few
    const match = parseContent('match', JSON.stringify({ pairs: [{ left: 'a', right: '1' }, { left: 'a', right: '2' }, { left: 'b', right: '3' }, { left: 'c', right: '4' }] }));
    expect(match && match.kind === 'match' && match.pairs.map((p) => p.left)).toEqual(['a', 'b', 'c']);
    expect(parseContent('order', JSON.stringify({ prompt: 'p', steps: ['1', '2', '3'] }))).toMatchObject({ kind: 'order', steps: ['1', '2', '3'] });
    expect(parseContent('practice', JSON.stringify({ task: 'Write a function', model: 'def f(): pass', rubric: ['defines f'] }))).toMatchObject({ kind: 'practice', task: 'Write a function' });
    expect(parseContent('quiz', 'not json')).toBeNull();
  });
  it('reads a mark, keeps it between 0 and 100, and gives stars for a share', () => {
    expect(parseGrade('{"score": 140, "feedback": "Great."}')).toEqual({ score: 100, feedback: 'Great.' });
    expect(parseGrade('{"score": 50}')).toBeNull();
    expect([0.5, 0.7, 0.95].map(starsForShare)).toEqual([1, 2, 3]);
  });
});

describe('topic courses: more kinds of square', () => {
  it('fill the gap, true or false and scenario squares are read as quiz questions', () => {
    for (const format of ['fill', 'truefalse', 'scenario'] as const) {
      const c = parseContent(format, JSON.stringify({ questions: [{ q: 'A ____ is', options: ['x', 'y'], answer: 1, why: 'w' }, { q: 'B', options: ['True', 'False'], answer: 0, why: 'w' }] }));
      expect(c).toMatchObject({ kind: 'quiz' });
    }
  });
  it('reads a calculation with its tolerance, and sets one when the AI gives none', () => {
    expect(parseContent('numeric', JSON.stringify({ task: 'Depreciation per year?', answer: 4500, tolerance: 1, unit: 'USD', working: ['(25000-4000)/... '] }))).toMatchObject({ kind: 'numeric', answer: 4500, tolerance: 1, unit: 'USD' });
    expect(parseContent('numeric', JSON.stringify({ task: 'x', answer: 200 }))).toMatchObject({ tolerance: 2 });
    expect(parseContent('numeric', JSON.stringify({ task: 'x', answer: 'lots' }))).toBeNull();
  });
  it('reads a worked example and a table, and rejects thin ones', () => {
    expect(parseContent('worked', JSON.stringify({ problem: 'Solve x+2=5', steps: [{ step: 'Subtract 2', why: 'undo +2' }, { step: 'x = 3', why: '' }], takeaway: 'Do the same to both sides' }))).toMatchObject({ kind: 'worked' });
    expect(parseContent('worked', JSON.stringify({ problem: 'p', steps: [{ step: 'only one', why: '' }] }))).toBeNull();
    const table = parseContent('table', JSON.stringify({ title: 'Methods', columns: ['Method', 'Formula'], rows: [['Straight-line', '(c-s)/n'], ['Declining', 'rate x book value'], ['bad row'] ] }));
    expect(table).toMatchObject({ kind: 'table', markdown: '| Method | Formula |\n| --- | --- |\n| Straight-line | (c-s)/n |\n| Declining | rate x book value |' });
  });
  it('offers the AI at least twelve kinds of square to choose from', () => {
    expect(FORMATS.length).toBeGreaterThanOrEqual(12);
  });
});

describe('topic courses: teaching almost anything', () => {
  it('offers the AI twenty kinds of square, enough for maths, science, accounting, English and code', () => {
    expect(FORMATS.length).toBeGreaterThanOrEqual(19);
    expect(new Set(FORMATS.map((f) => f.id)).size).toBe(FORMATS.length);
  });
  it('gives teaching advice for big subject areas, and none for an unknown one', () => {
    expect(subjectAdvice('Algebra 1')).toMatch(/calculate/i);
    expect(subjectAdvice('GCSE Biology')).toMatch(/sort-into-groups/);
    expect(subjectAdvice('Financial accounting')).toMatch(/fill-the-table/);
    expect(subjectAdvice('English grammar')).toMatch(/fix-the-mistake/);
    expect(subjectAdvice('Python for beginners')).toMatch(/predict-the-result/);
    expect(subjectAdvice('Medieval basket weaving')).toBe('');
    expect(planMessages({ topic: 'Algebra 1', goal: '', level: 'x', how: '', minutes: 10 }).user).toContain('Subject area: mathematics');
  });
  it('reads typed-answer, fix, sort, dictation, reading and predict squares', () => {
    expect(parseContent('recall', JSON.stringify({ items: [{ prompt: 'Left side of a ledger?', answer: 'debit', alternatives: ['Dr'] }, { prompt: 'b', answer: 'b' }, { prompt: 'c', answer: 'c' }] }))).toMatchObject({ kind: 'typed', mode: 'recall' });
    expect(parseContent('fix', JSON.stringify({ items: [{ prompt: 'She dont like it.', answer: "She doesn't like it.", why: 'agreement' }, { prompt: 'a', answer: 'b' }, { prompt: 'c', answer: 'd' }] }))).toMatchObject({ kind: 'typed', mode: 'fix' });
    expect(parseContent('sort', JSON.stringify({ groups: ['Acid', 'Base'], items: [{ text: 'lemon', group: 0 }, { text: 'soap', group: 1 }, { text: 'vinegar', group: 0 }, { text: 'bleach', group: 1 }, { text: 'bad', group: 7 }] }))).toMatchObject({ kind: 'sort' });
    expect(parseContent('dictation', JSON.stringify({ lang: 'es-ES', sentences: ['Hola', 'Adios', 'Gracias'] }))).toMatchObject({ kind: 'dictation', lang: 'es-ES' });
    expect(parseContent('dictation', JSON.stringify({ lang: 'whatever', sentences: ['a', 'b', 'c'] }))).toMatchObject({ lang: 'en-US' });
    expect(parseContent('reading', JSON.stringify({ passage: 'The cat sat.', questions: [{ q: 'Who sat?', options: ['cat', 'dog'], answer: 0, why: 'w' }, { q: 'q2', options: ['a', 'b'], answer: 1, why: 'w' }] }))).toMatchObject({ kind: 'quiz', passage: 'The cat sat.' });
    expect(parseContent('reading', JSON.stringify({ questions: [{ q: 'q', options: ['a', 'b'], answer: 0, why: '' }, { q: 'q2', options: ['a', 'b'], answer: 1, why: '' }] }))).toBeNull(); // no passage
    expect(parseContent('predict', JSON.stringify({ questions: [{ q: '```\nprint(2+2)\n```\nWhat prints?', options: ['4', '22'], answer: 0, why: 'adds' }, { q: 'b', options: ['x', 'y'], answer: 1, why: '' }] }))).toMatchObject({ kind: 'quiz' });
  });
  it('reads a table to fill: the full table, with some cells hidden', () => {
    const c = parseContent('tablefill', JSON.stringify({ title: 'Sale', columns: ['Account', 'Debit', 'Credit'], rows: [['Cash', '500', ''], ['Sales', '', '500']], blank: [[0, 1], [1, 2], [0, 0]], why: 'cash in, sales up' }));
    expect(c).toMatchObject({ kind: 'tablefill', rows: [['Cash', null, ''], ['Sales', '', null]] });
  });
  it('reads a lesson with common mistakes and a self-test question', () => {
    const c = parseContent('lesson', JSON.stringify({ sections: [{ heading: 'h', text: 't' }], commonMistakes: ['mixing up debit and credit'], quickCheck: { q: 'Which side is debit?', a: 'Left' }, keyPoints: ['k'] }));
    expect(c).toMatchObject({ commonMistakes: ['mixing up debit and credit'], quickCheck: { q: 'Which side is debit?', a: 'Left' } });
  });
});

