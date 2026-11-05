import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Defs, Pattern, RadialGradient, Rect, Stop } from 'react-native-svg';
import { useTheme } from '../theme';
import { LIVING_FIELD } from '../constants';

const GLOW_SIZE = 560;
const ECHO_SIZE = 440;

/**
 * The living background, as desktop draws it: a dot lattice behind everything, an emerald light and
 * its echo breathing against each other, the lattice breathing with them. It sits behind a screen's
 * content and never takes a touch. With reduced motion it holds still.
 */
export const LivingField: React.FC = () => {
  const { colors, isDark } = useTheme();
  const reducedMotion = useReducedMotion();
  const phase = useSharedValue(0);

  useEffect(() => {
    if (reducedMotion) return;
    phase.value = withRepeat(
      withTiming(1, { duration: LIVING_FIELD.breathMs, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
  }, [phase, reducedMotion]);

  const glowStyle = useAnimatedStyle(() => ({
    opacity: 0.6 + 0.32 * phase.value,
    transform: [{ scale: 0.92 + 0.16 * phase.value }],
  }));
  const echoStyle = useAnimatedStyle(() => ({
    opacity: 0.65 - 0.3 * phase.value,
    transform: [{ scale: 1.08 - 0.12 * phase.value }],
  }));
  const latticeStyle = useAnimatedStyle(() => ({ opacity: 0.82 + 0.18 * phase.value }));

  const dot = isDark
    ? `rgba(255,255,255,${LIVING_FIELD.dotAlphaDark})`
    : `rgba(10,10,10,${LIVING_FIELD.dotAlphaLight})`;
  const { spacing, dotRadius } = LIVING_FIELD;

  return (
    <View style={styles.fill} pointerEvents="none" testID="living-field">
      <Animated.View style={[styles.glow, glowStyle]}>
        <Light id="field-glow" size={GLOW_SIZE} color={colors.primary} stops={[0.26, 0.09]} />
      </Animated.View>
      <Animated.View style={[styles.echo, echoStyle]}>
        <Light id="field-echo" size={ECHO_SIZE} color={colors.primaryDark} stops={[0.13, 0]} />
      </Animated.View>
      <Animated.View style={[styles.fill, latticeStyle]}>
        <Svg width="100%" height="100%">
          <Defs>
            <Pattern id="field-dots" width={spacing} height={spacing} patternUnits="userSpaceOnUse">
              <Circle cx={spacing / 2} cy={spacing / 2} r={dotRadius} fill={dot} />
            </Pattern>
          </Defs>
          <Rect width="100%" height="100%" fill="url(#field-dots)" />
        </Svg>
      </Animated.View>
    </View>
  );
};

/** One soft round light: full at the centre, fading out by 72% of its radius. */
const Light: React.FC<{ id: string; size: number; color: string; stops: [number, number] }> = ({
  id,
  size,
  color,
  stops,
}) => (
  <Svg width={size} height={size}>
    <Defs>
      <RadialGradient id={id} cx="50%" cy="50%" r="50%">
        <Stop offset="0" stopColor={color} stopOpacity={stops[0]} />
        <Stop offset="0.45" stopColor={color} stopOpacity={stops[1]} />
        <Stop offset="0.72" stopColor={color} stopOpacity={0} />
      </RadialGradient>
    </Defs>
    <Rect width={size} height={size} fill={`url(#${id})`} />
  </Svg>
);

const styles = StyleSheet.create({
  fill: { ...StyleSheet.absoluteFillObject },
  // Desktop lights the left side of the page; the echo answers lower down.
  glow: { position: 'absolute', left: -260, top: -60, width: GLOW_SIZE, height: GLOW_SIZE },
  echo: { position: 'absolute', left: 160, top: 520, width: ECHO_SIZE, height: ECHO_SIZE },
});
