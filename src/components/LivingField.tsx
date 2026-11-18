import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  css,
  useAnimatedProps,
  useAnimatedReaction,
  useAnimatedStyle,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import Svg, { Circle, Defs, LinearGradient, Mask, Pattern, RadialGradient, Rect, Stop } from 'react-native-svg';
import { useTheme } from '../theme';
import { ALIVE, LIVING_FIELD } from '../constants';
import { useAlive, type AliveSignals } from './AliveProvider';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const GLOW_SIZE = 560;
/** Text never sits on the dots: the lattice is clear behind the status bar and a screen's header,
 *  then fades in below it. The light still shows there; only the dots step back (Mac, 2026-11-08). */
const HEADER_CLEAR = 156;
const HEADER_FADE = 40;
const ECHO_SIZE = 440;
/** How long the field keeps breathing after the last touch or scroll before it rests. A breathing
 *  field redraws the whole screen every frame, a third of a core on a mid-range Android phone, so it
 *  rests while nobody touches the screen and breathes only on interaction (Android lag, 0.0.124). */
const REST_AFTER_MS = 8000;

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
  const canBreathe = active && appActive && !reducedMotion;
  const awake = useAwake(alive, canBreathe);
  const breathing = canBreathe && awake;
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
      <Animated.View renderToHardwareTextureAndroid style={[styles.light, { left: -0.66 * width, top: -0.07 * height }, breath.glow, { animationPlayState: playState }]}>
        <Light id="field-glow" size={GLOW_SIZE} color={colors.primary} stops={[0.26, 0.09]} />
      </Animated.View>
      <Animated.View renderToHardwareTextureAndroid style={[styles.light, { left: 0.41 * width, top: 0.6 * height }, breath.echo, { animationPlayState: playState }]}>
        <Light id="field-echo" size={ECHO_SIZE} color={colors.primaryDark} stops={[0.13, 0]} />
      </Animated.View>
      <Animated.View renderToHardwareTextureAndroid style={[styles.lattice, { height: latticeHeight }, breath.lattice, { animationPlayState: playState }]}>
       <Animated.View style={driftStyle}>
        <Svg width={width} height={latticeHeight}>
          <Defs>
            <Pattern id="field-dots" width={spacing} height={spacing} patternUnits="userSpaceOnUse">
              <Circle cx={spacing / 2} cy={spacing / 2} r={dotRadius} fill={dot} />
            </Pattern>
            <LinearGradient id="field-header-fade" x1="0" y1="0" x2="0" y2={latticeHeight} gradientUnits="userSpaceOnUse">
              <Stop offset={HEADER_CLEAR / latticeHeight} stopColor="#fff" stopOpacity={0} />
              <Stop offset={(HEADER_CLEAR + HEADER_FADE) / latticeHeight} stopColor="#fff" stopOpacity={1} />
            </LinearGradient>
            <Mask id="field-header-clear" maskUnits="userSpaceOnUse" x="0" y="0" width={width} height={latticeHeight}>
              <Rect width={width} height={latticeHeight} fill="url(#field-header-fade)" />
            </Mask>
            <Pattern id="field-dots-lit" width={spacing} height={spacing} patternUnits="userSpaceOnUse">
              <Circle cx={spacing / 2} cy={spacing / 2} r={dotRadius * 1.15} fill={colors.primary} fillOpacity={litAlpha} />
            </Pattern>
          </Defs>
          <Rect width={width} height={latticeHeight} fill="url(#field-dots)" mask="url(#field-header-clear)" />
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

/**
 * Whether the field should be breathing: only after a touch or scroll, until REST_AFTER_MS after the
 * last one. At rest nothing redraws. Touches and scrolls are read on the UI thread; JavaScript hears
 * only the wake from rest, and the timer checks the last activity before it lets the field rest.
 */
function useAwake(alive: AliveSignals | null, enabled: boolean): boolean {
  const [awake, setAwake] = useState(false);
  const resting = useSharedValue(true);
  const lastActivity = useSharedValue(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const restLater = useCallback(
    (delay: number) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        const quietFor = Date.now() - lastActivity.value;
        if (quietFor < REST_AFTER_MS) {
          restLater(REST_AFTER_MS - quietFor);
          return;
        }
        resting.value = true;
        setAwake(false);
      }, delay);
    },
    [lastActivity, resting],
  );
  const wake = useCallback(() => {
    resting.value = false;
    setAwake(true);
    restLater(REST_AFTER_MS);
  }, [resting, restLater]);

  // A hidden screen or a backgrounded app rests at once; it wakes again on the next touch.
  useEffect(() => {
    if (enabled) return undefined;
    if (timer.current) clearTimeout(timer.current);
    resting.value = true;
    setAwake(false);
    return undefined;
  }, [enabled, resting]);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  useAnimatedReaction(
    () => (alive ? [alive.touchX.value, alive.touchY.value, alive.scrollY.value] : null),
    (now, before) => {
      if (!enabled || !now || !before) return;
      if (now[0] === before[0] && now[1] === before[1] && now[2] === before[2]) return;
      lastActivity.value = Date.now();
      if (resting.value) {
        resting.value = false;
        scheduleOnRN(wake);
      }
    },
    [alive, enabled, wake],
  );
  return awake;
}

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
