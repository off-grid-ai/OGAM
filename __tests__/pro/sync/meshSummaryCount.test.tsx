import React from 'react';
import { render } from '@testing-library/react-native';
import { MeshSummary } from '../../../pro/ui/SyncScreen/MeshSummary';

const mesh = (used: number, max: number) =>
  ({ used, max, notice: null, registry: { stale: false, description: '' } }) as never;

describe('MeshSummary heading (hand test 28: "0 of 0 devices saved" beside 4 listed)', () => {
  it('counts the listed devices before the seat limit is known', () => {
    const view = render(<MeshSummary mesh={mesh(0, 0)} connectedCount={1} savedCount={4} />);
    expect(view.getByText('4 devices saved')).toBeTruthy();
    expect(view.queryByText(/0 of 0/)).toBeNull();
  });

  it('names the limit once it is known', () => {
    const view = render(<MeshSummary mesh={mesh(3, 5)} connectedCount={1} savedCount={3} />);
    expect(view.getByText('3 of 5 devices saved')).toBeTruthy();
  });

  it('never shows fewer saved than the list holds', () => {
    const view = render(<MeshSummary mesh={mesh(2, 5)} connectedCount={1} savedCount={4} />);
    expect(view.getByText('4 of 5 devices saved')).toBeTruthy();
  });
});
