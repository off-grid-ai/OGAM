/**
 * Whole subjects on the board with nothing chosen by hand: a plan that mixes AI lessons with squares the app makes and marks itself
 * (accounting statements, maths, science, the periodic table). Those squares need no model, remember where you were, and are exact.
 */
import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';
import { SquareView } from '../../src/topics/SquareViews';
import { parsePlan } from '../../src/topics/formats';
import { squareContent } from '../../src/topics/service';
import { useTopics } from '../../src/topics/store';
import { useExerciseStore } from '../../src/study/exercises';
import { DRILL_KINDS, MATH_DRILLS, SCIENCE_DRILLS, drillFor, makeDrill } from '../../src/study/drills';
import { makePeriodicQuestions, tablePosition } from '../../src/study/periodicQuiz';
import { ELEMENTS, findElement, molarMass } from '../../src/study/science';

const plan = parsePlan(JSON.stringify({
  title: 'Accounting and science', summary: 's', style: 'st', theme: 'th',
  units: [{ title: 'Statements', squares: [
    { format: 'drill', title: 'Building a balance sheet', focus: 'assets, liabilities and equity' },
    { format: 'drill', title: 'Cash flow statement', focus: 'operating, investing, financing' },
    { format: 'periodic', title: 'Find the elements', focus: 'groups and periods' },
    { format: 'drill', title: 'Molar mass', focus: 'adding atomic masses' },
    { format: 'drill', title: 'Quadratic equations', focus: 'roots' },
  ] }],
}))!;

describe('squares the app makes itself', () => {
  it('are built with no model call, from the words in the square, and kept for next time', async () => {
    const id = useTopics.getState().add({ topic: 'Accounting and science', goal: '', level: 'Complete beginner', how: '', minutes: 10 } as any, plan);
    const course = () => useTopics.getState().courses.find((c) => c.id === id)!;
    const kinds = ['s1', 's2', 's3', 's4', 's5'];
    const made = [] as any[];
    for (const key of kinds) made.push(await squareContent(course(), key));
    expect(made.map((m) => m.kind)).toEqual(['drill', 'drill', 'periodic', 'drill', 'drill']);
    expect(made[0].exercises.every((e: any) => e.id.startsWith('drill-balance-sheet-'))).toBe(true);
    expect(made[1].exercises.every((e: any) => e.id.startsWith('drill-cash-flow-'))).toBe(true);
    expect(made[3].exercises.every((e: any) => e.id.startsWith('drill-molar-mass-'))).toBe(true);
    expect(made[4].exercises.every((e: any) => e.id.startsWith('drill-quadratic-roots-'))).toBe(true);
    expect(await squareContent(course(), 's1')).toBe(course().content.s1); // opened again: the same questions
  });
});

describe('balance sheet on the board', () => {
  it('remembers typed answers when you leave, picks up at the first unmarked question, and marks the rows', () => {
    const exercises = [makeDrill('balance-sheet', 11), makeDrill('balance-sheet', 12)] as any[];
    const done = jest.fn();
    const first = render(<SquareView onDone={done} content={{ kind: 'drill', exercises }} />);
    fireEvent.press(first.getAllByText('Cash')[0]); // choose an account for row 1 from the dropdown choices
    fireEvent.changeText(first.getAllByPlaceholderText('Amount')[0], String(exercises[0].rows[0].amount));
    first.unmount(); // leave the square
    const again = render(<SquareView onDone={done} content={{ kind: 'drill', exercises }} />);
    expect(again.getAllByPlaceholderText('Amount')[0].props.value).toBe(String(exercises[0].rows[0].amount)); // still there
    // Fill every row correctly and mark it.
    exercises[0].rows.forEach((row: any, i: number) => {
      fireEvent.press(again.getAllByText(row.account)[i]);
      fireEvent.changeText(again.getAllByPlaceholderText('Amount')[i], String(row.amount));
    });
    fireEvent.press(again.getByTestId('drill-check'));
    expect(again.getByTestId('drill-result').props.children.join('')).toMatch(/Correct/);
    expect(useExerciseStore.getState().progress[exercises[0].id]).toMatchObject({ answered: true, last: true });
    again.unmount();
    const resumed = render(<SquareView onDone={done} content={{ kind: 'drill', exercises }} />);
    expect(resumed.getByText('2 of 2')).toBeTruthy(); // the marked one is skipped
  });
});

describe('maths and science drills are exact', () => {
  const nums = (t: string) => (t.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
  it('every maths and science drill is a numeric question with a finite answer, for 40 seeds each', () => {
    for (const kind of [...MATH_DRILLS, ...SCIENCE_DRILLS]) for (let seed = 1; seed <= 40; seed++) {
      const ex: any = makeDrill(kind, seed);
      expect(ex.kind).toBe('calc');
      expect(Number.isFinite(ex.answer)).toBe(true);
      expect(ex.prompt.length).toBeGreaterThan(10);
    }
    expect(DRILL_KINDS.length).toBeGreaterThanOrEqual(44);
  });
  it('agree with independent calculations', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const lin: any = makeDrill('linear-equation', seed);
      const [, a, sign, b, c] = lin.prompt.match(/(\d+)x ([+-]) (\d+) = (-?\d+)/) as string[];
      expect(Number(a) * lin.answer + (sign === '-' ? -1 : 1) * Number(b)).toBe(Number(c));
      const mm: any = makeDrill('molar-mass', seed);
      const formula = (mm.prompt.match(/molar mass of (\S+)\?/) as string[])[1];
      expect(mm.answer).toBeCloseTo(molarMass(formula).mass, 1);
      const ke: any = makeDrill('kinetic-energy', seed);
      const [m, v] = nums(ke.prompt);
      expect(ke.answer).toBeCloseTo(0.5 * m * v * v, 1);
      const ph: any = makeDrill('ph-of-acid', seed);
      expect(ph.answer).toBeCloseTo(-Math.log10(nums(ph.prompt)[0]), 1);
      const pc: any = makeDrill('percent-change', seed);
      const [from, to] = nums(pc.prompt);
      expect(pc.answer).toBeCloseTo(((to - from) / from) * 100, 1);
    }
  });
  it('are found from plain words', () => {
    expect(drillFor('Solving quadratic equations')).toBe('quadratic-roots');
    expect(drillFor('Newton\'s second law')).toBe('force');
    expect(drillFor('Molar mass and the mole')).toBe('molar-mass');
    expect(drillFor('Adding fractions')).toBe('fraction-sum');
  });
});

describe('the periodic table square', () => {
  it('asks questions with exactly one right element, and places every element once', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 30; seed++) for (const q of makePeriodicQuestions(seed, 8)) {
      expect(findElement(q.answer)).toBeDefined();
      const sym = q.prompt.match(/symbol (\w+)/)?.[1]; if (sym) expect(sym).toBe(q.answer);
      const z = q.prompt.match(/atomic number (\d+)/)?.[1]; if (z) expect(findElement(z)?.symbol).toBe(q.answer);
      const gp = q.prompt.match(/group (\d+), period (\d+)/); if (gp) expect(ELEMENTS.filter((e) => e.group === Number(gp[1]) && e.period === Number(gp[2])).map((e) => e.symbol)).toEqual([q.answer]);
      const fam = q.prompt.match(/Tap the (alkali metal|alkaline earth metal|noble gas|halogen|metalloid) in period (\d+)/); if (fam) expect(ELEMENTS.filter((e) => e.category === fam[1] && e.period === Number(fam[2])).map((e) => e.symbol)).toEqual([q.answer]);
      seen.add(q.prompt);
    }
    expect(seen.size).toBeGreaterThan(40);
    const spots = new Set(ELEMENTS.map((e) => `${tablePosition(e).row},${tablePosition(e).col}`));
    expect(spots.size).toBe(118);
  });

  it('can be played on the board: a wrong tap says so, the right one explains, and finishing gives stars', () => {
    const questions = makePeriodicQuestions(5, 2);
    const done = jest.fn();
    const view = render(<SquareView onDone={done} content={{ kind: 'periodic', questions }} />);
    const wrongSymbol = ELEMENTS.find((e) => e.symbol !== questions[0].answer)!.symbol;
    fireEvent.press(view.getByTestId(`el-${wrongSymbol}`));
    expect(view.getByTestId('periodic-wrong')).toBeTruthy();
    fireEvent.press(view.getByTestId(`el-${questions[0].answer}`));
    expect(view.getByTestId('periodic-right')).toBeTruthy();
    fireEvent.press(view.getByTestId('periodic-next'));
    fireEvent.press(view.getByTestId(`el-${questions[1].answer}`));
    fireEvent.press(view.getByTestId('periodic-done'));
    expect(done).toHaveBeenCalledTimes(1);
  });
});
