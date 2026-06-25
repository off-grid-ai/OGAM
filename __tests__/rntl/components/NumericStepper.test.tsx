/**
 * NumericStepper Component Tests
 *
 * Compact +/- stepper used in settings rows. Covers the round-to-step + clamp
 * behaviour on increment/decrement, the min/max boundary guards (no onChange at
 * the edges), decimals rounding via toFixed, the optional formatValue display,
 * and the testID-driven sub-element ids.
 */

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { NumericStepper } from '../../../src/components/NumericStepper';

describe('NumericStepper', () => {
  const baseProps = {
    testID: 'count',
    value: 5,
    min: 0,
    max: 10,
    step: 1,
    onChange: jest.fn(),
  };

  beforeEach(() => jest.clearAllMocks());

  it('renders the value formatted with toFixed(decimals) by default', () => {
    const { getByTestId } = render(
      <NumericStepper {...baseProps} value={0.7} step={0.1} decimals={1} />,
    );
    expect(getByTestId('count-value').props.children).toBe('0.7');
  });

  it('uses formatValue when provided instead of toFixed', () => {
    const { getByTestId } = render(
      <NumericStepper {...baseProps} formatValue={(v) => `${v} items`} />,
    );
    expect(getByTestId('count-value').props.children).toBe('5 items');
  });

  it('increments by step, clamped/rounded to the step grid', () => {
    const onChange = jest.fn();
    const { getByTestId } = render(<NumericStepper {...baseProps} onChange={onChange} />);
    fireEvent.press(getByTestId('count-increment'));
    expect(onChange).toHaveBeenCalledWith(6);
  });

  it('decrements by step', () => {
    const onChange = jest.fn();
    const { getByTestId } = render(<NumericStepper {...baseProps} onChange={onChange} />);
    fireEvent.press(getByTestId('count-decrement'));
    expect(onChange).toHaveBeenCalledWith(4);
  });

  it('does not increment past max (guard branch)', () => {
    const onChange = jest.fn();
    const { getByTestId } = render(
      <NumericStepper {...baseProps} value={10} onChange={onChange} />,
    );
    fireEvent.press(getByTestId('count-increment'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('does not decrement below min (guard branch)', () => {
    const onChange = jest.fn();
    const { getByTestId } = render(
      <NumericStepper {...baseProps} value={0} onChange={onChange} />,
    );
    fireEvent.press(getByTestId('count-decrement'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('blocks an increment that would round past max even when the button is enabled', () => {
    // value (9.5) < max (10) so the increment button is enabled (canIncrement),
    // but round(9.5 + 1) = 11 > max, exercising the `next <= max` false branch.
    const onChange = jest.fn();
    const { getByTestId } = render(
      <NumericStepper testID="t" value={9.5} min={0} max={10} step={1} onChange={onChange} />,
    );
    fireEvent.press(getByTestId('t-increment'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('blocks a decrement that would round below min even when the button is enabled', () => {
    // value (0.4) > min (0) so the decrement button is enabled (canDecrement),
    // but round(0.4 - 1) = round(-0.6) = -1 < min, exercising the `next >= min`
    // false branch.
    const onChange = jest.fn();
    const { getByTestId } = render(
      <NumericStepper testID="t" value={0.4} min={0} max={10} step={1} onChange={onChange} />,
    );
    fireEvent.press(getByTestId('t-decrement'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('rounds an off-grid value to the nearest step on increment', () => {
    const onChange = jest.fn();
    const { getByTestId } = render(
      <NumericStepper testID="t" value={0.72} min={0} max={2} step={0.1} decimals={2} onChange={onChange} />,
    );
    // round(0.72 + 0.1) = round(0.82 / 0.1) * 0.1 = 8 * 0.1 = 0.8 -> "0.80" -> 0.8
    fireEvent.press(getByTestId('t-increment'));
    expect(onChange).toHaveBeenCalledWith(0.8);
  });

  it('applies decimals via toFixed when emitting a value', () => {
    const onChange = jest.fn();
    const { getByTestId } = render(
      <NumericStepper testID="t" value={0.1} min={0} max={1} step={0.3} decimals={2} onChange={onChange} />,
    );
    // round(0.1 + 0.3) = round(0.4 / 0.3) * 0.3 = 1 * 0.3 = 0.30000000000000004
    // parseFloat((0.30000000000000004).toFixed(2)) = 0.3
    fireEvent.press(getByTestId('t-increment'));
    expect(onChange).toHaveBeenCalledWith(0.3);
  });

  it('defaults decimals to 0 when omitted', () => {
    const { getByTestId } = render(
      <NumericStepper testID="t" value={3.0} min={0} max={10} step={1} onChange={jest.fn()} />,
    );
    expect(getByTestId('t-value').props.children).toBe('3');
  });

  it('omits sub-element testIDs when no testID is given (undefined branch)', () => {
    const { queryByTestId } = render(
      <NumericStepper value={5} min={0} max={10} step={1} onChange={jest.fn()} />,
    );
    expect(queryByTestId('count-increment')).toBeNull();
    expect(queryByTestId('count-value')).toBeNull();
  });

  it('disables both buttons at a single-point range (min === max)', () => {
    const onChange = jest.fn();
    const { getByTestId } = render(
      <NumericStepper {...baseProps} value={5} min={5} max={5} onChange={onChange} />,
    );
    fireEvent.press(getByTestId('count-increment'));
    fireEvent.press(getByTestId('count-decrement'));
    expect(onChange).not.toHaveBeenCalled();
    expect(getByTestId('count-increment').props.accessibilityState?.disabled).toBe(true);
    expect(getByTestId('count-decrement').props.accessibilityState?.disabled).toBe(true);
  });
});
