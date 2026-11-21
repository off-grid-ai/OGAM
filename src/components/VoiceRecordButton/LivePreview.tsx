import React, { useEffect, useState } from 'react';
import { Text } from 'react-native';
import Animated, { FadeIn, FadeOut, useReducedMotion } from 'react-native-reanimated';
import { EMPTY_LIVE_TRANSCRIPT, liveTranscriptParts, type LiveTranscript } from '@offgrid/speech';
import { whisperService } from '../../services/whisperService';
import { useThemedStyles } from '../../theme';
import { createStyles } from './styles';

/**
 * What whisper has heard so far, beside the mic while it records. Settled words are full colour,
 * the newest guess is lighter; the newest words stay in view as the text grows.
 */
export const LivePreview: React.FC<{
  /** Shown as a guess when the engine streams plain text instead of slices (Qwen3-ASR). */
  fallbackText?: string;
}> = ({ fallbackText }) => {
  const styles = useThemedStyles(createStyles);
  const reducedMotion = useReducedMotion();
  const [transcript, setTranscript] = useState<LiveTranscript>(EMPTY_LIVE_TRANSCRIPT);
  useEffect(() => whisperService.onLiveTranscript(setTranscript), []);
  const sliced = liveTranscriptParts(transcript);
  const parts = sliced.length > 0 || !fallbackText ? sliced : [{ text: fallbackText, final: false }];
  if (parts.length === 0) return null;

  return (
    <Animated.View
      style={styles.partialResultContainer}
      entering={reducedMotion ? undefined : FadeIn.duration(180)}
      exiting={reducedMotion ? undefined : FadeOut.duration(140)}
    >
      <Text
        testID="voice-live-transcript"
        accessibilityLiveRegion="polite"
        style={styles.partialResultText}
        numberOfLines={3}
        ellipsizeMode="head"
      >
        {parts.map((part, index) => (
          <Text key={index} style={part.final ? undefined : styles.partialResultInterim}>
            {part.text}
          </Text>
        ))}
      </Text>
    </Animated.View>
  );
};
