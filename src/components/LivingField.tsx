import React, { useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  css,
  useAnimatedProps,
  useAnimatedStyle,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
} from 'react-native-reanimated';
import Svg, { Circle, Defs, Pattern, RadialGradient, Rect, Stop } from 'react-native-svg';
import { useTheme } from '../theme';
import { ALIVE, LIVING_FIELD } from '../constants';
import { useAlive, type AliveSignals } from './AliveProvider';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const GLOW_SIZE = 560;
const ECHO_SIZE = 440;

/**
 * The living background, as desktop draws it: a dot lattice behind everything, an emerald light and
 * its echo breathing against each other. It answers the person, as desktop's does: the dots under a
 * finger light up and fade as it lifts, a press sends a ring out through the lattice, and scrolling
 * moves the lattice. It never takes a touch. With reduced motion it holds still.
 *
 * Nothing here runs on the JavaScript thread. The breathing is declared as CSS keyframes (as desktop's
 * alive.css) and runs natively; the light, the ring and the drift are UI-thread values from
 * AliveProvider. JavaScript only measures where the field sits, once per layout.
 */
export const LivingField: React.FC<{
  /** False while the screen is out of focus: the field stops breathing, so a hidden screen costs nothing. */
  active?: boolean;
}> = ({ active = true }) => {
  const { colors, isDark } = useTheme();
  const { width, height } = useWindowDimensions();
  const reducedMotion = useReducedMotion();
  const appActive = useAppActive();
  const alive = useAlive();
  const breathing = active && appActive && !reducedMotion;
  const playState = breathing ? 'running' : 'paused';

  // Where the field sits in the window, so a finger's window position maps onto its dots.
  const fieldRef = useRef<View>(null);
  const originX = useSharedValue(0);
  const originY = useSharedValue(0);
  const measure = () =>
    fieldRef.current?.measureInWindow((x, y) => {
      originX.value = x;
      originY.value = y;
    });

  const { spacing, dotRadius } = LIVING_FIELD;
  const drift = useDerivedValue(() =>
    alive && !reducedMotion ? -((alive.scrollY.value * ALIVE.scrollDrift) % spacing) : 0,
  );

  const driftStyle = useAnimatedStyle(() => ({ transform: [{ translateY: drift.value }] }));
  // The light under the finger, and the ring a press sends out (desktop: 1.1 px/ms to 520 px).
  // Three widening, fainter discs of lit dots make the light's soft falloff.
  const lightOuter = useAnimatedProps(() => lightDisc(active ? alive : null, originX.value, originY.value, drift.value, 1, 0.35), [active]);
  const lightMid = useAnimatedProps(() => lightDisc(active ? alive : null, originX.value, originY.value, drift.value, 0.6, 0.45), [active]);
  const lightCore = useAnimatedProps(() => lightDisc(active ? alive : null, originX.value, originY.value, drift.value, 0.3, 0.6), [active]);
  // Only the visible screen's field answers: a hidden tab's stays dark and costs no redraw.
  const ringProps = useAnimatedProps(() => {
    const radius = alive && active ? alive.ringRadius.value : ALIVE.ringReach;
    return {
      cx: alive ? alive.ringX.value - originX.value : -1000,
      cy: alive ? alive.ringY.value - originY.value - drift.value : -1000,
      r: radius,
      opacity: Math.max(0, 1 - radius / ALIVE.ringReach) * 0.9,
    };
  }, [active]);

  const dot = isDark
    ? `rgba(255,255,255,${LIVING_FIELD.dotAlphaDark})`
    : `rgba(10,10,10,${LIVING_FIELD.dotAlphaLight})`;
  const litAlpha = isDark ? ALIVE.litAlphaDark : ALIVE.litAlphaLight;
  const latticeHeight = height + spacing;

  return (
    <View ref={fieldRef} onLayout={measure} style={styles.fill} pointerEvents="none" testID="living-field">
      <Animated.View style={[styles.light, { left: -0.66 * width, top: -0.07 * height }, breath.glow, { animationPlayState: playState }]}>
        <Light id="field-glow" size={GLOW_SIZE} color={colors.primary} stops={[0.26, 0.09]} />
      </Animated.View>
      <Animated.View style={[styles.light, { left: 0.41 * width, top: 0.6 * height }, breath.echo, { animationPlayState: playState }]}>
        <Light id="field-echo" size={ECHO_SIZE} color={colors.primaryDark} stops={[0.13, 0]} />
      </Animated.View>
      <Animated.View style={[styles.lattice, { height: latticeHeight }, breath.lattice, { animationPlayState: playState }]}>
       <Animated.View style={driftStyle}>
        <Svg width={width} height={latticeHeight}>
          <Defs>
            <Pattern id="field-dots" width={spacing} height={spacing} patternUnits="userSpaceOnUse">
              <Circle cx={spacing / 2} cy={spacing / 2} r={dotRadius} fill={dot} />
            </Pattern>
            <Pattern id="field-dots-lit" width={spacing} height={spacing} patternUnits="userSpaceOnUse">
              <Circle cx={spacing / 2} cy={spacing / 2} r={dotRadius * 1.15} fill={colors.primary} fillOpacity={litAlpha} />
            </Pattern>
          </Defs>
          <Rect width={width} height={latticeHeight} fill="url(#field-dots)" />
          {/* The light under a finger: lit dots in three widening, fainter rings of the pattern (a
              soft falloff without a mask, which react-native-svg does not redraw as it animates). */}
          <AnimatedCircle animatedProps={lightOuter} fill="url(#field-dots-lit)" />
          <AnimatedCircle animatedProps={lightMid} fill="url(#field-dots-lit)" />
          <AnimatedCircle animatedProps={lightCore} fill="url(#field-dots-lit)" />
          {/* The ring a press sends out, stroked with the same lit dots. */}
          <AnimatedCircle animatedProps={ringProps} fill="none" stroke="url(#field-dots-lit)" strokeWidth={ALIVE.ringBand} />
        </Svg>
       </Animated.View>
      </Animated.View>
    </View>
  );
};

// Desktop's alive.css keyframes (og-field-breathe, og-field-echo, og-field-lattice): the light and
// its echo breathe against each other, and the lattice breathes with them. Native CSS animations:
// no JavaScript runs per frame.
const breathe = (keyframes: ReturnType<typeof css.keyframes>) => ({
  animationName: keyframes,
  animationDuration: LIVING_FIELD.breathMs,
  animationIterationCount: 'infinite' as const,
  animationDirection: 'alternate' as const,
  animationTimingFunction: 'ease-in-out' as const,
});
const breath = css.create({
  glow: breathe(
    css.keyframes({
      from: { opacity: 0.6, transform: [{ scale: 0.92 }] },
      to: { opacity: 0.92, transform: [{ scale: 1.08 }] },
    }),
  ),
  echo: breathe(
    css.keyframes({
      from: { opacity: 0.65, transform: [{ scale: 1.08 }] },
      to: { opacity: 0.35, transform: [{ scale: 0.96 }] },
    }),
  ),
  lattice: breathe(css.keyframes({ from: { opacity: 0.82 }, to: { opacity: 1 } })),
});

/** One disc of the finger's light, in the field's own coordinates. */
function lightDisc(
  alive: AliveSignals | null,
  originX: number,
  originY: number,
  drift: number,
  scale: number,
  strength: number,
) {
  'worklet';
  return {
    cx: alive ? alive.touchX.value - originX : -1000,
    cy: alive ? alive.touchY.value - originY - drift : -1000,
    r: ALIVE.lightRadius * scale,
    opacity: alive ? alive.touch.value * strength : 0,
  };
}

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

/** Whether the app is in the foreground: the field rests while it is in the background. */
function useAppActive(): boolean {
  const [active, setActive] = useState(AppState.currentState !== 'background');
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => setActive(state === 'active'));
    return () => sub.remove();
  }, []);
  return active;
}

const styles = StyleSheet.create({
  fill: { ...StyleSheet.absoluteFillObject, overflow: 'hidden' },
  // Desktop lights the left side of the page; the echo answers lower down (placed per screen size).
  light: { position: 'absolute' },
  lattice: { position: 'absolute', left: 0, right: 0, top: 0 },
});
