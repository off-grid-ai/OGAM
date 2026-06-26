import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Modal, Animated, Easing } from 'react-native';
import MaterialIcon from 'react-native-vector-icons/MaterialIcons';
import { useTheme, useThemedStyles } from '../../../theme';
import type { ThemeColors, ThemeShadows } from '../../../theme';
import { TYPOGRAPHY, SPACING } from '../../../constants';
import { LoadingState } from '../hooks/useHomeScreen';
import { LOADING_TIPS, TIP_ROTATION_MS } from './loadingTips';

const CARD_WIDTH = 320;
const PROGRESS_TRACK_WIDTH = CARD_WIDTH - SPACING.xxl * 2;

// We can't read real load progress from the native side, so the bar eases
// toward a ceiling (never 100%) over the expected load window. It fills fast
// early then creeps, so it reads as "working" without ever claiming "done"
// before the model actually loads. The overlay closes on completion.
const PROGRESS_CEILING = 0.9;
const PROGRESS_DURATION_MS = 22000;

const createStyles = (colors: ThemeColors, shadows: ThemeShadows) => ({
  loadingOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  loadingCard: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    paddingVertical: SPACING.xxl,
    paddingHorizontal: SPACING.xxl,
    alignItems: 'center' as const,
    width: CARD_WIDTH,
    maxWidth: '90%' as const,
    ...shadows.large,
  },
  loadingTitle: {
    ...TYPOGRAPHY.h2,
    color: colors.text,
    textAlign: 'center' as const,
  },
  loadingModelName: {
    ...TYPOGRAPHY.body,
    color: colors.primary,
    marginTop: SPACING.sm,
    textAlign: 'center' as const,
  },
  progressTrack: {
    width: PROGRESS_TRACK_WIDTH,
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.border,
    marginTop: SPACING.xl,
    overflow: 'hidden' as const,
  },
  progressBar: {
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.primary,
  },
  tipCard: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    backgroundColor: colors.background,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    padding: SPACING.lg,
    marginTop: SPACING.xl,
    width: PROGRESS_TRACK_WIDTH,
    minHeight: 92,
  },
  tipIcon: {
    marginRight: SPACING.md,
    marginTop: 1,
  },
  tipTextWrap: {
    flex: 1,
  },
  tipLabel: {
    ...TYPOGRAPHY.label,
    color: colors.textMuted,
    textTransform: 'uppercase' as const,
    marginBottom: SPACING.xs,
  },
  tipText: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textSecondary,
    lineHeight: 19,
  },
});

function getLoadingTitle(state: LoadingState): string {
  if (!state.modelName) return 'Unloading Model';
  if (state.modelName === 'Ejecting models...') return 'Ejecting Models';
  return state.type === 'text' ? 'Loading Text Model' : 'Loading Image Model';
}

type Props = {
  loadingState: LoadingState;
};

export const LoadingOverlay: React.FC<Props> = ({ loadingState }) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);

  const [tipIndex, setTipIndex] = useState(0);
  // The overlay owns its own visibility so that when loading finishes we can
  // run the bar to 100% before hiding, instead of vanishing mid-fill.
  const [visible, setVisible] = useState(false);
  const visibleRef = useRef(false);
  const tipOpacity = useRef(new Animated.Value(1)).current;
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (loadingState.isLoading) {
      // Ease toward the ceiling over the expected load window. Easing.out
      // decelerates, so it advances fast then crawls as it nears the cap.
      visibleRef.current = true;
      setVisible(true);
      progress.setValue(0);
      const anim = Animated.timing(progress, {
        toValue: PROGRESS_CEILING,
        duration: PROGRESS_DURATION_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      });
      anim.start();
      return () => anim.stop();
    }
    if (visibleRef.current) {
      // Loading finished: complete the bar, then hide the overlay.
      const finish = Animated.timing(progress, {
        toValue: 1,
        duration: 300,
        easing: Easing.out(Easing.quad),
        useNativeDriver: false,
      });
      finish.start(({ finished }) => {
        if (finished) {
          visibleRef.current = false;
          setVisible(false);
        }
      });
      return () => finish.stop();
    }
  }, [loadingState.isLoading, progress]);

  // Rotate through tips with a quick cross-fade.
  useEffect(() => {
    if (!loadingState.isLoading) {
      setTipIndex(0);
      return;
    }
    const interval = setInterval(() => {
      Animated.timing(tipOpacity, {
        toValue: 0,
        duration: 250,
        useNativeDriver: true,
      }).start(() => {
        setTipIndex(prev => (prev + 1) % LOADING_TIPS.length);
        Animated.timing(tipOpacity, {
          toValue: 1,
          duration: 250,
          useNativeDriver: true,
        }).start();
      });
    }, TIP_ROTATION_MS);
    return () => clearInterval(interval);
  }, [loadingState.isLoading, tipOpacity]);

  const tip = LOADING_TIPS[tipIndex];
  const barWidth = progress.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
    >
      <View style={styles.loadingOverlay}>
        <View style={styles.loadingCard}>
          <Text style={styles.loadingTitle}>
            {getLoadingTitle(loadingState)}
          </Text>
          <Text style={styles.loadingModelName} numberOfLines={2}>
            {loadingState.modelName || 'Please wait...'}
          </Text>

          <View style={styles.progressTrack}>
            <Animated.View style={[styles.progressBar, { width: barWidth }]} />
          </View>

          <View style={styles.tipCard}>
            <MaterialIcon
              name="lightbulb-outline"
              size={16}
              color={colors.primary}
              style={styles.tipIcon}
            />
            <View style={styles.tipTextWrap}>
              <Text style={styles.tipLabel}>Tip</Text>
              <Animated.Text style={[styles.tipText, { opacity: tipOpacity }]}>
                {tip.text}
              </Animated.Text>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
};
