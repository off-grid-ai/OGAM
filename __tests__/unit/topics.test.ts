import { parsePlan, parseContent, parseGrade, planMessages, starsForShare, FORMATS } from '../../src/topics/formats';

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
