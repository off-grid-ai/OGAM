import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { SquareView } from '../../src/topics/SquareViews';

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
});
