import React from 'react';
import { View, Text, Animated } from 'react-native';
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

  return (
    <View style={asSendButton ? undefined : styles.loadingContainer}>
      <Animated.View style={[styles.button, asSendButton ? styles.buttonAsSendLoading : styles.buttonLoading, { transform: [{ rotate: spin }] }]}>
        {asSendButton ? <Icon name="mic" size={18} color={colors.primary} /> : <View style={styles.loadingIndicator} />}
      </Animated.View>
      {!asSendButton && <Text style={styles.loadingText}>Loading...</Text>}
    </View>
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

  return (
    <View style={asSendButton ? undefined : styles.loadingContainer}>
      <Animated.View style={[styles.button, asSendButton ? styles.buttonAsSendLoading : styles.buttonTranscribing, { transform: [{ rotate: spin }] }]}>
        {asSendButton ? <Icon name="mic" size={18} color={colors.info} /> : <View style={styles.loadingIndicator} />}
      </Animated.View>
    </View>
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
        <Icon name={isDownloading ? 'download' : 'mic-off'} size={18} color={colors.textMuted} />
      </View>
    );
  }

  return (
    <View style={[styles.button, styles.buttonUnavailable]}>
      {isDownloading ? (
        <>
          <Icon name="download" size={14} color={colors.textMuted} />
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
}

export const ButtonIcon: React.FC<ButtonIconProps> = ({ asSendButton, isRecording }) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);

  if (asSendButton) {
    return <Icon name={isRecording ? 'mic' : 'send'} size={18} color={colors.primary} />;
  }

  return (
    <View style={styles.micIcon}>
      <View style={[styles.micBody, isRecording && styles.micBodyRecording]} />
      <View style={[styles.micBase, isRecording && styles.micBodyRecording]} />
    </View>
  );
};
