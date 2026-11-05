import React from 'react';
import { Text } from 'react-native';
import { render } from '@testing-library/react-native';
import { AnimatedListItem } from '../../../src/components/AnimatedListItem';

describe('<AnimatedListItem/> role', () => {
  it('a row that opens something is a button to a screen reader', () => {
    const view = render(<AnimatedListItem onPress={() => {}} testID="row"><Text>[test] chat</Text></AnimatedListItem>);
    expect(view.getByRole('button')).toBeTruthy();
  });

  it('a row with nothing to open is not a button', () => {
    const view = render(<AnimatedListItem testID="row"><Text>[test] chat</Text></AnimatedListItem>);
    expect(view.queryByRole('button')).toBeNull();
  });

  it('keeps a role the caller sets', () => {
    const view = render(<AnimatedListItem onPress={() => {}} accessibilityRole="link"><Text>[test] link</Text></AnimatedListItem>);
    expect(view.getByRole('link')).toBeTruthy();
  });
});
