/**
 * AnimatedListItem Component Tests
 *
 * Tests for the AnimatedListItem wrapper component covering:
 * - Basic rendering with children
 * - Press and long press handlers
 * - Disabled state
 * - Props forwarding
 *
 * The real AnimatedEntry and AnimatedPressable run underneath (react-native-reanimated and haptics
 * are the device boundary, faked in jest.setup).
 */

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { StyleSheet, Text } from 'react-native';

import { AnimatedListItem } from '../../../src/components/AnimatedListItem';

describe('AnimatedListItem', () => {
  it('renders children', () => {
    const { getByText } = render(
      <AnimatedListItem index={0}><Text>Item Content</Text></AnimatedListItem>
    );
    expect(getByText('Item Content')).toBeTruthy();
  });

  it('calls onPress when pressed', () => {
    const onPress = jest.fn();
    const { getByText } = render(
      <AnimatedListItem index={0} onPress={onPress}>
        <Text>Pressable</Text>
      </AnimatedListItem>
    );
    fireEvent.press(getByText('Pressable'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('calls onLongPress when long-pressed', () => {
    const onLongPress = jest.fn();
    const { getByText } = render(
      <AnimatedListItem index={0} onLongPress={onLongPress}>
        <Text>Long Pressable</Text>
      </AnimatedListItem>
    );
    fireEvent(getByText('Long Pressable'), 'longPress');
    expect(onLongPress).toHaveBeenCalledTimes(1);
  });

  it('a disabled item ignores presses', () => {
    const onPress = jest.fn();
    const { getByTestId } = render(
      <AnimatedListItem index={0} onPress={onPress} disabled testID="disabled-item">
        <Text>Disabled</Text>
      </AnimatedListItem>
    );
    fireEvent.press(getByTestId('disabled-item'));
    expect(onPress).not.toHaveBeenCalled();
  });

  it('passes testID to AnimatedPressable', () => {
    const { getByTestId } = render(
      <AnimatedListItem index={0} testID="my-item">
        <Text>With TestID</Text>
      </AnimatedListItem>
    );
    expect(getByTestId('my-item')).toBeTruthy();
  });

  it('passes style to AnimatedPressable', () => {
    const customStyle = { backgroundColor: 'red' };
    const { getByTestId } = render(
      <AnimatedListItem index={0} testID="styled" style={customStyle}>
        <Text>Styled</Text>
      </AnimatedListItem>
    );
    expect(StyleSheet.flatten(getByTestId('styled').props.style)).toMatchObject(customStyle);
  });

  it('renders without onPress or onLongPress', () => {
    const { getByText } = render(
      <AnimatedListItem index={0}><Text>No Handlers</Text></AnimatedListItem>
    );
    expect(getByText('No Handlers')).toBeTruthy();
  });
});
