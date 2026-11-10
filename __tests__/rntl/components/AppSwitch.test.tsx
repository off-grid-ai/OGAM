import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { AppSwitch } from '../../../src/components/AppSwitch';

describe('AppSwitch', () => {
  it('reports its state and passes a toggle through', () => {
    const onValueChange = jest.fn();
    const { getByRole, rerender } = render(<AppSwitch accessibilityLabel="Auto-discover" value={false} onValueChange={onValueChange} />);
    const toggle = getByRole('switch', { name: 'Auto-discover' });
    expect(toggle.props.value).toBe(false);

    fireEvent(toggle, 'valueChange', true);
    expect(onValueChange).toHaveBeenCalledWith(true);

    rerender(<AppSwitch accessibilityLabel="Auto-discover" value={true} onValueChange={onValueChange} />);
    expect(getByRole('switch', { name: 'Auto-discover' }).props.value).toBe(true);
  });

  it('a disabled switch says so and does not toggle', () => {
    const onValueChange = jest.fn();
    const { getByRole } = render(<AppSwitch accessibilityLabel="Ollama" value={false} disabled onValueChange={onValueChange} />);
    const toggle = getByRole('switch', { name: 'Ollama' });
    expect(toggle.props.accessibilityState?.disabled ?? toggle.props.disabled).toBe(true);
  });
});

describe('AppSwitch knob colour', () => {
  const { Platform, Switch: NativeSwitch } = require('react-native');
  const { renderHook } = require('@testing-library/react-native');
  const { useTheme } = require('../../../src/theme');
  const originalOS = Platform.OS;
  afterEach(() => { Platform.OS = originalOS; });

  /** The knob colour handed to the platform's switch. */
  const knob = (value: boolean) =>
    render(<AppSwitch accessibilityLabel="Knob" value={value} />).UNSAFE_getByType(NativeSwitch).props.thumbColor;

  it('on Android: a white knob when on, a muted knob when off', () => {
    Platform.OS = 'android';
    const { colors } = renderHook(() => useTheme()).result.current;
    expect(knob(true)).toBe('#FFFFFF');
    expect(knob(false)).toBe(colors.textMuted);
    expect(colors.textMuted).not.toBe('#FFFFFF');
  });

  it('on iOS: a white knob both ways', () => {
    Platform.OS = 'ios';
    expect(knob(true)).toBe('#FFFFFF');
    expect(knob(false)).toBe('#FFFFFF');
  });
});
