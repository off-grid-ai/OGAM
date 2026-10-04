import React, { useEffect, useRef, useState } from 'react';
import { View, StyleSheet, Animated, AccessibilityInfo } from 'react-native';
import { useTheme } from '../theme';
import { audioRecorderService } from '../services/audioRecorderService';

interface VoiceSpectrumProps {
  /** Only listens + animates while true (recording). Idle → a flat, quiet baseline. */
  active: boolean;
  /** Bar count. A handful reads as "hearing you" without becoming an ornament. */
  bars?: number;
  /** Peak bar height in points. */
  height?: number;
  color?: string;
}

/**
 * A minimal, HONEST level meter: a short scrolling history of the real microphone RMS, so the newest
 * level enters at the right and slides left. It is functional per the brand — it proves the mic is live
 * and hearing you, it is not a decorative waveform. Monochrome (the accent), flat bars, and it animates
 * ONLY transform (scaleY) on the native driver. Respects reduce-motion by holding a still baseline.
 */
export const VoiceSpectrum: React.FC<VoiceSpectrumProps> = ({ active, bars = 7, height = 22, color }) => {
  const { colors } = useTheme();
  const accent = color ?? colors.primary;
  const scales = useRef(Array.from({ length: bars }, () => new Animated.Value(0.08))).current;
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let live = true;
    AccessibilityInfo.isReduceMotionEnabled().then(v => live && setReduceMotion(v));
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      live = false;
      sub.remove();
    };
  }, []);

  useEffect(() => {
    if (!active || reduceMotion) {
      // Settle to a quiet baseline (reduced motion, or not recording).
      scales.forEach(s => Animated.timing(s, { toValue: 0.08, duration: 150, useNativeDriver: true }).start());
      return;
    }
    // Rolling history: shift bars left, newest RMS on the right. RMS ~0..0.3 for speech → normalize to a
    // readable 0.08..1 scale so quiet still shows a sliver and loud fills the bar.
    const history = scales.map(() => 0.08);
    const unsubscribe = audioRecorderService.onAudioLevel((rms: number) => {
      const level = Math.max(0.08, Math.min(1, rms * 3.2));
      history.shift();
      history.push(level);
      history.forEach((value, i) => {
        Animated.timing(scales[i], { toValue: value, duration: 90, useNativeDriver: true }).start();
      });
    });
    return unsubscribe;
  }, [active, reduceMotion, scales]);

  return (
    <View style={[styles.row, { height }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {scales.map((scale, i) => (
        <Animated.View
          key={i}
          style={[
            styles.bar,
            { height, backgroundColor: accent, opacity: active ? 0.9 : 0.35, transform: [{ scaleY: scale }] },
          ]}
        />
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  // scaleY pivots at center; a thin flat bar keeps it terminal, not a rounded waveform.
  bar: { width: 3, borderRadius: 1 },
});
