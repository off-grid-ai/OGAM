import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { ModelRow } from '../../../src/components/ModelRow';

jest.mock('../../../src/theme', () => ({
  useTheme: () => ({ colors: { text: '#000', textMuted: '#999', textSecondary: '#666', primary: '#059669', info: '#5AC8FA', surface: '#fff', background: '#fff' } }),
  useThemedStyles: (fn: any) => fn({ text: '#000', textMuted: '#999', textSecondary: '#666', primary: '#059669', info: '#5AC8FA', surface: '#fff', background: '#fff' }),
}));

describe('ModelRow (shared model picker card)', () => {
  it('renders name, size and quant', () => {
    const { getByText } = render(<ModelRow name="Gemma 4 E2B" size="2.41 GB" quant="Q4_0" onPress={jest.fn()} />);
    expect(getByText('Gemma 4 E2B')).toBeTruthy();
    expect(getByText('2.41 GB')).toBeTruthy();
    expect(getByText('Q4_0')).toBeTruthy();
  });

  it('shows the Vision badge only when isVision', () => {
    const { queryByText, rerender } = render(<ModelRow name="m" size="1 GB" onPress={jest.fn()} />);
    expect(queryByText('Vision')).toBeNull();
    rerender(<ModelRow name="m" size="1 GB" isVision onPress={jest.fn()} />);
    expect(queryByText('Vision')).toBeTruthy();
  });

  it('shows the RAM hint when provided (home sheet), omits it otherwise (chat)', () => {
    const { queryByText, rerender } = render(<ModelRow name="m" size="1 GB" onPress={jest.fn()} />);
    expect(queryByText(/GB RAM/)).toBeNull();
    rerender(<ModelRow name="m" size="1 GB" ramHint="~3.6 GB RAM (may not fit)" onPress={jest.fn()} />);
    expect(queryByText('~3.6 GB RAM (may not fit)')).toBeTruthy();
  });

  it('fires onPress, and is inert when disabled', () => {
    const onPress = jest.fn();
    const { getByText, rerender } = render(<ModelRow name="Tap me" size="1 GB" onPress={onPress} />);
    fireEvent.press(getByText('Tap me'));
    expect(onPress).toHaveBeenCalledTimes(1);
    rerender(<ModelRow name="Tap me" size="1 GB" onPress={onPress} disabled />);
    fireEvent.press(getByText('Tap me'));
    expect(onPress).toHaveBeenCalledTimes(1); // still 1 — disabled swallows the press
  });
});
