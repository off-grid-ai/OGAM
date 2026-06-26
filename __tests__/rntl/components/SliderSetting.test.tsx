/**
 * SliderSetting Component Tests
 *
 * The shared numeric control used across every generation/model/TTS settings
 * screen: a draggable slider (coarse, step-snapped) with a live value you can
 * tap to type an exact number (precise). Covers display formatting, tap-to-edit
 * with clamping/validation, and slider commit-on-release.
 */

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { SliderSetting } from '../../../src/components/SliderSetting';

describe('SliderSetting', () => {
  const baseProps = {
    testID: 'temp',
    label: 'Temperature',
    value: 0.7,
    min: 0,
    max: 2,
    step: 0.05,
    onChange: jest.fn(),
  };

  beforeEach(() => jest.clearAllMocks());

  it('renders label, description and warning', () => {
    const { getByText } = render(
      <SliderSetting {...baseProps} description="Higher = more creative" warning="Uses lots of RAM" />,
    );
    expect(getByText('Temperature')).toBeTruthy();
    expect(getByText('Higher = more creative')).toBeTruthy();
    expect(getByText('Uses lots of RAM')).toBeTruthy();
  });

  it('does not render description/warning when not provided', () => {
    const { queryByText } = render(<SliderSetting {...baseProps} />);
    expect(queryByText('Higher = more creative')).toBeNull();
  });

  it('formats the displayed value with formatValue', () => {
    const { getByTestId } = render(
      <SliderSetting {...baseProps} formatValue={(v) => `${v.toFixed(2)}x`} />,
    );
    expect(getByTestId('temp-value').props.children).toBe('0.70x');
  });

  it('defaults to 2 decimals when step < 1', () => {
    const { getByTestId } = render(<SliderSetting {...baseProps} />);
    expect(getByTestId('temp-value').props.children).toBe('0.70');
  });

  it('defaults to 0 decimals when step >= 1', () => {
    const { getByTestId } = render(
      <SliderSetting testID="tok" label="Max Tokens" value={1024} min={64} max={8192} step={64} onChange={jest.fn()} />,
    );
    expect(getByTestId('tok-value').props.children).toBe('1024');
  });

  // ─── Tap-to-edit ──────────────────────────────────────────────────────────

  it('reveals a text input pre-filled with the raw value when the value is tapped', () => {
    const { getByTestId } = render(
      <SliderSetting {...baseProps} formatValue={(v) => `${v.toFixed(2)}x`} />,
    );
    fireEvent.press(getByTestId('temp-value-button'));
    // The editable field shows the raw number, not the formatted display.
    expect(getByTestId('temp-input').props.value).toBe('0.7');
  });

  it('commits an exact typed value on submit', () => {
    const onChange = jest.fn();
    const { getByTestId } = render(<SliderSetting {...baseProps} onChange={onChange} />);
    fireEvent.press(getByTestId('temp-value-button'));
    fireEvent.changeText(getByTestId('temp-input'), '0.73');
    fireEvent(getByTestId('temp-input'), 'submitEditing');
    // Typed values keep full precision (not snapped to the 0.05 step grid).
    expect(onChange).toHaveBeenCalledWith(0.73);
  });

  it('clamps a typed value above max', () => {
    const onChange = jest.fn();
    const { getByTestId } = render(<SliderSetting {...baseProps} onChange={onChange} />);
    fireEvent.press(getByTestId('temp-value-button'));
    fireEvent.changeText(getByTestId('temp-input'), '9');
    fireEvent(getByTestId('temp-input'), 'submitEditing');
    expect(onChange).toHaveBeenCalledWith(2);
  });

  it('clamps a typed value below min', () => {
    const onChange = jest.fn();
    const { getByTestId } = render(<SliderSetting {...baseProps} onChange={onChange} />);
    fireEvent.press(getByTestId('temp-value-button'));
    fireEvent.changeText(getByTestId('temp-input'), '-3');
    fireEvent(getByTestId('temp-input'), 'submitEditing');
    expect(onChange).toHaveBeenCalledWith(0);
  });

  it('ignores invalid (non-numeric) input', () => {
    const onChange = jest.fn();
    const { getByTestId, queryByTestId } = render(<SliderSetting {...baseProps} onChange={onChange} />);
    fireEvent.press(getByTestId('temp-value-button'));
    fireEvent.changeText(getByTestId('temp-input'), 'abc');
    fireEvent(getByTestId('temp-input'), 'submitEditing');
    expect(onChange).not.toHaveBeenCalled();
    // Editing closes regardless, returning to the tappable value.
    expect(queryByTestId('temp-value')).toBeTruthy();
  });

  // ─── Slider drag ────────────────────────────────────────────────────────────

  it('commits a clamped, snapped value on slider release', () => {
    const onChange = jest.fn();
    const { getByTestId } = render(<SliderSetting {...baseProps} onChange={onChange} />);
    fireEvent(getByTestId('temp-slider'), 'slidingComplete', 5);
    expect(onChange).toHaveBeenCalledWith(2);
  });

  it('snaps an off-grid slider value to the nearest step on release', () => {
    const onChange = jest.fn();
    const { getByTestId } = render(<SliderSetting {...baseProps} onChange={onChange} />);
    fireEvent(getByTestId('temp-slider'), 'slidingComplete', 0.72);
    expect(onChange).toHaveBeenCalledWith(0.7);
  });
});
