import React from 'react';
import { View, Text, Animated, ActivityIndicator } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme, useThemedStyles } from '../../theme';
import { createStyles } from './styles';

// ─── Loading state ────────────────────────────────────────────────────────────

interface LoadingStateProps {
  asSendButton: boolean;
  loadingAnim: Animated.Value;
}

export const LoadingState: React.FC<LoadingStateProps> = ({ asSendButton, loadingAnim }) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const spin = loadingAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  // Audio mode: a 56px spinner ring sized exactly like the mic (no smaller button +
  // "Loading…" text), so the bottom bar height doesn't shift while the model loads.
  if (!asSendButton) {
    return <Animated.View testID="voice-loading" style={[styles.button, styles.buttonAudioLoading, { transform: [{ rotate: spin }] }]} />;
  }
  return (
    <Animated.View testID="voice-loading" style={[styles.button, styles.buttonAsSendLoading, { transform: [{ rotate: spin }] }]}>
      <Icon name="mic" size={18} color={colors.primary} />
    </Animated.View>
  );
};

// ─── Transcribing state ───────────────────────────────────────────────────────

interface TranscribingStateProps {
  asSendButton: boolean;
  loadingAnim: Animated.Value;
}

export const TranscribingState: React.FC<TranscribingStateProps> = ({ asSendButton, loadingAnim }) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const spin = loadingAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  // Audio mode: 56px ring matching the mic footprint (see LoadingState).
  if (!asSendButton) {
    return <Animated.View style={[styles.button, styles.buttonAudioTranscribing, { transform: [{ rotate: spin }] }]} />;
  }
  return (
    <Animated.View style={[styles.button, styles.buttonAsSendLoading, { transform: [{ rotate: spin }] }]}>
      <Icon name="mic" size={18} color={colors.info} />
    </Animated.View>
  );
};

// ─── Unavailable state ────────────────────────────────────────────────────────

interface UnavailableButtonProps {
  asSendButton: boolean;
  /** 0–1 while downloading, undefined when idle */
  downloadProgress?: number;
}

export const UnavailableButton: React.FC<UnavailableButtonProps> = ({ asSendButton, downloadProgress }) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const isDownloading = downloadProgress !== undefined;

  if (asSendButton) {
    return (
      <View style={[styles.button, styles.buttonAsSendUnavailable]}>
        {isDownloading
          ? <ActivityIndicator size="small" color={colors.primary} />
          : <Icon name="mic-off" size={18} color={colors.textMuted} />}
      </View>
    );
  }

  return (
    <View style={[styles.button, styles.buttonUnavailable]}>
      {isDownloading ? (
        <>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={styles.loadingText}>{Math.round(downloadProgress * 100)}%</Text>
        </>
      ) : (
        <>
          <View style={styles.micIcon}>
            <View style={[styles.micBody, styles.micBodyUnavailable]} />
            <View style={[styles.micBase, styles.micBodyUnavailable]} />
          </View>
          <View style={styles.unavailableSlash} />
        </>
      )}
    </View>
  );
};

// ─── Button icon ──────────────────────────────────────────────────────────────

interface ButtonIconProps {
  asSendButton: boolean;
  isRecording: boolean;
  size?: number;
}

export const ButtonIcon: React.FC<ButtonIconProps> = ({ asSendButton: _asSendButton, isRecording, size = 18 }) => {
  const { colors } = useTheme();
  const iconColor = isRecording ? colors.surface : colors.primary;
  return <Icon name="mic" size={size} color={iconColor} />;
};
