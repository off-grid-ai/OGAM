import { check } from '../../src/study/exercises';
import { DRILL_KINDS, makeDrill, makeDrillSet } from '../../src/study/drills';

describe('accounting drills', () => {
  it('are the same for the same seed and different for another', () => {
    expect(makeDrill('net-income', 5)).toEqual(makeDrill('net-income', 5));
    expect(makeDrill('net-income', 5)).not.toEqual(makeDrill('net-income', 6));
  });

  it('always balance: the answer key passes its own check, and breaking one amount fails it', () => {
    for (let seed = 1; seed <= 60; seed++) {
      for (const kind of DRILL_KINDS) {
        const ex: any = makeDrill(kind, seed);
        const key = ex.kind === 'table' ? ex.rows.map((r: any) => ({ account: r.account, amount: String(r.amount) })) : String(ex.answer);
        expect(check(ex, key).correct).toBe(true);
        if (ex.kind === 'table') {
          const bad = key.map((k: any, i: number) => (i === 0 ? { ...k, amount: String(Number(k.amount) + 100) } : k));
          expect(check(ex, bad).correct).toBe(false);
        }
      }
    }
  });

  it('makes a mixed set with unique ids', () => {
    const set = makeDrillSet(6, 10);
    expect(set).toHaveLength(6);
    expect(new Set(set.map((e) => e.id)).size).toBe(6);
  });

  it('computes the answers the way a textbook does (independent recalculation from the question text)', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const loan: any = makeDrill('loan-payment', seed);
      const [, principal, rate, years] = loan.prompt.match(/\$([\d,]+) loan at ([\d.]+)% a year, paid monthly over (\d+) years/) as string[];
      const i = Number(rate) / 100 / 12; const n = Number(years) * 12; const p = Number(principal.replace(/,/g, ''));
      expect(loan.answer).toBeCloseTo((p * i) / (1 - (1 + i) ** -n), 1);

      const eff: any = makeDrill('effective-rate', seed);
      const [, nom, m] = eff.prompt.match(/nominal rate of ([\d.]+)% is compounded (\d+) times/) as string[];
      expect(eff.answer).toBeCloseTo(((1 + Number(nom) / 100 / Number(m)) ** Number(m) - 1) * 100, 1);

      const dev: any = makeDrill('std-dev', seed);
      const xs = (dev.prompt.match(/of: ([\d, ]+)\./) as string[])[1].split(',').map(Number);
      const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
      expect(dev.answer).toBeCloseTo(Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length - 1)), 1);
    }
  });

  it('covers accounting and the research statistics the doctoral courses use', () => {
    expect(DRILL_KINDS.length).toBeGreaterThanOrEqual(20);
    const topics = new Set(DRILL_KINDS.map((k) => (makeDrill(k, 3) as any).topic));
    for (const t of ['Compound interest and loans', 'Inventory', 'Depreciation', 'Ratios', 'Cost-volume-profit', 'Capital budgeting', 'Income statement', 'Cash flow statement', 'Trial balance', 'Research statistics']) expect(topics.has(t)).toBe(true);
  });
});

import { answerText, check as checkAnswer, missedExercises, streak, useExerciseStore } from '../../src/study/exercises';
import { buildExam, gradeExam, secondsLeft } from '../../src/study/exam';

describe('bonds and leases', () => {
  it('price a bond and a lease the way a textbook does', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const bond: any = makeDrill('bond-price', seed);
      const [, years, face, coupon, market] = bond.prompt.match(/A (\d+)-year bond with a face value of \$([\d,]+) pays ([\d.]+)%.*market rate is ([\d.]+)%/) as string[];
      const F = Number(face.replace(/,/g, '')); const c = Number(coupon) / 100; const m = Number(market) / 100; const n = Number(years);
      let pv = F / (1 + m) ** n; for (let t = 1; t <= n; t++) pv += (F * c) / (1 + m) ** t;
      expect(bond.answer).toBeCloseTo(pv, 1);
      const lease: any = makeDrill('lease-liability', seed);
      const [, pay, when, yrs, rate] = lease.prompt.match(/requires \$([\d,]+) at the (start|end) of each year for (\d+) years.*rate is ([\d.]+)%/) as string[];
      const P = Number(pay.replace(/,/g, '')); const r = Number(rate) / 100; let lv = 0;
      for (let t = when === 'start' ? 0 : 1; t < Number(yrs) + (when === 'start' ? 0 : 1); t++) lv += P / (1 + r) ** t;
      expect(lease.answer).toBeCloseTo(lv, 1);
    }
  });
});

describe('timed exam, flashcards, notes and streaks', () => {
  const make = (id: string, topic: string, answer: number) => ({ id, kind: 'calc', topic, prompt: id, answer }) as any;
  const bank = Object.fromEntries([make('a', 'Tax', 1), make('b', 'Tax', 2), make('c', 'Audit', 3)].map((e) => [e.id, e]));

  it('grades only at the end, counts blanks as wrong and ranks weak topics first', () => {
    const exam = buildExam(Object.values(bank), {}, { count: 3, minutes: 10, now: 0 });
    expect(exam.ids).toHaveLength(3);
    expect(secondsLeft(exam, 0)).toBe(600);
    expect(secondsLeft(exam, 601000)).toBe(0);
    const r = gradeExam(exam, bank, { a: '1', b: '9' });
    expect(r).toMatchObject({ correct: 1, total: 3, unanswered: 1, percent: 33 });
    expect(r.byTopic[0]).toEqual({ topic: 'Audit', correct: 0, total: 1 });
    expect(r.wrong.sort()).toEqual(['b', 'c']);
  });

  it('writes the right answer in words and picks out missed questions', () => {
    expect(answerText(make('x', 't', 7.5))).toBe('7.5');
    expect(answerText({ id: 'm', kind: 'mcq', prompt: 'p', choices: ['a', 'b'], answer: 1 } as any)).toBe('b');
    expect(checkAnswer(bank.a, '1').correct).toBe(true);
    const progress = { a: { box: 0, due: 0, attempts: 1, correct: 0, last: false }, b: { box: 1, due: 0, attempts: 1, correct: 1, last: true } } as any;
    expect(missedExercises(Object.values(bank), progress).map((e: any) => e.id)).toEqual(['a']);
  });

  it('counts a daily streak only when the goal is met, and saves a note on a question', () => {
    const daily = { '2026-11-03': 12, '2026-11-04': 10, '2026-11-05': 4 };
    expect(streak(daily, '2026-11-05', 10)).toBe(2); // today still in progress
    expect(streak({ ...daily, '2026-11-05': 10 }, '2026-11-05', 10)).toBe(3);
    expect(streak({ '2026-11-01': 20 }, '2026-11-05', 10)).toBe(0);
    const s = useExerciseStore.getState();
    s.setNote('q1', 'I forgot salvage value');
    s.record('q2', true, Date.parse('2026-11-05T10:00:00Z'));
    expect(useExerciseStore.getState().progress.q1.note).toBe('I forgot salvage value');
    expect(useExerciseStore.getState().daily['2026-11-05']).toBe(1);
    expect(useExerciseStore.getState().goal).toEqual({ on: false, perDay: 10 });
  });
});

import { pruneBank } from '../../src/study/exercises';
describe('question bank size', () => {
  it('stays under the limit, dropping known questions first and never the ones just added', () => {
    const bank: Record<string, any> = {}; const progress: Record<string, any> = {};
    for (let i = 0; i < 650; i++) { bank[`q${i}`] = { id: `q${i}`, kind: 'calc', prompt: 'p', answer: 1 }; if (i % 2 === 0) progress[`q${i}`] = { box: 3, due: 0, attempts: 3, correct: 3, last: true }; }
    progress.q1 = { box: 0, due: 0, attempts: 1, correct: 0, last: false }; // a miss: kept
    progress.q0 = { box: 3, due: 0, attempts: 3, correct: 3, last: true, note: 'my note' }; // a note: kept
    const out = pruneBank(bank, progress, ['q2']);
    expect(Object.keys(out.exercises)).toHaveLength(600);
    expect(out.exercises.q1).toBeDefined();
    expect(out.exercises.q0).toBeDefined();
    expect(out.exercises.q2).toBeDefined(); // just added
    expect(Object.keys(out.progress ?? {}).every((id) => out.exercises[id])).toBe(true);
    expect(pruneBank({ a: bank.q0 }, {}, []).exercises).toEqual({ a: bank.q0 });
  });
});
