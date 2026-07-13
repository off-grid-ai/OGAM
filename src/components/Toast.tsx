import React, { useEffect, useRef } from 'react';
import { Animated, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Feather';
import { create } from 'zustand';
import { useTheme, useThemedStyles } from '../theme';
import type { ThemeColors, ThemeShadows } from '../theme';
import { SPACING, TYPOGRAPHY } from '../constants';

/**
 * One cross-platform toast (not ToastAndroid, which is Android-only): a brief,
 * non-blocking message that slides up from the bottom and auto-dismisses. A
 * single host is mounted once at the app root; anywhere in the app (screens or
 * services) calls `showToast(message)` imperatively - no per-screen wiring.
 */
export interface ToastOptions {
  /** Optional leading Feather icon name. */
  icon?: string;
  /** Auto-dismiss delay in ms (default 2600). */
  durationMs?: number;
}

interface ToastState {
  visible: boolean;
  message: string;
  icon?: string;
  durationMs: number;
  /** Bumped on every show so the host restarts its timer even for the same text. */
  nonce: number;
  show: (message: string, opts?: ToastOptions) => void;
  hide: () => void;
}

const DEFAULT_DURATION_MS = 2600;

const useToastStore = create<ToastState>((set) => ({
  visible: false,
  message: '',
  icon: undefined,
  durationMs: DEFAULT_DURATION_MS,
  nonce: 0,
  show: (message, opts) =>
    set((s) => ({
      visible: true,
      message,
      icon: opts?.icon,
      durationMs: opts?.durationMs ?? DEFAULT_DURATION_MS,
      nonce: s.nonce + 1,
    })),
  hide: () => set({ visible: false }),
}));

/** Show a toast from anywhere (screens or services). */
export const showToast = (message: string, opts?: ToastOptions): void =>
  useToastStore.getState().show(message, opts);

/** Hide the current toast early. */
export const hideToast = (): void => useToastStore.getState().hide();

/**
 * The toast host. Mount exactly once near the app root (inside SafeAreaProvider).
 * Renders nothing until a toast is shown.
 */
export const Toast: React.FC = () => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const insets = useSafeAreaInsets();

  const visible = useToastStore((s) => s.visible);
  const message = useToastStore((s) => s.message);
  const icon = useToastStore((s) => s.icon);
  const durationMs = useToastStore((s) => s.durationMs);
  const nonce = useToastStore((s) => s.nonce);
  const hide = useToastStore((s) => s.hide);

  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(20)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Keep the last message on screen through the fade-out so it doesn't blank mid-animation.
  const [shown, setShown] = React.useState(false);

  useEffect(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (visible) {
      setShown(true);
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }),
        Animated.timing(translateY, { toValue: 0, duration: 180, useNativeDriver: true }),
      ]).start();
      timer.current = setTimeout(hide, durationMs);
    } else {
      Animated.parallel([
        Animated.timing(opacity, { toValue: 0, duration: 160, useNativeDriver: true }),
        Animated.timing(translateY, { toValue: 20, duration: 160, useNativeDriver: true }),
      ]).start(({ finished }) => { if (finished) setShown(false); });
    }
    return () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };
    // nonce forces re-run (and timer reset) even when message text is unchanged.
  }, [visible, nonce, durationMs, hide, opacity, translateY]);

  if (!shown) return null;

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[styles.wrap, { bottom: insets.bottom + SPACING.xl }]}
    >
      <TouchableOpacity
        activeOpacity={0.85}
        onPress={hide}
        style={styles.toast}
        testID="app-toast"
      >
        {icon ? <Icon name={icon} size={16} color={colors.primary} style={styles.icon} /> : null}
        <Text style={styles.text} numberOfLines={2}>{message}</Text>
      </TouchableOpacity>
    </Animated.View>
  );
};

Toast.displayName = 'Toast';

const createStyles = (colors: ThemeColors, shadows: ThemeShadows) => ({
  wrap: {
    position: 'absolute' as const,
    left: SPACING.lg,
    right: SPACING.lg,
    alignItems: 'center' as const,
  },
  toast: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    maxWidth: '100%' as const,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    borderRadius: 12,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    ...shadows.small,
  },
  icon: { marginRight: SPACING.sm },
  text: { ...TYPOGRAPHY.bodySmall, color: colors.text, flexShrink: 1 },
});
