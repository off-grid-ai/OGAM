import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { QuickHomeScreen } from '../../../src/screens/HomeScreen/QuickHome';

it('the Simple, Compact and Colorful home offers the daily briefing, and no Presentations', () => {
  const parentNavigate = jest.fn();
  const navigation = { navigate: jest.fn(), getParent: () => ({ navigate: parentNavigate }) };
  const view = render(<QuickHomeScreen navigation={navigation} mode="simple" />);
  expect(view.queryByTestId('quick-home-presentations')).toBeNull();
  fireEvent.press(view.getByTestId('quick-home-daily briefing'));
  expect(parentNavigate).toHaveBeenCalledWith('DailyBrief');
});

it('Focus shows only chat, learn and the briefing; Grid shows every tile', () => {
  const navigation = { navigate: jest.fn(), getParent: () => ({ navigate: jest.fn() }) };
  const focus = render(<QuickHomeScreen navigation={navigation} mode="focus" />);
  expect(focus.getByTestId('quick-home-chat')).toBeTruthy();
  expect(focus.getByTestId('quick-home-learn')).toBeTruthy();
  expect(focus.queryByTestId('quick-home-models')).toBeNull();
  const grid = render(<QuickHomeScreen navigation={navigation} mode="grid" />);
  expect(grid.getByTestId('quick-home-models')).toBeTruthy();
});
