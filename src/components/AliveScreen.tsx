import React from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';
import { LivingField } from './LivingField';

/**
 * A screen on the living field (brand/DESIGN_PHILOSOPHY.md): the safe area, the dot lattice that
 * answers touch, and nothing else. The field rests while the screen is hidden. Every pushed screen
 * uses this instead of its own SafeAreaView, so none of them is a flat white page.
 */
export const AliveScreen: React.FC<{
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  edges?: Edge[];
  testID?: string;
}> = ({ children, style, edges = ['top'], testID }) => {
  const isFocused = useIsFocused();
  return (
    <SafeAreaView style={style} edges={edges} testID={testID}>
      <LivingField active={isFocused} />
      {children}
    </SafeAreaView>
  );
};
