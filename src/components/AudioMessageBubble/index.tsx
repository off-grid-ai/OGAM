import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
} from 'react-native';
import { stripMarkdownForSpeech } from '../../utils/messageContent';
import { useTheme, useThemedStyles } from '../../theme';
import { useTTSStore } from '../../stores/ttsStore';
import { triggerHaptic } from '../../utils/haptics';
import { TYPOGRAPHY, SPACING } from '../../constants';
import type { ThemeColors, ThemeShadows } from '../../theme';
import { ActionMenuSheet } from '../ChatMessage/components/ActionMenuSheet';
import { createStyles as createChatStyles } from '../ChatMessage/styles';
import {
  usePlaybackState,
  useElapsedTimer,
  useSeekHandler,
  PlayButton,
  SpeedChip,
  DurationText,
  SeekBar,
  TranscriptToggle,
  TranscriptContent,
} from './PlaybackControls';

const WAVEFORM_BARS = 48;

interface AudioMessageBubbleProps {
  messageId: string;
  audioPath: string;
  waveformData: number[];
  durationSeconds: number;
  transcript?: string;
  isUser?: boolean;
  isLoading?: boolean;
  _reasoningContent?: string;
  onCopy?: (content: string) => void;
  onRetry?: () => void;
  onEdit?: (newContent: string) => void;
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

/** WhatsApp-style waveform — bars tint as the playhead passes over them.
 *  Played bars are full color, unplayed bars are muted. */
const WaveformBars: React.FC<{
  data: number[];
  colors: ThemeColors;
  /** 0–1 playback progress — bars behind the playhead are tinted */
  progress?: number;
}> = ({ data, colors, progress = 0 }) => {
  const bars = useMemo(() => normalize(subsample(data, WAVEFORM_BARS)), [data]);

  return (
    <View style={barStyles.container}>
      {bars.map((shape, i) => {
        const played = progress > 0 && (i / bars.length) < progress;
        return (
          <View
            key={i}
            style={[
              barStyles.bar,
              {
                height: Math.max(6, Math.round(shape * 32)),
                backgroundColor: colors.primary,
                opacity: played ? (0.7 + shape * 0.3) : (0.2 + shape * 0.25),
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
    gap: 1.5,
    height: 40,
    overflow: 'hidden',
  },
  bar: {
    flex: 1,
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
  onCopy,
  onRetry,
  onEdit,
}) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const chatStyles = useThemedStyles(createChatStyles);
  const [showActionMenu, setShowActionMenu] = useState(false);
  const speed = useTTSStore((s) => s.settings.speed);
  const playMessage = useTTSStore((s) => s.playMessage);
  const speak = useTTSStore((s) => s.speak);

  const { isThisPlaying, isThisPaused, isThisAudible, isThisLoading } = usePlaybackState(messageId);
  const currentMessageId = useTTSStore((s) => s.currentMessageId);

  useEffect(() => {
    console.log('[AudioBubble] state: messageId=', messageId, 'currentMessageId=', currentMessageId, 'isThisAudible=', isThisAudible, 'isThisPlaying=', isThisPlaying);
  }, [messageId, currentMessageId, isThisAudible, isThisPlaying]);
  const [showTranscript, setShowTranscript] = useState(false);
  const [isSeeking, setIsSeeking] = useState(false);
  const seekOffsetRef = useRef<number>(0);
  const { localElapsed, setLocalElapsed } = useElapsedTimer({ isThisAudible, isThisPaused }, seekOffsetRef);

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

  // Waveform + seekbar overlay — seekbar sits on top of the waveform, centered vertically
  const waveformWithSeek = (
    <View style={styles.waveformSeekContainer}>
      {isLoading && !isUser
        ? <ThinkingDots colors={colors} />
        : <WaveformBars data={waveformData} colors={colors} progress={progress} />}
      {!isLoading && (
        <View style={styles.seekOverlay}>
          <SeekBar displayProgress={progress} colors={colors} styles={styles} onSeek={handleSeek} />
        </View>
      )}
    </View>
  );

  const handleLongPress = useCallback(() => {
    if (isLoading) return;
    triggerHaptic('impactMedium');
    setShowActionMenu(true);
  }, [isLoading]);

  const showActions = !!(onCopy || onRetry || onEdit);

  return (
    <View style={[styles.bubble, isUser && styles.bubbleUser]} testID={`audio-bubble-${messageId}`}>
      <TouchableOpacity
        activeOpacity={0.9}
        onLongPress={handleLongPress}
        delayLongPress={300}
        disabled={!showActions}
      >
        <View style={styles.playRow}>
          <PlayButton isLoading={isLoading} isThisLoading={isThisLoading} isThisPlaying={isThisPlaying} onPlayPause={handlePlayPause} colors={colors} styles={styles} />
          {waveformWithSeek}
        </View>

        <View style={styles.metaRow}>
          <TranscriptToggle transcript={transcript} colors={colors} styles={styles} onToggle={setShowTranscript} isOpen={showTranscript} />
          <View style={styles.metaRight}>
            <DurationText isLoading={isLoading} totalDuration={totalDuration} styles={styles} />
            <SpeedChip styles={styles} />
            {showActions && !isLoading && (
              <TouchableOpacity style={styles.actionHint} onPress={() => { triggerHaptic('impactLight'); setShowActionMenu(true); }}>
                <Text style={styles.actionHintText}>•••</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </TouchableOpacity>

      {showTranscript && transcript ? (
        <TranscriptContent transcript={transcript} styles={styles} />
      ) : null}

      <ActionMenuSheet
        visible={showActionMenu}
        onClose={() => setShowActionMenu(false)}
        isUser={isUser}
        canEdit={isUser && !!onEdit}
        canRetry={!!onRetry}
        canGenerateImage={false}
        canSpeak={false}
        styles={chatStyles}
        onCopy={() => { onCopy?.(transcript ?? ''); setShowActionMenu(false); }}
        onEdit={() => setShowActionMenu(false)}
        onRetry={() => { onRetry?.(); setShowActionMenu(false); }}
        onGenerateImage={() => setShowActionMenu(false)}
        onSpeak={() => setShowActionMenu(false)}
      />
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
    width: '88%' as const,
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
    gap: SPACING.xs,
  },
  metaRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
  },
  metaRight: {
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
    borderRadius: 10,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    borderWidth: 1,
    borderColor: colors.border,
  },
  speedText: {
    ...TYPOGRAPHY.metaSmall,
    color: colors.textSecondary,
  },
  waveformSeekContainer: {
    flex: 1,
    position: 'relative' as const,
    marginLeft: SPACING.sm,
  },
  seekOverlay: {
    position: 'absolute' as const,
    top: 0,
    left: -16,
    right: -16,
    bottom: 0,
    justifyContent: 'center' as const,
  },
  seekSlider: {
    height: 40,
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
  transcriptScroll: {
    maxHeight: 120,
  },
  transcriptText: {
    ...TYPOGRAPHY.bodySmall,
    lineHeight: 20,
  },
  actionHint: {
    padding: 4,
  },
  actionHintText: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textMuted,
    letterSpacing: 1,
  },
});
