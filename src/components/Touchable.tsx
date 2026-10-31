/**
 * The app's touchables. Each counts the press by its testID first (session_summary.actions,
 * docs/ANALYTICS.md), then runs the handler unchanged. Import these instead of react-native's: an
 * ESLint rule enforces it, so a new button is counted without anyone remembering to.
 *
 * Only the testID is read, never the label or any visible text. The count is a no-op until the
 * person opts in to Anonymous stats.
 */
import React, { forwardRef } from 'react';
import {
  TouchableOpacity as RNTouchableOpacity,
  Pressable as RNPressable,
  Switch as RNSwitch,
  type PressableProps,
  type SwitchProps,
  type TouchableOpacityProps,
  type View,
} from 'react-native';
import { countLongPress, countPress } from '../services/analytics/interactions';

/** Wrap a handler so it counts first. No handler stays no handler (a touchable without one is inert). */
function counted<A extends unknown[], R>(
  count: (testID: string | null | undefined) => void,
  testID: string | null | undefined,
  handler: ((...args: A) => R) | null | undefined,
): ((...args: A) => R) | undefined {
  if (!handler) return undefined;
  return (...args: A) => {
    count(testID);
    return handler(...args);
  };
}

type RNTouchableOpacityRef = React.ElementRef<typeof RNTouchableOpacity>;

export const TouchableOpacity = forwardRef<RNTouchableOpacityRef, TouchableOpacityProps>(
  function TouchableOpacity(props, ref) {
    return (
      <RNTouchableOpacity
        {...props}
        ref={ref}
        onPress={counted(countPress, props.testID, props.onPress)}
        onLongPress={counted(countLongPress, props.testID, props.onLongPress)}
      />
    );
  },
);

export const Pressable = forwardRef<View, PressableProps>(function Pressable(props, ref) {
  return (
    <RNPressable
      {...props}
      ref={ref}
      onPress={counted(countPress, props.testID, props.onPress)}
      onLongPress={counted(countLongPress, props.testID, props.onLongPress)}
    />
  );
});

/** A switch change counts like a press, by its testID (never its value). */
export const Switch = forwardRef<RNSwitch, SwitchProps>(function Switch(props, ref) {
  return (
    <RNSwitch
      {...props}
      ref={ref}
      onValueChange={counted(countPress, props.testID, props.onValueChange)}
    />
  );
});
