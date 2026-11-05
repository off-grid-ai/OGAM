/** The board's exact tools: calculation squares re-worked by the app, and drill squares made and marked in code. */
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { SquareView } from '../../src/topics/SquareViews';
import { FORMATS, MAX_SQUARES, parseContent, parsePlan, planMessages, starsForShare } from '../../src/topics/formats';
import { drillFor, makeDrill } from '../../src/study/drills';
import { evalExpression } from '../../src/study/mathTools';

describe('calculator-checked answers', () => {
  it('reads plain arithmetic safely and refuses anything else', () => {
    expect(evalExpression('1000*(1+0.05)^3')).toBeCloseTo(1157.625, 6);
    expect(evalExpression('$1,200 / 4 + 15%')).toBeCloseTo(300.15, 6);
    expect(evalExpression('sqrt(16) + 2^3^2 - -1')).toBe(4 + 512 + 1);
    for (const bad of ['', 'alert(1)', '2 +', '1/0', 'x+1', '2**', 'process.exit()']) expect(() => evalExpression(bad)).toThrow();
  });

  it('keeps the AI answer when it agrees, uses the app answer when it does not, and says when nothing was checked', () => {
    const make = (answer: number, expression?: string) => JSON.stringify({ task: 'Compound 1000 at 5% for 3 years', answer, tolerance: 0.5, unit: 'USD', working: ['x'], ...(expression ? { expression } : {}) });
    expect(parseContent('numeric', make(1157.63, '1000*(1+0.05)^3'))).toMatchObject({ answer: 1157.63, checked: true });
    expect(parseContent('numeric', make(1150, '1000*(1+0.05)^3'))).toMatchObject({ answer: 1157.625, checked: true }); // the AI was wrong
    expect(parseContent('numeric', make(1157.63))).toMatchObject({ answer: 1157.63, checked: false });
    expect(parseContent('numeric', make(1157.63, 'not maths'))).toMatchObject({ checked: false });
  });
});

describe('drill squares', () => {
  it('match accounting and statistics words to the right drill, with no subject chosen by hand', () => {
    expect(drillFor('Bond pricing and discounts')).toBe('bond-price');
    expect(drillFor('Effective interest method for bonds')).toBe('bond-interest');
    expect(drillFor('Building a balance sheet')).toBe('balance-sheet');
    expect(drillFor('Standard deviation of a sample')).toBe('std-dev');
    expect(drillFor('Poetry and rhyme')).toBeUndefined();
  });

  it('are on the AI menu, and the plan asks for every part of a whole subject', () => {
    expect(FORMATS.some((f) => f.id === 'drill')).toBe(true);
    expect(planMessages({ topic: 'Accounting', goal: '', level: 'Complete beginner', how: '', minutes: 10 } as any).user).toMatch(/EVERY major part/);
    expect(MAX_SQUARES).toBeGreaterThanOrEqual(60);
    const units = Array.from({ length: 8 }, (_, u) => ({ title: `Unit ${u + 1}`, squares: Array.from({ length: 7 }, (_, s) => ({ format: s === 3 ? 'drill' : 'lesson', title: `Part ${u}-${s}`, focus: 'x' })) }));
    const plan = parsePlan(JSON.stringify({ title: 'T', summary: 's', style: 'st', theme: 'th', units }));
    expect(plan?.squares.length).toBeGreaterThanOrEqual(56);
    expect(plan?.squares.filter((q) => q.format === 'drill').length).toBe(8);
  });

  it('run on the board: marked by the app, a wrong answer says so, stars follow how many were right', () => {
    const done = jest.fn();
    const exercises = [makeDrill('net-income', 1), makeDrill('net-income', 2)];
    const view = render(<SquareView onDone={done} content={{ kind: 'drill', exercises }} />);
    fireEvent.changeText(view.getByTestId('practice-input'), String((exercises[0] as any).answer));
    fireEvent.press(view.getByTestId('drill-check'));
    expect(view.getByTestId('drill-result').props.children.join('')).toMatch(/Correct/);
    fireEvent.press(view.getByTestId('drill-next'));
    fireEvent.changeText(view.getByTestId('practice-input'), '1');
    fireEvent.press(view.getByTestId('drill-check'));
    expect(view.getByTestId('drill-result').props.children.join('')).toMatch(/Not quite/);
    fireEvent.press(view.getByTestId('drill-done'));
    expect(done).toHaveBeenCalledWith(starsForShare(0.5)); // half right
  });
});
