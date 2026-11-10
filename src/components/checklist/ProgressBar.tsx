import React from 'react';
import { Animated, StyleSheet, View, Text } from 'react-native';
import type { ChecklistTheme } from './types';
import { useProgressAnimation } from './animations';

interface ProgressBarProps {
  completed: number;
  total: number;
  theme: ChecklistTheme;
}

export function ProgressBar({ completed, total, theme }: ProgressBarProps) {
  const progress = total > 0 ? completed / total : 0;
  const animatedProgress = useProgressAnimation(progress);

  const widthInterpolation = animatedProgress.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
    extrapolate: 'clamp',
  });

  return (
    <View style={styles.container}>
      <View style={styles.barRow}>
        <View
          style={[
            styles.track,
            {
              backgroundColor: theme.progressTrackColor,
              height: theme.progressHeight,
              borderRadius: theme.progressBorderRadius,
            },
          ]}
        >
          <Animated.View
            style={[
              styles.fill,
              {
                backgroundColor: theme.progressFillColor,
                borderRadius: theme.progressBorderRadius,
                width: widthInterpolation,
              },
            ]}
          />
        </View>
        <Text
          style={[
            styles.text,
            {
              color: theme.progressTextColor,
              fontSize: theme.progressTextFontSize,
            },
          ]}
        >
          {completed}/{total}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 12,
  },
  barRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  track: {
    flex: 1,
    overflow: 'hidden',
  },
  fill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
  },
  text: {
    fontVariant: ['tabular-nums'],
    fontWeight: '500',
  },
});
