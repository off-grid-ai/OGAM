import React, { useEffect } from 'react';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  useReducedMotion,
} from 'react-native-reanimated';
import { type ViewStyle } from 'react-native';

export interface AnimatedEntryProps {
  index?: number;
  delay?: number;
  staggerMs?: number;
  maxItems?: number;
  from?: ViewStyle;
  animate?: ViewStyle;
  transition?: Record<string, any>;
  /** Change this value to replay the animation (e.g. pass a focus counter) */
  trigger?: number;
  children: React.ReactNode;
}

export function AnimatedEntry({
  index = 0,
  delay,
  staggerMs = 30,
  maxItems = 10,
  from = { opacity: 0, translateY: 12 },
  animate = { opacity: 1, translateY: 0 },
  transition = { type: 'timing' as const, duration: 300 },
  trigger,
  children,
}: AnimatedEntryProps) {
  const reducedMotion = useReducedMotion();
  const opacity = useSharedValue((from as any).opacity ?? 1);
  const translateY = useSharedValue((from as any).translateY ?? 0);

  const computedDelay = delay ?? index * staggerMs;
  const duration = transition?.duration ?? 300;

  useEffect(() => {
    if (reducedMotion || index >= maxItems) return;
    // Reset to initial values before animating
    opacity.value = (from as any).opacity ?? 1;
    translateY.value = (from as any).translateY ?? 0;
    const targetOpacity = (animate as any).opacity ?? 1;
    const targetTranslateY = (animate as any).translateY ?? 0;
    opacity.value = withDelay(computedDelay, withTiming(targetOpacity, { duration }));
    translateY.value = withDelay(computedDelay, withTiming(targetTranslateY, { duration }));

  }, [trigger, reducedMotion, index, maxItems, from, animate, computedDelay, duration, opacity, translateY]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  if (reducedMotion || index >= maxItems) {
    return <>{children}</>;
  }

  return (
    <Animated.View style={[animatedStyle, { overflow: 'visible' as const }]}>
      {children}
    </Animated.View>
  );
}
