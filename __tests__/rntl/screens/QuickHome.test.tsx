import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { QuickHomeScreen } from '../../../src/screens/HomeScreen/QuickHome';

it('the Simple, Compact and Colorful home offers the daily briefing, and no Presentations', () => {
  const parentNavigate = jest.fn();
  const navigation = { navigate: jest.fn(), getParent: () => ({ navigate: parentNavigate }) };
  const view = render(<QuickHomeScreen navigation={navigation} mode="simple" />);
  expect(view.queryByTestId('quick-home-presentations')).toBeNull();
  fireEvent.press(view.getByTestId('quick-home-brief'));
  expect(parentNavigate).toHaveBeenCalledWith('DailyBrief');
});

it('Focus shows only chat, learn and the briefing; Grid shows every tile', () => {
  const navigation = { navigate: jest.fn(), getParent: () => ({ navigate: jest.fn() }) };
  const focus = render(<QuickHomeScreen navigation={navigation} mode="focus" />);
  expect(focus.getByTestId('quick-home-chat')).toBeTruthy();
  expect(focus.getByTestId('quick-home-language')).toBeTruthy();
  expect(focus.queryByTestId('quick-home-models')).toBeNull();
  const grid = render(<QuickHomeScreen navigation={navigation} mode="grid" />);
  expect(grid.getByTestId('quick-home-models')).toBeTruthy();
});

it('names the tiles clearly: models to get, a model to load, a language or a topic to learn', () => {
  const navigation = { navigate: jest.fn(), getParent: () => ({ navigate: jest.fn() }) };
  const view = render(<QuickHomeScreen navigation={navigation} mode="simple" />);
  expect(view.getByText('Get models')).toBeTruthy();
  expect(view.getByText('Load a model')).toBeTruthy();
  expect(view.getByText('Learn a language')).toBeTruthy();
  expect(view.getByText('Learn a topic')).toBeTruthy();
});

it('offers the Atlas emergency tools as tiles that are off until turned on under Customize', () => {
  const { useAppStore } = require('../../../src/stores/appStore');
  useAppStore.getState().updateSettings({ homeTiles: undefined });
  const parentNavigate = jest.fn();
  const navigation = { navigate: jest.fn(), getParent: () => ({ navigate: parentNavigate }) };
  const view = render(<QuickHomeScreen navigation={navigation} mode="simple" />);
  expect(view.queryByTestId('quick-home-emergency')).toBeNull();
  expect(view.getByTestId('quick-home-teach')).toBeTruthy();
  fireEvent.press(view.getByTestId('home-customize'));
  fireEvent.press(view.getByTestId('tile-toggle-emergency'));
  fireEvent.press(view.getByTestId('home-customize')); // Done
  fireEvent.press(view.getByTestId('quick-home-emergency'));
  expect(parentNavigate).toHaveBeenCalledWith('Emergency');
});
