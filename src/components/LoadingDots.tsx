import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated, Easing, ViewStyle } from 'react-native';
import { useTheme } from '../theme';

interface LoadingDotsProps {
  /** Dot colour. Defaults to the accent, which is what a surface uses on its own background. */
  color?: string;
  /** Diameter in points. The dots stay circular at any size. */
  size?: number;
  style?: ViewStyle;
  testID?: string;
}

/**
 * The three-dot busy animation - the ONE loader in this app. It exists as its own component
 * because it had two homes: the animation inside ThinkingIndicator, and a platform
 * ActivityIndicator inside Button. A ring spinner on a button reads as a retry glyph, not as
 * work in progress, so a paired device and a shared file both looked like they had failed.
 * Every busy state renders this, and the animation is defined once.
 */
export const LoadingDots: React.FC<LoadingDotsProps> = ({
  color,
  size = 6,
  style,
  testID,
}) => {
  const { colors } = useTheme();
  // One native loop drives all three dots. Every step of the old per-dot sequence (the stagger
  // delay, the hand-off between rise and fall, each loop restart) went through the JavaScript
  // thread, so the dots froze exactly when that thread was busy: while stores hydrate at boot and
  // while a reply streams. Here the only animation is a single native timing looped natively, and
  // each dot is a native interpolation of it with its own phase, so nothing on the JS thread can
  // stall the motion.
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(progress, {
        toValue: 1,
        duration: 1000,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [progress]);

  // Desktop's loader (Tailwind animate-bounce) rises a quarter of the dot's height; at the sizes used
  // here that is 1 to 2 points and reads as static, so half. Dots are 150ms apart, as on desktop.
  const rise = -size / 2;
  const translateFor = (phase: number) =>
    progress.interpolate({
      inputRange:
        phase > 0
          ? [0, phase, phase + 0.25, phase + 0.5, 1]
          : [0, 0.25, 0.5, 1],
      outputRange: phase > 0 ? [0, 0, rise, 0, 0] : [0, rise, 0, 0],
      easing: Easing.inOut(Easing.quad),
    });
  const dotTransforms = [0, 0.15, 0.3].map(phase => ({
    transform: [{ translateY: translateFor(phase) }],
  }));

  const dotStyle = {
    width: size,
    height: size,
    borderRadius: size / 2,
    backgroundColor: color ?? colors.primary,
  };

  return (
    <View
      style={[styles.dots, style]}
      testID={testID}
      accessibilityRole="progressbar"
      accessibilityLabel="Working"
    >
      {dotTransforms.map((transformStyle, index) => (
        <Animated.View
          key={index}
          style={[styles.dot, dotStyle, transformStyle]}
        />
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  dots: {
    flexDirection: 'row',
    alignItems: 'center',
    // The dots are a fixed width. Without this they give up width to a sibling label on a
    // narrow screen and the animation collapses.
    flexShrink: 0,
  },
  dot: {
    marginHorizontal: 2,
  },
});
