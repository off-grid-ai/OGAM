import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  ActivityIndicator,
} from 'react-native';
import { stripMarkdownForSpeech } from '../../utils/messageContent';
import { MarkdownText } from '../MarkdownText';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme, useThemedStyles } from '../../theme';
import { useTTSStore } from '../../stores/ttsStore';
import { TYPOGRAPHY, SPACING } from '../../constants';
import type { ThemeColors, ThemeShadows } from '../../theme';

const WAVEFORM_BARS = 28;
const SPEED_STEPS: number[] = [0.5, 0.8, 0.9, 1.0, 1.1, 1.2, 1.5, 2.0];

interface AudioMessageBubbleProps {
  messageId: string;
  audioPath: string;
  waveformData: number[];
  durationSeconds: number;
  /** Optional plain-text transcript to show when user expands */
  transcript?: string;
  /** True for user-sent voice recordings (right-aligned) */
  isUser?: boolean;
  /** True while the LLM is still generating — shows a thinking indicator */
  isLoading?: boolean;
  /** Thinking/reasoning content from the model — shown as collapsible block above waveform */
  reasoningContent?: string;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function subsample(data: number[], count: number): number[] {
  if (data.length === 0) {
    // Generate a visible placeholder waveform pattern
    return Array.from({ length: count }, (_, i) => 0.25 + 0.25 * Math.sin((i / count) * Math.PI * 4));
  }
  const step = data.length / count;
  const result: number[] = [];
  for (let i = 0; i < count; i++) {
    result.push(data[Math.floor(i * step)] ?? 0.1);
  }
  return result;
}

function normalize(data: number[]): number[] {
  const max = Math.max(...data, 0.001);
  return data.map((v) => v / max);
}

/**
 * Waveform bar display — three modes:
 *
 *  1. `amplitude` provided (0–1): VU-meter driven by live Kokoro chunk RMS.
 *     Instant attack, 350ms decay. Used for AI messages via Kokoro.
 *
 *  2. `isPlaying` true but no `amplitude`: wave animation (staggered bounce).
 *     Used for user voice recordings played via file-based playback.
 *
 *  3. Neither: static bars at resting shape.
 */
const WaveformBars: React.FC<{
  data: number[];
  colors: ThemeColors;
  amplitude?: number;
  isPlaying?: boolean;
}> = ({ data, colors, amplitude, isPlaying }) => {
  const bars = useMemo(() => normalize(subsample(data, WAVEFORM_BARS)), [data]);

  // ── VU-meter mode (amplitude-driven) ─────────────────────────────────────
  const ampAnim = useRef(new Animated.Value(0)).current;
  const ampAnimRef = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    if (amplitude === undefined) return;
    ampAnimRef.current?.stop();
    const current = (ampAnim as any)._value ?? 0;
    if (amplitude >= current) {
      // Instant attack — bars jump up immediately
      ampAnim.setValue(amplitude);
    } else {
      // Slow decay — bars fall smoothly
      ampAnimRef.current = Animated.timing(ampAnim, {
        toValue: amplitude,
        duration: 250,
        useNativeDriver: false,
      });
      ampAnimRef.current.start();
    }
  }, [amplitude, ampAnim]);

  // ── Wave mode (bounce animation for file playback) ───────────────────────
  const waveAnims = useRef(bars.map(() => new Animated.Value(0))).current;
  const waveRef = useRef<Animated.CompositeAnimation[]>([]);

  useEffect(() => {
    const shouldWave = isPlaying && amplitude === undefined;
    if (!shouldWave) {
      waveRef.current.forEach(a => a.stop());
      waveAnims.forEach(v => v.setValue(0));
      return;
    }
    waveRef.current = waveAnims.map((v, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 25),
          Animated.timing(v, { toValue: 1, duration: 250, useNativeDriver: false }),
          Animated.timing(v, { toValue: 0, duration: 250, useNativeDriver: false }),
        ]),
      ),
    );
    waveRef.current.forEach(a => a.start());
    return () => waveRef.current.forEach(a => a.stop());
  }, [isPlaying, amplitude, waveAnims]);

  // Reset VU-meter when not playing — bars return to resting shape
  useEffect(() => {
    if (!isPlaying && amplitude === undefined) {
      ampAnim.setValue(0);
    }
  }, [isPlaying, amplitude, ampAnim]);

  return (
    <View style={barStyles.container}>
      {bars.map((shape, i) => {
        const maxH = Math.max(8, Math.round(shape * 36));
        const minH = Math.max(5, Math.round(shape * 10));

        let heightStyle: number | Animated.AnimatedInterpolation<number> = maxH;
        if (amplitude !== undefined) {
          // VU-meter: driven by live RMS
          heightStyle = ampAnim.interpolate({ inputRange: [0, 1], outputRange: [minH, maxH] });
        } else if (isPlaying) {
          // Wave: staggered bounce animation
          heightStyle = waveAnims[i].interpolate({ inputRange: [0, 1], outputRange: [minH, maxH] });
        }

        return (
          <Animated.View
            key={i}
            style={[
              barStyles.bar,
              {
                height: heightStyle,
                backgroundColor: colors.primary,
                opacity: 0.5 + shape * 0.5,
              },
            ]}
          />
        );
      })}
    </View>
  );
};

const barStyles = StyleSheet.create({
  container: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    height: 40,
    overflow: 'hidden',
  },
  bar: {
    width: 3,
    borderRadius: 2,
  },
});

/** Three pulsing dots shown while the LLM is generating */
const ThinkingDots: React.FC<{ colors: ThemeColors }> = ({ colors }) => {
  const dots = useRef([new Animated.Value(0.3), new Animated.Value(0.3), new Animated.Value(0.3)]).current;

  useEffect(() => {
    const anims = dots.map((v, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 150),
          Animated.timing(v, { toValue: 1, duration: 300, useNativeDriver: false }),
          Animated.timing(v, { toValue: 0.3, duration: 300, useNativeDriver: false }),
        ]),
      ),
    );
    anims.forEach((a) => a.start());
    return () => anims.forEach((a) => a.stop());
  }, [dots]);

  return (
    <View style={dotStyles.container}>
      {dots.map((v, i) => (
        <Animated.View key={i} style={[dotStyles.dot, { backgroundColor: colors.primary, opacity: v }]} />
      ))}
    </View>
  );
};

const dotStyles = StyleSheet.create({
  container: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 4,
    height: 32,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
});

export const AudioMessageBubble: React.FC<AudioMessageBubbleProps> = ({
  messageId,
  audioPath,
  waveformData,
  durationSeconds,
  transcript,
  isUser = false,
  isLoading = false,
  reasoningContent,
}) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);

  // ── Targeted selectors — only re-render when these specific values change,
  //    NOT on every amplitude update (which fires ~30×/s during playback) ──
  const isSpeaking = useTTSStore((s) => s.isSpeaking);
  const isPaused = useTTSStore((s) => s.isPaused);
  const isAudioPlaying = useTTSStore((s) => s.isAudioPlaying);
  const currentMessageId = useTTSStore((s) => s.currentMessageId);
  const speed = useTTSStore((s) => s.settings.speed);
  const playMessage = useTTSStore((s) => s.playMessage);
  const speak = useTTSStore((s) => s.speak);
  const stop = useTTSStore((s) => s.stop);
  const pause = useTTSStore((s) => s.pause);
  const resume = useTTSStore((s) => s.resume);
  const updateSettings = useTTSStore((s) => s.updateSettings);

  const [showTranscript, setShowTranscript] = useState(false);

  const isThisPlaying = isSpeaking && currentMessageId === messageId && !isPaused;
  const isThisPaused = isSpeaking && currentMessageId === messageId && isPaused;
  const isThisAudible = isAudioPlaying && currentMessageId === messageId && !isPaused;
  const isThisLoading = isThisPlaying && !isThisAudible;

  // ── Wall-clock elapsed timer ────────────────────────────────────────────
  const [localElapsed, setLocalElapsed] = useState(0);
  const startTimeRef = useRef<number>(0);
  const pausedAtRef = useRef<number>(0);
  useEffect(() => {
    if (!isThisAudible && !isThisPaused) { setLocalElapsed(0); pausedAtRef.current = 0; return; }
    if (isThisPaused) {
      pausedAtRef.current = localElapsed;
      return;
    }
    startTimeRef.current = Date.now() - pausedAtRef.current * 1000;
    const id = setInterval(() => {
      setLocalElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 500);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isThisAudible, isThisPaused]);

  const handlePlayPause = useCallback(() => {
    if (isThisPaused) { resume(); return; }
    if (isThisPlaying) { pause(); return; }
    if (audioPath) {
      playMessage(messageId, audioPath);
    } else {
      speak(stripMarkdownForSpeech(transcript ?? ''), messageId);
    }
  }, [isThisPlaying, isThisPaused, pause, resume, playMessage, speak, messageId, audioPath, transcript]);

  const handleSpeedCycle = useCallback(() => {
    let idx = SPEED_STEPS.indexOf(speed);
    if (idx < 0) {
      // Current speed not in steps (persona default) — find nearest step above
      idx = SPEED_STEPS.findIndex((s) => s > speed) - 1;
      if (idx < 0) idx = 0;
    }
    const next = (idx + 1) % SPEED_STEPS.length;
    updateSettings({ speed: SPEED_STEPS[next] });
  }, [speed, updateSettings]);

  /** Seek to a position by re-speaking from a character offset in the transcript */
  const handleSeek = useCallback((fraction: number) => {
    if (!transcript || audioPath) return; // only for AI TTS bubbles
    const text = stripMarkdownForSpeech(transcript);
    const charOffset = Math.floor(fraction * text.length);
    // Find the nearest sentence boundary to avoid cutting mid-word
    const seekPoint = text.lastIndexOf('. ', charOffset) + 2 || charOffset;
    const remaining = text.slice(seekPoint).trim();
    if (!remaining) return;
    // Set elapsed to the seek position so progress bar updates
    const seekSeconds = Math.floor(fraction * totalDurationRef.current);
    startTimeRef.current = Date.now() - seekSeconds * 1000;
    pausedAtRef.current = 0;
    setLocalElapsed(seekSeconds);
    // Stop current playback and re-speak from the seek point
    stop();
    setTimeout(() => speak(remaining, messageId), 200);
  }, [transcript, audioPath, stop, speak, messageId]);

  const speedChip = (
    <TouchableOpacity
      onPress={handleSpeedCycle}
      style={styles.speedChip}
      hitSlop={{ top: 8, left: 8, right: 8 }}
    >
      <Text style={styles.speedText}>{speed}x</Text>
    </TouchableOpacity>
  );

  const playButton = isLoading ? (
    <View style={[styles.playButton, { opacity: 0.35 }]}>
      <Icon name="play" size={16} color={colors.primary} />
    </View>
  ) : isThisLoading ? (
    <View style={styles.playButton}>
      <ActivityIndicator size="small" color={colors.primary} />
    </View>
  ) : (
    <TouchableOpacity
      onPress={handlePlayPause}
      style={styles.playButton}
      hitSlop={{ top: 8, left: 8, right: 8 }}
    >
      <Icon
        name={isThisPlaying ? 'pause' : 'play'}
        size={16}
        color={colors.primary}
      />
    </TouchableOpacity>
  );

  // Estimated total duration — adjusted by current playback speed
  const totalDurationRef = useRef(0);
  const totalDuration = (() => {
    if (!audioPath && transcript) {
      const wordCount = transcript.trim().split(/\s+/).filter(Boolean).length;
      return Math.max(1, wordCount / (2.5 * speed));
    }
    return durationSeconds;
  })();
  totalDurationRef.current = totalDuration;

  const isThisActive = (isThisPlaying || isThisPaused) && currentMessageId === messageId;
  const progress = isThisActive ? Math.min(1, localElapsed / Math.max(1, totalDuration)) : 0;

  const durationText = (
    <Text style={styles.duration}>
      {isLoading ? '—' : formatDuration(totalDuration)}
    </Text>
  );

  // ── Seek handler — tap on the waveform area to jump to a position ──
  const seekAreaWidth = useRef(0);
  const handleWaveformSeek = useCallback((e: any) => {
    if (!isThisActive || isLoading || !seekAreaWidth.current) return;
    const locationX = e.nativeEvent.locationX;
    const fraction = Math.max(0, Math.min(1, locationX / seekAreaWidth.current));
    handleSeek(fraction);
  }, [isThisActive, isLoading, handleSeek]);

  return (
    <View style={[styles.bubble, isUser && styles.bubbleUser]} testID={`audio-bubble-${messageId}`}>
      {/* Playback row */}
      <View style={styles.playRow}>
        {isUser ? (
          <>
            {speedChip}
            {durationText}
            <WaveformBars data={waveformData} colors={colors} isPlaying={isThisPlaying} />
            {playButton}
          </>
        ) : (
          <>
            {playButton}
            {isLoading
              ? <ThinkingDots colors={colors} />
              : (
                <TouchableOpacity
                  activeOpacity={0.9}
                  onPress={handleWaveformSeek}
                  onLayout={(e) => { seekAreaWidth.current = e.nativeEvent.layout.width; }}
                  disabled={!isThisActive}
                  style={styles.waveformSeekArea}
                >
                  <WaveformBars
                    data={waveformData}
                    colors={colors}
                    isPlaying={isThisAudible}
                  />
                  {isThisActive && (
                    <View style={styles.progressTrack}>
                      <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` as any, backgroundColor: colors.primary }]} />
                      <View style={[styles.progressThumb, { left: `${Math.round(progress * 100)}%` as any, backgroundColor: colors.primary }]} />
                    </View>
                  )}
                </TouchableOpacity>
              )}
            {durationText}
            {speedChip}
          </>
        )}
      </View>

      {/* Transcript toggle — only for user voice recordings */}
      {transcript ? (
        <TouchableOpacity
          onPress={() => setShowTranscript((v) => !v)}
          style={styles.transcriptToggle}
        >
          <Text style={styles.transcriptToggleText}>
            {showTranscript ? 'Hide transcript' : 'Show transcript'}
          </Text>
          <Icon
            name={showTranscript ? 'chevron-up' : 'chevron-down'}
            size={11}
            color={colors.textMuted}
          />
        </TouchableOpacity>
      ) : null}

      {showTranscript && transcript ? (
        <View style={styles.transcriptContent}>
          <MarkdownText>{transcript}</MarkdownText>
        </View>
      ) : null}
    </View>
  );
};

const createStyles = (colors: ThemeColors, _shadows: ThemeShadows) => ({
  bubble: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: SPACING.md,
    maxWidth: '88%' as const,
    minWidth: 220,
    alignSelf: 'flex-start' as const,
    gap: SPACING.sm,
    overflow: 'hidden' as const,
  },
  bubbleUser: {
    alignSelf: 'flex-end' as const,
    backgroundColor: `${colors.primary}18`,
    borderColor: `${colors.primary}40`,
  },
  playRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: SPACING.sm,
  },
  playButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: `${colors.primary}20`,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  duration: {
    ...TYPOGRAPHY.meta,
    color: colors.textMuted,
    minWidth: 32,
    textAlign: 'right' as const,
  },
  speedChip: {
    backgroundColor: colors.surfaceLight,
    borderRadius: 6,
    paddingHorizontal: SPACING.xs,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: colors.border,
  },
  speedText: {
    ...TYPOGRAPHY.metaSmall,
    color: colors.textSecondary,
  },
  waveformSeekArea: {
    flex: 1,
  },
  progressTrack: {
    height: 3,
    backgroundColor: `${colors.primary}15`,
    borderRadius: 2,
    marginTop: 4,
    position: 'relative' as const,
  },
  progressFill: {
    height: '100%' as const,
    borderRadius: 2,
    opacity: 0.7,
  },
  progressThumb: {
    position: 'absolute' as const,
    width: 10,
    height: 10,
    borderRadius: 5,
    marginLeft: -5,
    top: -3.5,
  },
  transcriptToggle: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: SPACING.xs,
  },
  transcriptToggleText: {
    ...TYPOGRAPHY.meta,
    color: colors.textMuted,
  },
  transcript: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  transcriptContent: {
    paddingTop: SPACING.xs,
  },
});
