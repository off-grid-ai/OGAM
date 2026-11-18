import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Image, Platform, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  css,
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
import { useIsFocused } from '@react-navigation/native';

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
/** The finger light and the press ring, sized for a phone (desktop's ALIVE values span a whole phone). */
const TOUCH_LIGHT = 140;
const RING_REACH = 130;
const RING_BAND = 8;
/** On Android the field holds still: no breathing, no finger light, no ring, no scroll drift. Even
 *  at rest those layers doubled the dropped frames while moving between screens, and smooth
 *  navigation matters more than the motion (Mac, 2026-11-18). iPhone keeps the living field. */
const STILL_FIELD = Platform.OS === 'android';
// Android draws react-native-svg in software on the UI thread: the dot lattice took 43% of the UI
// thread on every tab switch and the two lights another 18%. So Android shows the same field as
// pictures (a dot tile and the two lights, made by scripts/make-field-assets.py), which the GPU
// draws for free.
const FIELD_IMAGES = {
  light: {
    dots: require('../assets/field/dots-light.png'),
    glow: require('../assets/field/glow-light.png'),
    echo: require('../assets/field/echo-light.png'),
  },
  dark: {
    dots: require('../assets/field/dots-dark.png'),
    glow: require('../assets/field/glow-dark.png'),
    echo: require('../assets/field/echo-dark.png'),
  },
};

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
  const motionAlive = useAlive();
  const still = STILL_FIELD || reducedMotion;
  const alive = still ? null : motionAlive;
  const canBreathe = active && appActive && !still;
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
    alive ? -((alive.scrollY.value * ALIVE.scrollDrift) % spacing) : 0,
  );

  const driftStyle = useAnimatedStyle(() => ({ transform: [{ translateY: drift.value }] }));
  // The light under the finger, and the ring a press sends out (desktop: 1.1 px/ms to 520 px).
  // Each is drawn once and only moves, scales and fades: on Android an SVG redraws as one whole
  // bitmap, so lighting dots inside the lattice re-rasterised the screen on every finger and scroll
  // frame (10% janky frames while scrolling; 0.6% with these layers apart).
  // Only the visible screen's field answers: a hidden tab's stays dark.
  // Phone-sized: the desktop's 520 px ring crossed the whole screen. Same timing, a quarter the reach.
  const lightStyle = useAnimatedStyle(() => {
    const on = alive && active;
    return {
      opacity: on ? alive.touch.value : 0,
      transform: [
        { translateX: on ? alive.touchX.value - originX.value - TOUCH_LIGHT : -2000 },
        { translateY: on ? alive.touchY.value - originY.value - TOUCH_LIGHT : -2000 },
      ],
    };
  }, [active]);
  const ringStyle = useAnimatedStyle(() => {
    const on = alive && active;
    const radius = on ? alive.ringRadius.value : ALIVE.ringReach;
    return {
      opacity: Math.max(0, 1 - radius / ALIVE.ringReach) * 0.9,
      transform: [
        { translateX: on ? alive.ringX.value - originX.value - RING_REACH : -2000 },
        { translateY: on ? alive.ringY.value - originY.value - RING_REACH : -2000 },
        { scale: Math.max(0.001, radius / ALIVE.ringReach) },
      ],
    };
  }, [active]);

  const dot = isDark
    ? `rgba(255,255,255,${LIVING_FIELD.dotAlphaDark})`
    : `rgba(10,10,10,${LIVING_FIELD.dotAlphaLight})`;
  const litAlpha = isDark ? ALIVE.litAlphaDark : ALIVE.litAlphaLight;
  const latticeHeight = height + spacing;

  if (STILL_FIELD) {
    const images = isDark ? FIELD_IMAGES.dark : FIELD_IMAGES.light;
    return (
      <View style={styles.fill} pointerEvents="none" testID="living-field">
        <Image source={images.glow} fadeDuration={0} style={[styles.light, styles.stillGlow, { left: -0.66 * width, top: -0.07 * height, width: GLOW_SIZE, height: GLOW_SIZE }]} />
        <Image source={images.echo} fadeDuration={0} style={[styles.light, styles.stillEcho, { left: 0.41 * width, top: 0.6 * height, width: ECHO_SIZE, height: ECHO_SIZE }]} />
        {/* Clear behind the status bar and header, as the drawn field's fade. */}
        <Image source={images.dots} fadeDuration={0} resizeMode="repeat" style={[styles.stillDots, { top: HEADER_CLEAR + HEADER_FADE / 2, width, height: height - HEADER_CLEAR }]} />
      </View>
    );
  }
  return (
    <View ref={fieldRef} onLayout={measure} style={styles.fill} pointerEvents="none" testID="living-field">
      <Animated.View renderToHardwareTextureAndroid style={[styles.light, { left: -0.66 * width, top: -0.07 * height }, still ? styles.stillGlow : breath.glow, still ? null : { animationPlayState: playState }]}>
        <Light id="field-glow" size={GLOW_SIZE} color={colors.primary} stops={[0.26, 0.09]} />
      </Animated.View>
      <Animated.View renderToHardwareTextureAndroid style={[styles.light, { left: 0.41 * width, top: 0.6 * height }, still ? styles.stillEcho : breath.echo, still ? null : { animationPlayState: playState }]}>
        <Light id="field-echo" size={ECHO_SIZE} color={colors.primaryDark} stops={[0.13, 0]} />
      </Animated.View>
      <Animated.View style={[styles.lattice, { height: latticeHeight }, still ? styles.stillLattice : breath.lattice, still ? null : { animationPlayState: playState }]}>
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
          </Defs>
          <Rect width={width} height={latticeHeight} fill="url(#field-dots)" mask="url(#field-header-clear)" />
        </Svg>
       </Animated.View>
      </Animated.View>
      {still ? null : (
      <>
      <Animated.View renderToHardwareTextureAndroid style={[styles.touch, { width: TOUCH_LIGHT * 2, height: TOUCH_LIGHT * 2 }, lightStyle]}>
        <Light id="field-touch" size={TOUCH_LIGHT * 2} color={colors.primary} stops={[litAlpha * 0.22, litAlpha * 0.06]} />
      </Animated.View>
      <Animated.View renderToHardwareTextureAndroid style={[styles.touch, { width: RING_REACH * 2, height: RING_REACH * 2 }, ringStyle]}>
        <Svg width={RING_REACH * 2} height={RING_REACH * 2}>
          <Circle
            cx={RING_REACH}
            cy={RING_REACH}
            r={RING_REACH - RING_BAND / 2}
            fill="none"
            stroke={colors.primary}
            strokeOpacity={litAlpha * 0.2}
            strokeWidth={RING_BAND}
          />
        </Svg>
      </Animated.View>
      </>
      )}
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

/**
 * A screen's field, resting while the screen is out of focus. It reads focus itself, so a tab
 * switch re-renders only the field, never the screen around it.
 */
export const ScreenField: React.FC = () => <LivingField active={useIsFocused()} />;

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
  touch: { position: 'absolute', left: 0, top: 0 },
  // A still field sits mid-breath: the middle of each breathing range.
  stillGlow: { opacity: 0.76 },
  stillEcho: { opacity: 0.5 },
  stillLattice: { opacity: 0.91 },
  stillDots: { position: 'absolute', left: 0, opacity: 0.91 },
});
