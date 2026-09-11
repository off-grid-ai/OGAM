import React, { useCallback } from 'react';
import { TouchableOpacity, StyleSheet, type TouchableOpacityProps, type StyleProp, type ViewStyle, type GestureResponderEvent } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  useReducedMotion,
} from 'react-native-reanimated';
import { triggerHaptic, type HapticType } from '../utils/haptics';

// Use TouchableOpacity instead of Pressable as the base component.
// Pressable wrapped in Reanimated's Animated.createAnimatedComponent inside
// a Modal has a known double-tap issue on Android where the first tap gets
// swallowed by the Dialog touch dispatch layer.
const AnimatedTouchable = Animated.createAnimatedComponent(TouchableOpacity);

export interface AnimatedPressableProps {
  scaleValue?: number;
  hapticType?: HapticType;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
  onPress?: (event: GestureResponderEvent) => void;
  onPressIn?: (event: GestureResponderEvent) => void;
  onPressOut?: (event: GestureResponderEvent) => void;
  onLongPress?: (event: GestureResponderEvent) => void;
  testID?: string;
  hitSlop?: TouchableOpacityProps['hitSlop'];
  accessibilityLabel?: string;
  accessibilityRole?: TouchableOpacityProps['accessibilityRole'];
  accessibilityState?: TouchableOpacityProps['accessibilityState'];
  accessibilityHint?: string;
}

export function AnimatedPressable({
  scaleValue = 0.97,
  hapticType,
  disabled = false,
  style,
  children,
  onPressIn,
  onPressOut,
  onPress,
  onLongPress,
  testID,
  hitSlop,
  accessibilityLabel,
  accessibilityRole,
  accessibilityState,
  accessibilityHint,
}: AnimatedPressableProps) {
  const scale = useSharedValue(1);
  const reducedMotion = useReducedMotion();

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = useCallback(
    (e: any) => {
      if (!disabled && !reducedMotion) {
        scale.value = withSpring(scaleValue, { damping: 15, stiffness: 400 });
      }
      if (hapticType) {
        triggerHaptic(hapticType);
      }
      onPressIn?.(e);
    },
    [disabled, reducedMotion, scaleValue, hapticType, onPressIn, scale],
  );

  const handlePressOut = useCallback(
    (e: any) => {
      if (!disabled && !reducedMotion) {
        scale.value = withSpring(1, { damping: 10, stiffness: 400 });
      }
      onPressOut?.(e);
    },
    [disabled, reducedMotion, onPressOut, scale],
  );

  return (
    <AnimatedTouchable
      activeOpacity={1}
      disabled={disabled}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      onPress={onPress}
      onLongPress={onLongPress}
      testID={testID}
      hitSlop={hitSlop}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole={accessibilityRole}
      accessibilityState={accessibilityState}
      accessibilityHint={accessibilityHint}
      style={[animatedStyle, styles.base, disabled && styles.disabled, style]}
    >
      {children}
    </AnimatedTouchable>
  );
}

const styles = StyleSheet.create({
  base: {
    overflow: 'visible',
  },
  disabled: {
    opacity: 0.4,
  },
});
