import React, { useEffect } from 'react';
import { TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme } from '../../theme';
import { useTTSStore } from '../../stores/ttsStore';
import { SPACING } from '../../constants';

interface TTSButtonProps {
  text: string;
  messageId: string;
}

export const TTSButton: React.FC<TTSButtonProps> = ({ text, messageId }) => {
  const { colors } = useTheme();
  const {
    speak,
    stop,
    isSpeaking,
    isGeneratingAudio,
    isModelLoading,
    isModelLoaded,
    currentMessageId,
    settings,
    isBackboneDownloaded,
    isVocoderDownloaded,
    kokoroReady,
    loadModels,
  } = useTTSStore();

  const areBothDownloaded = isBackboneDownloaded && isVocoderDownloaded;
  const isThisMessage = currentMessageId === messageId;
  // Kokoro streams so no separate generation phase — only OuteTTS sets isGeneratingAudio
  const isThisMessageGenerating = isGeneratingAudio && isThisMessage;
  const isThisMessageSpeaking = isSpeaking && !isGeneratingAudio && isThisMessage;

  // Button is usable if Kokoro is ready (fast path) OR OuteTTS is downloaded (slow path)
  const canSpeak = kokoroReady || areBothDownloaded;

  const opacity = useSharedValue(1);
  useEffect(() => {
    if (isThisMessageSpeaking) {
      opacity.value = withRepeat(
        withSequence(
          withTiming(0.4, { duration: 600 }),
          withTiming(1, { duration: 600 }),
        ),
        -1,
        false,
      );
    } else {
      opacity.value = withTiming(1, { duration: 200 });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isThisMessageSpeaking]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  // Don't render if TTS disabled or no model is usable (Kokoro or OuteTTS)
  if (!settings.enabled || !canSpeak) {
    return null;
  }

  // Show spinner while model is loading for this message, or while generating audio tokens
  if ((isModelLoading && isThisMessage) || isThisMessageGenerating) {
    return <ActivityIndicator size="small" color={colors.textMuted} style={styles.button} />;
  }

  const handlePress = () => {
    if (isThisMessageSpeaking || isThisMessageGenerating) {
      stop();
      return;
    }
    // Kokoro: ready immediately, no model loading step needed
    if (kokoroReady) {
      speak(text, messageId);
      return;
    }
    // OuteTTS fallback: load models on first press if needed
    if (!isModelLoaded) {
      loadModels().then(() => {
        useTTSStore.getState().speak(text, messageId);
      });
      return;
    }
    speak(text, messageId);
  };

  return (
    <TouchableOpacity
      onPress={handlePress}
      style={styles.button}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      testID={`tts-button-${messageId}`}
    >
      <Animated.View style={isThisMessageSpeaking ? animatedStyle : undefined}>
        <Icon
          name={isThisMessageSpeaking ? 'volume-2' : 'volume-1'}
          size={14}
          color={isThisMessageSpeaking ? colors.primary : colors.textMuted}
        />
      </Animated.View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  button: {
    padding: SPACING.xs,
  },
});
