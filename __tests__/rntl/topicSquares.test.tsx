import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { SquareView, answersMatch } from '../../src/topics/SquareViews';

describe('the other kinds of square', () => {
  it('a calculation: a wrong number says so, the right one (within the tolerance) finishes with the working', () => {
    const done = jest.fn();
    const view = render(<SquareView onDone={done} content={{ kind: 'numeric', task: 'Yearly depreciation?', answer: 4500, tolerance: 1, unit: 'USD', working: ['21000 / 4.667'] }} />);
    fireEvent.changeText(view.getByTestId('numeric-input'), '4000');
    fireEvent.press(view.getByTestId('numeric-check'));
    expect(view.getByTestId('numeric-wrong')).toBeTruthy();
    fireEvent.changeText(view.getByTestId('numeric-input'), '4,500.4');
    fireEvent.press(view.getByTestId('numeric-check'));
    expect(view.getByTestId('numeric-right')).toBeTruthy();
    expect(view.getByTestId('numeric-working')).toBeTruthy();
    fireEvent.press(view.getByTestId('numeric-done'));
    expect(done).toHaveBeenCalledWith(1);
  });
  it('a worked example shows one step at a time, and the takeaway at the end', () => {
    const done = jest.fn();
    const view = render(<SquareView onDone={done} content={{ kind: 'worked', problem: 'Solve x+2=5', steps: [{ step: 'Subtract 2 from both sides', why: 'undo +2' }, { step: 'x = 3', why: '' }], takeaway: 'Do the same to both sides' }} />);
    expect(view.queryByText(/x = 3/)).toBeNull();
    fireEvent.press(view.getByTestId('worked-next'));
    expect(view.getByText(/x = 3/)).toBeTruthy();
    expect(view.getByTestId('worked-takeaway')).toBeTruthy();
    fireEvent.press(view.getByTestId('worked-done'));
    expect(done).toHaveBeenCalledWith(3);
  });
  it('a table is drawn with the same copy buttons as a chat table', () => {
    const view = render(<SquareView onDone={jest.fn()} content={{ kind: 'table', title: 'Methods', markdown: '| A | B |\n| --- | --- |\n| 1 | 2 |' }} />);
    expect(view.getByTestId('copy-table-copy-table')).toBeTruthy();
  });

  it('typed answers ignore case, accents and punctuation, and allow one slip in a longer answer', () => {
    expect(answersMatch('Debit!', 'debit')).toBe(true);
    expect(answersMatch('cafe', 'Café')).toBe(true);
    expect(answersMatch('Dr', 'debit', ['Dr'])).toBe(true);
    expect(answersMatch('accumulated depreciaton', 'accumulated depreciation')).toBe(true);
    expect(answersMatch('credit', 'debit')).toBe(false);
    expect(answersMatch('', 'debit')).toBe(false);
  });
  it('type the answer: a right and a wrong answer, then the stars', () => {
    const done = jest.fn();
    const view = render(<SquareView onDone={done} content={{ kind: 'typed', mode: 'recall', items: [
      { prompt: 'Left side of a ledger?', answer: 'debit', alternatives: [], why: '' }, { prompt: 'Right side?', answer: 'credit', alternatives: [], why: 'the other one' }] }} />);
    fireEvent.changeText(view.getByTestId('typed-input'), 'Debit');
    fireEvent.press(view.getByTestId('typed-check'));
    expect(view.getByTestId('typed-right')).toBeTruthy();
    fireEvent.press(view.getByTestId('typed-next'));
    fireEvent.changeText(view.getByTestId('typed-input'), 'debit');
    fireEvent.press(view.getByTestId('typed-check'));
    expect(view.getByTestId('typed-wrong')).toBeTruthy();
    fireEvent.press(view.getByTestId('typed-next'));
    expect(done).toHaveBeenCalledWith(1);
  });
  it('fill the table: checking marks the blanks and finishing reports the share right', () => {
    const done = jest.fn();
    const view = render(<SquareView onDone={done} content={{ kind: 'tablefill', title: 'Sale', columns: ['Account', 'Debit', 'Credit'],
      rows: [['Cash', null, ''], ['Sales', '', null]], answers: [['Cash', '500', ''], ['Sales', '', '500']], why: 'cash in' }} />);
    fireEvent.changeText(view.getByTestId('tablefill-0-1'), '500');
    fireEvent.changeText(view.getByTestId('tablefill-1-2'), '400');
    fireEvent.press(view.getByTestId('tablefill-check'));
    expect(view.getByTestId('tablefill-score').props.children.join('')).toContain('1 of 2 right');
    fireEvent.press(view.getByTestId('tablefill-done'));
    expect(done).toHaveBeenCalledWith(1);
  });
  it('sort into groups: a wrong group is counted, the right one places the item', () => {
    const done = jest.fn();
    const view = render(<SquareView onDone={done} content={{ kind: 'sort', groups: ['Acid', 'Base'], items: [{ text: 'lemon', group: 0 }, { text: 'soap', group: 1 }] }} />);
    fireEvent.press(view.getByLabelText('lemon'));
    fireEvent.press(view.getByTestId('sort-group-1'));
    expect(view.getByTestId('sort-mistakes').props.children).toContain('1 in the wrong group');
    fireEvent.press(view.getByLabelText('lemon'));
    fireEvent.press(view.getByTestId('sort-group-0'));
    fireEvent.press(view.getByLabelText('soap'));
    fireEvent.press(view.getByTestId('sort-group-1'));
    expect(done).toHaveBeenCalledWith(2);
  });
  it('a reading square shows the passage above its questions, and a lesson shows common mistakes and a self-test', () => {
    const reading = render(<SquareView onDone={jest.fn()} content={{ kind: 'quiz', passage: 'The cat sat on the mat.', questions: [{ q: 'Who sat?', options: ['The cat', 'The dog'], answer: 0, why: '' }] }} />);
    expect(reading.getByTestId('quiz-passage')).toBeTruthy();
    reading.unmount();
    const lesson = render(<SquareView onDone={jest.fn()} content={{ kind: 'lesson', sections: [{ heading: 'Debit', text: 'Left side.' }], keyPoints: [], commonMistakes: ['Mixing up the sides'], quickCheck: { q: 'Which side is debit?', a: 'Left' } }} />);
    expect(lesson.getByTestId('lesson-mistakes')).toBeTruthy();
    expect(lesson.queryByTestId('quickcheck-answer')).toBeNull();
    fireEvent.press(lesson.getByTestId('quickcheck-show'));
    expect(lesson.getByTestId('quickcheck-answer')).toBeTruthy();
  });
});
