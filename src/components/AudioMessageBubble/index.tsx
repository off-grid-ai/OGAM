import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {
  View,
  StyleSheet,
  Animated,
} from 'react-native';
import { stripMarkdownForSpeech } from '../../utils/messageContent';
import { useTheme, useThemedStyles } from '../../theme';
import { useTTSStore } from '../../stores/ttsStore';
import { TYPOGRAPHY, SPACING } from '../../constants';
import type { ThemeColors, ThemeShadows } from '../../theme';
import {
  usePlaybackState,
  useElapsedTimer,
  useSeekHandler,
  PlayButton,
  SpeedChip,
  DurationText,
  SeekBar,
  TranscriptSection,
} from './PlaybackControls';

const WAVEFORM_BARS = 28;

interface AudioMessageBubbleProps {
  messageId: string;
  audioPath: string;
  waveformData: number[];
  durationSeconds: number;
  transcript?: string;
  isUser?: boolean;
  isLoading?: boolean;
  /** Thinking/reasoning content from the model — shown as collapsible block above waveform */
  _reasoningContent?: string;
}

function subsample(data: number[], count: number): number[] {
  if (data.length === 0) {
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

/** Static waveform bars — shape derived from data, no animation needed.
 *  Progress indication is handled by the native Slider below. */
const WaveformBars: React.FC<{
  data: number[];
  colors: ThemeColors;
}> = ({ data, colors }) => {
  const bars = useMemo(() => normalize(subsample(data, WAVEFORM_BARS)), [data]);

  return (
    <View style={barStyles.container}>
      {bars.map((shape, i) => (
        <View
          key={i}
          style={[
            barStyles.bar,
            {
              height: Math.max(8, Math.round(shape * 36)),
              backgroundColor: colors.primary,
              opacity: 0.4 + shape * 0.5,
            },
          ]}
        />
      ))}
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
  _reasoningContent,
}) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const speed = useTTSStore((s) => s.settings.speed);
  const playMessage = useTTSStore((s) => s.playMessage);
  const speak = useTTSStore((s) => s.speak);

  const { isThisPlaying, isThisPaused, isThisAudible, isThisLoading } = usePlaybackState(messageId);
  const currentMessageId = useTTSStore((s) => s.currentMessageId);
  const [isSeeking, setIsSeeking] = useState(false);
  const seekOffsetRef = useRef<number>(0);
  const { localElapsed, setLocalElapsed } = useElapsedTimer(isThisAudible, isThisPaused, seekOffsetRef);

  const handlePlayPause = useCallback(() => {
    const { pause, resume } = useTTSStore.getState();
    if (isThisPaused) { resume(); return; }
    if (isThisPlaying) { pause(); return; }
    if (audioPath) {
      playMessage(messageId, audioPath);
    } else {
      const text = stripMarkdownForSpeech(transcript ?? '');
      speak(text, messageId);
    }
  }, [isThisPlaying, isThisPaused, playMessage, speak, messageId, audioPath, transcript]);

  const totalDurationRef = useRef(0);
  const totalDuration = useMemo(() => {
    if (!audioPath && transcript) {
      const wordCount = transcript.trim().split(/\s+/).filter(Boolean).length;
      return Math.max(1, wordCount / (2.5 * speed));
    }
    return durationSeconds;
  }, [audioPath, transcript, speed, durationSeconds]);
  totalDurationRef.current = totalDuration;

  const handleSeek = useSeekHandler({
    transcript, audioPath, messageId,
    totalDurationRef, seekOffsetRef, setLocalElapsed, setIsSeeking,
  });

  const isThisActive = ((isThisPlaying || isThisPaused) && currentMessageId === messageId) || isSeeking;
  const progress = isThisActive ? Math.min(1, localElapsed / Math.max(1, totalDuration)) : 0;

  return (
    <View style={[styles.bubble, isUser && styles.bubbleUser]} testID={`audio-bubble-${messageId}`}>
      <View style={styles.playRow}>
        {isUser ? (
          <>
            <SpeedChip styles={styles} />
            <DurationText isLoading={isLoading} totalDuration={totalDuration} styles={styles} />
            <WaveformBars data={waveformData} colors={colors} />
            <PlayButton isLoading={isLoading} isThisLoading={isThisLoading} isThisPlaying={isThisPlaying} onPlayPause={handlePlayPause} colors={colors} styles={styles} />
          </>
        ) : (
          <>
            <PlayButton isLoading={isLoading} isThisLoading={isThisLoading} isThisPlaying={isThisPlaying} onPlayPause={handlePlayPause} colors={colors} styles={styles} />
            {isLoading
              ? <ThinkingDots colors={colors} />
              : <WaveformBars data={waveformData} colors={colors} />}
            <DurationText isLoading={isLoading} totalDuration={totalDuration} styles={styles} />
            <SpeedChip styles={styles} />
          </>
        )}
      </View>

      {!isLoading && !isUser && (
        <SeekBar displayProgress={progress} colors={colors} styles={styles} onSeek={handleSeek} />
      )}

      <TranscriptSection transcript={transcript} colors={colors} styles={styles} progress={progress} />
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
  playButtonDisabled: {
    opacity: 0.35,
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
  seekSlider: {
    height: 28,
    marginHorizontal: -SPACING.xs,
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
  transcriptContent: {
    paddingTop: SPACING.xs,
  },
  transcriptText: {
    ...TYPOGRAPHY.bodySmall,
    lineHeight: 20,
  },
});
