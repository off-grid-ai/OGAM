import React, { createContext, useContext, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  withDelay,
  useAnimatedReaction,
  useAnimatedRef,
  useReducedMotion,
  useScrollOffset,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { ALIVE } from '../constants';

/**
 * The alive layer's conductor, as desktop's orchestra (ui-library sourced/alive/orchestra.ts): every
 * touch, press, drag and scroll in the app is shared here, so the living field answers it. A finger
 * lights the dots under it and they fade as it lifts; a press sends a ring through the lattice;
 * scrolling moves the lattice.
 *
 * None of it runs on the JavaScript thread, which inference already keeps busy: touches arrive as
 * UI-thread worklets from a gesture that only listens (it never activates, so it never takes a touch
 * from a screen), scroll is read on the UI thread, and the field draws from these shared values.
 */
export interface AliveSignals {
  /** Where the finger is, in window coordinates. */
  touchX: SharedValue<number>;
  touchY: SharedValue<number>;
  /** 1 while a finger is down, easing back to 0 after it lifts (desktop's pointer trail). */
  touch: SharedValue<number>;
  /** The latest press's ring: its centre, and how far it has travelled (0 to ALIVE.ringReach). */
  ringX: SharedValue<number>;
  ringY: SharedValue<number>;
  ringRadius: SharedValue<number>;
  /** How far the focused screen has scrolled; the lattice drifts with it. */
  scrollY: SharedValue<number>;
}

const AliveContext = createContext<AliveSignals | null>(null);

/** A finger comes down: the light rises under it and a ring sets out (desktop: 1.1 px/ms to 520 px). */
export function aliveTouchDown(signals: AliveSignals, x: number, y: number, still: boolean) {
  'worklet';
  signals.touchX.value = x;
  signals.touchY.value = y;
  if (still) return;
  signals.touch.value = withTiming(1, { duration: ALIVE.lightInMs });
  signals.ringX.value = x;
  signals.ringY.value = y;
  signals.ringRadius.value = 0;
  signals.ringRadius.value = withTiming(ALIVE.ringReach, {
    duration: ALIVE.ringReach / ALIVE.waveSpeed,
    easing: Easing.linear,
  });
}

/** The finger moves: the light follows it. */
export function aliveTouchMove(signals: AliveSignals, x: number, y: number) {
  'worklet';
  signals.touchX.value = x;
  signals.touchY.value = y;
}

/** The finger lifts: the light fades over desktop's trail time. */
export function aliveTouchUp(signals: AliveSignals) {
  'worklet';
  signals.touch.value = withTiming(0, { duration: ALIVE.trailMs });
}

/**
 * A scroll view or button took the touch from the listener. The finger may still be down, so a
 * cancel is not a lift: the light holds, then fades as if lifted (the listener hears no more).
 */
export function aliveTouchCancelled(signals: AliveSignals) {
  'worklet';
  signals.touch.value = withDelay(ALIVE.holdAfterCancelMs, withTiming(0, { duration: ALIVE.trailMs }));
}

export const AliveProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const reducedMotion = useReducedMotion();
  const touchX = useSharedValue(-1000);
  const touchY = useSharedValue(-1000);
  const touch = useSharedValue(0);
  const ringX = useSharedValue(-1000);
  const ringY = useSharedValue(-1000);
  const ringRadius = useSharedValue<number>(ALIVE.ringReach);
  const scrollY = useSharedValue(0);

  const signals = useMemo<AliveSignals>(
    () => ({ touchX, touchY, touch, ringX, ringY, ringRadius, scrollY }),
    [touchX, touchY, touch, ringX, ringY, ringRadius, scrollY],
  );

  // A manual gesture that is never activated: it hears every touch on the UI thread and lets the
  // screen's own buttons, lists and scroll views keep them.
  const listen = useMemo(
    () =>
      Gesture.Manual()
        .onTouchesDown(event => {
          const finger = event.allTouches[0];
          if (finger) aliveTouchDown(signals, finger.absoluteX, finger.absoluteY, reducedMotion);
        })
        .onTouchesMove(event => {
          const finger = event.allTouches[0];
          if (finger) aliveTouchMove(signals, finger.absoluteX, finger.absoluteY);
        })
        .onTouchesUp(() => aliveTouchUp(signals))
        .onTouchesCancelled(() => aliveTouchCancelled(signals)),
    [signals, reducedMotion],
  );

  return (
    <AliveContext.Provider value={signals}>
      <GestureDetector gesture={listen}>
        <View style={styles.fill} collapsable={false}>
          {children}
        </View>
      </GestureDetector>
    </AliveContext.Provider>
  );
};

/** The shared signals, or null outside the provider (the field then only breathes). */
export function useAlive(): AliveSignals | null {
  return useContext(AliveContext);
}

/**
 * Attach to a screen's Animated.ScrollView as `ref`: its scroll position reaches the field on the UI
 * thread. The screen keeps its own `onScroll` (analytics); this reads the offset, it adds no handler.
 */
export function useAliveScrollRef() {
  const alive = useAlive();
  const ref = useAnimatedRef<Animated.ScrollView>();
  const offset = useScrollOffset(ref);
  useAnimatedReaction(
    () => offset.value,
    y => {
      if (alive) alive.scrollY.value = y;
    },
  );
  return ref;
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
