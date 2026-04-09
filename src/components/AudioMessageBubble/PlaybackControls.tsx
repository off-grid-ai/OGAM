import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import Slider from '@react-native-community/slider';
import { stripMarkdownForSpeech } from '../../utils/messageContent';
import { MarkdownText } from '../MarkdownText';
import Icon from 'react-native-vector-icons/Feather';
import { useTTSStore } from '../../stores/ttsStore';
import type { ThemeColors } from '../../theme';

const SPEED_STEPS: number[] = [0.5, 0.8, 0.9, 1.0, 1.1, 1.2, 1.5, 2.0];

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

interface PlaybackState {
  isThisPlaying: boolean;
  isThisPaused: boolean;
  isThisAudible: boolean;
  isThisLoading: boolean;
}

/** Derives playback state for a given messageId from TTS store selectors */
export function usePlaybackState(messageId: string): PlaybackState {
  const isSpeaking = useTTSStore((s) => s.isSpeaking);
  const isPaused = useTTSStore((s) => s.isPaused);
  const isAudioPlaying = useTTSStore((s) => s.isAudioPlaying);
  const currentMessageId = useTTSStore((s) => s.currentMessageId);

  const isThisPlaying = isSpeaking && currentMessageId === messageId && !isPaused;
  const isThisPaused = isSpeaking && currentMessageId === messageId && isPaused;
  const isThisAudible = isAudioPlaying && currentMessageId === messageId && !isPaused;
  const isThisLoading = isThisPlaying && !isThisAudible;

  return { isThisPlaying, isThisPaused, isThisAudible, isThisLoading };
}

/** Hook for wall-clock elapsed timer */
export function useElapsedTimer(
  isThisAudible: boolean,
  isThisPaused: boolean,
  seekOffsetRef: React.MutableRefObject<number>,
) {
  const [localElapsed, setLocalElapsed] = useState(0);
  const startTimeRef = useRef<number>(0);
  const pausedAtRef = useRef<number>(0);

  useEffect(() => {
    if (!isThisAudible && !isThisPaused) {
      if (seekOffsetRef.current === 0) {
        setLocalElapsed(0);
        pausedAtRef.current = 0;
      }
      return;
    }
    if (isThisPaused) {
      pausedAtRef.current = localElapsed;
      return;
    }
    const offset = seekOffsetRef.current || pausedAtRef.current;
    seekOffsetRef.current = 0;
    startTimeRef.current = Date.now() - offset * 1000;
    const id = setInterval(() => {
      setLocalElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 500);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isThisAudible, isThisPaused]);

  return { localElapsed, setLocalElapsed };
}

/** Play/pause button with loading states */
export const PlayButton: React.FC<{
  isLoading: boolean;
  isThisLoading: boolean;
  isThisPlaying: boolean;
  onPlayPause: () => void;
  colors: ThemeColors;
  styles: any;
}> = ({ isLoading, isThisLoading, isThisPlaying, onPlayPause, colors, styles }) => {
  if (isLoading) {
    return (
      <View style={[styles.playButton, styles.playButtonDisabled]}>
        <Icon name="play" size={16} color={colors.primary} />
      </View>
    );
  }
  if (isThisLoading) {
    return (
      <View style={styles.playButton}>
        <ActivityIndicator size="small" color={colors.primary} />
      </View>
    );
  }
  return (
    <TouchableOpacity
      onPress={onPlayPause}
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
};

/** Speed cycle chip */
export const SpeedChip: React.FC<{
  styles: any;
}> = ({ styles }) => {
  const speed = useTTSStore((s) => s.settings.speed);
  const updateSettings = useTTSStore((s) => s.updateSettings);

  const handleSpeedCycle = useCallback(() => {
    let idx = SPEED_STEPS.indexOf(speed);
    if (idx < 0) {
      idx = SPEED_STEPS.findIndex((s) => s > speed) - 1;
      if (idx < 0) idx = 0;
    }
    const next = (idx + 1) % SPEED_STEPS.length;
    updateSettings({ speed: SPEED_STEPS[next] });
  }, [speed, updateSettings]);

  return (
    <TouchableOpacity
      onPress={handleSpeedCycle}
      style={styles.speedChip}
      hitSlop={{ top: 8, left: 8, right: 8 }}
    >
      <Text style={styles.speedText}>{speed}x</Text>
    </TouchableOpacity>
  );
};

/** Duration display */
export const DurationText: React.FC<{
  isLoading: boolean;
  totalDuration: number;
  styles: any;
}> = ({ isLoading, totalDuration, styles }) => (
  <Text style={styles.duration}>
    {isLoading ? '—' : formatDuration(totalDuration)}
  </Text>
);

/** Seekable progress bar using native Slider component */
export const SeekBar: React.FC<{
  displayProgress: number;
  colors: ThemeColors;
  styles: any;
  onSeek: (fraction: number) => void;
}> = ({ displayProgress, colors, styles, onSeek }) => {
  const [isSeeking, setIsSeeking] = useState(false);
  const [seekValue, setSeekValue] = useState(0);

  return (
    <Slider
      style={styles.seekSlider}
      value={isSeeking ? seekValue : displayProgress}
      minimumValue={0}
      maximumValue={1}
      minimumTrackTintColor={colors.primary}
      maximumTrackTintColor={`${colors.primary}20`}
      thumbTintColor={colors.primary}
      onSlidingStart={(val) => { setIsSeeking(true); setSeekValue(val); }}
      onValueChange={(val) => { if (isSeeking) setSeekValue(val); }}
      onSlidingComplete={(val) => { setIsSeeking(false); onSeek(val); }}
    />
  );
};

/** Transcript with word-level highlighting based on playback progress */
export const TranscriptSection: React.FC<{
  transcript?: string;
  colors: ThemeColors;
  styles: any;
  /** 0–1 playback progress, used for word highlighting */
  progress?: number;
}> = ({ transcript, colors, styles, progress = 0 }) => {
  const [showTranscript, setShowTranscript] = useState(false);

  if (!transcript) return null;

  return (
    <>
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
      {showTranscript && (
        <View style={styles.transcriptContent}>
          {progress > 0 ? (
            <HighlightedTranscript text={transcript} progress={progress} colors={colors} styles={styles} />
          ) : (
            <MarkdownText>{transcript}</MarkdownText>
          )}
        </View>
      )}
    </>
  );
};

/** Renders transcript with words highlighted up to the current playback position */
const HighlightedTranscript: React.FC<{
  text: string;
  progress: number;
  colors: ThemeColors;
  styles: any;
}> = ({ text, progress, colors, styles }) => {
  const words = text.split(/(\s+)/); // preserve whitespace
  const totalChars = text.length;
  const highlightUpTo = Math.floor(progress * totalChars);

  let charCount = 0;
  return (
    <Text style={styles.transcriptText}>
      {words.map((word, i) => {
        const wordStart = charCount;
        charCount += word.length;
        const isSpoken = wordStart < highlightUpTo;
        return (
          <Text
            key={i}
            style={{ color: isSpoken ? colors.text : colors.textMuted }}
          >
            {word}
          </Text>
        );
      })}
    </Text>
  );
};

/** Hook for seek logic */
interface SeekHandlerParams {
  transcript: string | undefined;
  audioPath: string;
  messageId: string;
  totalDurationRef: React.MutableRefObject<number>;
  seekOffsetRef: React.MutableRefObject<number>;
  setLocalElapsed: (v: number) => void;
  setIsSeeking: (v: boolean) => void;
}

export function useSeekHandler({
  transcript, audioPath, messageId,
  totalDurationRef, seekOffsetRef, setLocalElapsed, setIsSeeking,
}: SeekHandlerParams) {
  const stop = useTTSStore((s) => s.stop);
  const speak = useTTSStore((s) => s.speak);

  return useCallback((fraction: number) => {
    if (!transcript || audioPath) return;
    const text = stripMarkdownForSpeech(transcript);
    const charOffset = Math.floor(fraction * text.length);
    const seekPoint = text.lastIndexOf('. ', charOffset) + 2 || charOffset;
    const remaining = text.slice(seekPoint).trim();
    console.log(`[AudioBubble] seeking to ${Math.round(fraction * 100)}%`, 'charOffset:', charOffset, 'remaining:', remaining.length, 'chars');
    if (!remaining) return;
    const seekSeconds = Math.floor(fraction * totalDurationRef.current);
    seekOffsetRef.current = seekSeconds;
    setLocalElapsed(seekSeconds);
    setIsSeeking(true);
    stop();
    setTimeout(() => {
      speak(remaining, messageId).finally(() => setIsSeeking(false));
    }, 200);
  }, [transcript, audioPath, stop, speak, messageId, totalDurationRef, seekOffsetRef, setLocalElapsed, setIsSeeking]);
}
