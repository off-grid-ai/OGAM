/**
 * AnimatedPressable Component Tests
 *
 * Tests for the pressable component with scale animation and haptic feedback:
 * - Renders children correctly
 * - Press event handlers (onPress, onPressIn, onPressOut, onLongPress)
 * - Disabled state (reduced opacity, no press response)
 * - Haptic feedback integration
 * - Accessibility props passthrough
 *
 * Priority: P1 (High)
 */

import React from 'react';
import { Text } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';
import { AnimatedPressable } from '../../../src/components/AnimatedPressable';

// The device's haptic engine is the boundary: the real haptics helper calls it.
jest.mock('react-native-haptic-feedback', () => ({
  __esModule: true,
  default: { trigger: jest.fn() },
}));

const { default: hapticEngine } = require('react-native-haptic-feedback');
/** The haptic the device was asked to play, by type. */
const played = () => (hapticEngine.trigger as jest.Mock).mock.calls.map(([type]) => type);
 
const Reanimated = require('react-native-reanimated');

describe('AnimatedPressable', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ============================================================================
  // Rendering
  // ============================================================================
  it('renders children', () => {
    const { getByText } = render(
      <AnimatedPressable>
        <Text>Press me</Text>
      </AnimatedPressable>,
    );
    expect(getByText('Press me')).toBeTruthy();
  });

  // ============================================================================
  // Press Events
  // ============================================================================
  it('calls onPress when pressed', () => {
    const onPress = jest.fn();
    const { getByTestId } = render(
      <AnimatedPressable onPress={onPress} testID="pressable">
        <Text>Tap</Text>
      </AnimatedPressable>,
    );
    fireEvent.press(getByTestId('pressable'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('calls onPressIn and onPressOut', () => {
    const onPressIn = jest.fn();
    const onPressOut = jest.fn();
    const { getByTestId } = render(
      <AnimatedPressable
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        testID="pressable"
      >
        <Text>Tap</Text>
      </AnimatedPressable>,
    );
    fireEvent(getByTestId('pressable'), 'pressIn');
    expect(onPressIn).toHaveBeenCalledTimes(1);

    fireEvent(getByTestId('pressable'), 'pressOut');
    expect(onPressOut).toHaveBeenCalledTimes(1);
  });

  it('calls onLongPress on long press', () => {
    const onLongPress = jest.fn();
    const { getByTestId } = render(
      <AnimatedPressable onLongPress={onLongPress} testID="pressable">
        <Text>Hold</Text>
      </AnimatedPressable>,
    );
    fireEvent(getByTestId('pressable'), 'longPress');
    expect(onLongPress).toHaveBeenCalledTimes(1);
  });

  // ============================================================================
  // Disabled State
  // ============================================================================
  it('has reduced opacity and does not respond to press when disabled', () => {
    const onPress = jest.fn();
    const { getByTestId } = render(
      <AnimatedPressable onPress={onPress} disabled testID="pressable">
        <Text>Disabled</Text>
      </AnimatedPressable>,
    );
    const element = getByTestId('pressable');

    // Check reduced opacity is applied via the style array
    const flatStyle = Array.isArray(element.props.style)
      ? Object.assign({}, ...element.props.style.filter(Boolean))
      : element.props.style;
    expect(flatStyle.opacity).toBe(0.4);

    // TouchableOpacity with disabled=true won't fire onPress
    fireEvent.press(element);
    expect(onPress).not.toHaveBeenCalled();
  });

  // ============================================================================
  // Haptic Feedback
  // ============================================================================
  it('triggers haptic feedback when hapticType is provided', () => {
    const { getByTestId } = render(
      <AnimatedPressable hapticType="impactLight" testID="pressable">
        <Text>Haptic</Text>
      </AnimatedPressable>,
    );
    fireEvent(getByTestId('pressable'), 'pressIn');
    expect(played()).toContain('impactLight');
  });

  it('does not trigger haptic feedback when hapticType is not provided', () => {
    const { getByTestId } = render(
      <AnimatedPressable testID="pressable">
        <Text>No haptic</Text>
      </AnimatedPressable>,
    );
    fireEvent(getByTestId('pressable'), 'pressIn');
    expect(played()).toEqual([]);
  });

  // ============================================================================
  // Reduced Motion
  // ============================================================================
  it('still fires onPressIn callback when reducedMotion is true (skips animation only)', () => {
    Reanimated.useReducedMotion.mockReturnValueOnce(true);
    const onPressIn = jest.fn();
    const { getByTestId } = render(
      <AnimatedPressable onPressIn={onPressIn} testID="pressable">
        <Text>RM</Text>
      </AnimatedPressable>,
    );
    fireEvent(getByTestId('pressable'), 'pressIn');
    expect(onPressIn).toHaveBeenCalledTimes(1);
    // Animation (withSpring) should NOT have been called since reducedMotion=true
    expect(Reanimated.withSpring).not.toHaveBeenCalled();
  });

  it('still fires onPressOut callback when reducedMotion is true (skips animation only)', () => {
    Reanimated.useReducedMotion.mockReturnValueOnce(true);
    const onPressOut = jest.fn();
    const { getByTestId } = render(
      <AnimatedPressable onPressOut={onPressOut} testID="pressable">
        <Text>RM</Text>
      </AnimatedPressable>,
    );
    fireEvent(getByTestId('pressable'), 'pressOut');
    expect(onPressOut).toHaveBeenCalledTimes(1);
    expect(Reanimated.withSpring).not.toHaveBeenCalled();
  });

  it('still triggers haptic when reducedMotion is true', () => {
    Reanimated.useReducedMotion.mockReturnValueOnce(true);
    const { getByTestId } = render(
      <AnimatedPressable hapticType="impactMedium" testID="pressable">
        <Text>RM haptic</Text>
      </AnimatedPressable>,
    );
    fireEvent(getByTestId('pressable'), 'pressIn');
    expect(played()).toContain('impactMedium');
  });

  // ============================================================================
  // Accessibility Props
  // ============================================================================
  it('passes testID and accessibilityLabel', () => {
    const { getByTestId, getByLabelText } = render(
      <AnimatedPressable
        testID="my-button"
        accessibilityLabel="Submit form"
      >
        <Text>Submit</Text>
      </AnimatedPressable>,
    );
    expect(getByTestId('my-button')).toBeTruthy();
    expect(getByLabelText('Submit form')).toBeTruthy();
  });
});
