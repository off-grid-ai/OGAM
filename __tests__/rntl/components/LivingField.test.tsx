import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import { LivingField } from '../../../src/components/LivingField';
import { LIVING_FIELD } from '../../../src/constants';

describe('LivingField', () => {
  it('sits behind a screen without taking its touches', () => {
    const onPress = jest.fn();
    const { getByTestId, getByText } = render(
      <View>
        <LivingField />
        <TouchableOpacity onPress={onPress}><Text>New Chat</Text></TouchableOpacity>
      </View>,
    );
    expect(getByTestId('living-field').props.pointerEvents).toBe('none');
    fireEvent.press(getByText('New Chat'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('draws desktop\'s lattice: a dot every 26 px, 1.25 px across, breathing every 3.5 s', () => {
    expect(LIVING_FIELD).toEqual({
      spacing: 26,
      dotRadius: 1.25,
      dotAlphaDark: 0.11,
      dotAlphaLight: 0.16,
      breathMs: 3500,
    });
    const { UNSAFE_root } = render(<LivingField />);
    const pattern = UNSAFE_root.findAll(n => n.props.patternUnits === 'userSpaceOnUse')[0];
    expect(pattern.props.width).toBe(LIVING_FIELD.spacing);
    expect(pattern.findAll(n => n.props.r === LIVING_FIELD.dotRadius).length).toBeGreaterThan(0);
  });
});
