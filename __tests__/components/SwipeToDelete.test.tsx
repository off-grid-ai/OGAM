import React from 'react';
import { Text } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import { SwipeToDelete } from '../../src/components/SwipeToDelete';

describe('SwipeToDelete', () => {
  it('shows one trash button that deletes the row and names it aloud', () => {
    const onDelete = jest.fn();
    const ui = render(
      <SwipeToDelete onDelete={onDelete} label="Trip plan" testID="delete-row">
        <Text>Trip plan</Text>
      </SwipeToDelete>,
    );
    const button = ui.getByLabelText('Delete Trip plan');
    expect(ui.getByTestId('delete-row')).toBe(button);
    fireEvent.press(button);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('fills the row height with an inset on every side, so it lines up with the row and keeps off the edge', () => {
    const ui = render(
      <SwipeToDelete onDelete={jest.fn()} label="Trip plan">
        <Text>Trip plan</Text>
      </SwipeToDelete>,
    );
    const style = [ui.getByLabelText('Delete Trip plan').props.style].flat(Infinity).reduce((a, b) => ({ ...a, ...b }), {});
    expect(style.alignSelf).toBe('stretch');
    expect(style.marginBottom).toBeUndefined();
    expect(style.margin).toBeGreaterThan(0);
    expect(style.marginLeft).toBeGreaterThan(0);
  });

  it('has no trash button while it is turned off (choosing chats)', () => {
    const ui = render(
      <SwipeToDelete onDelete={jest.fn()} label="Trip plan" enabled={false}>
        <Text>Trip plan</Text>
      </SwipeToDelete>,
    );
    expect(ui.queryByLabelText('Delete Trip plan')).toBeNull();
    expect(ui.getByText('Trip plan')).toBeTruthy();
  });
});
