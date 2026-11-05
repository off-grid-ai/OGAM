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

describe('MeshSummary offline notice (hand test 29: "authoritative device roster")', () => {
  const offline = (freshness: string, description: string) =>
    ({ used: 1, max: 5, notice: null, registry: { stale: true, freshness, description } }) as never;

  it('says what you get back when the licensed devices cannot load', () => {
    const view = render(
      <MeshSummary
        mesh={offline('unavailable', 'Connect to the internet to load the authoritative device roster.')}
        connectedCount={0}
        savedCount={1}
      />,
    );
    expect(view.getByText('Connect to the internet to see every device on your licence.')).toBeTruthy();
    expect(view.queryByText(/authoritative/)).toBeNull();
  });

  it('keeps the projected sentence when a cached list is showing', () => {
    const view = render(
      <MeshSummary mesh={offline('cached', 'The device roster will refresh soon.')} connectedCount={0} savedCount={1} />,
    );
    expect(view.getByText('The device roster will refresh soon.')).toBeTruthy();
  });
});
