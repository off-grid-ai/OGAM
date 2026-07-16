import React, { useRef, useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Animated,
  PanResponder,
  GestureResponderEvent,
  PanResponderGestureState,
  Vibration,
} from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import ReanimatedAnimated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { useThemedStyles } from '../../theme';
import { CustomAlert, showAlert, hideAlert, AlertState, initialAlertState } from '../CustomAlert';
import { createStyles } from './styles';
import { LoadingState, TranscribingState, UnavailableButton, DownloadingButton, ButtonIcon } from './states';
import { deriveVoiceButtonState } from './derive';
import { useWhisperStore } from '../../stores';
import logger from '../../utils/logger';

const DOWNLOAD_MODEL_ID = 'base.en';
const DOWNLOAD_MODEL_SIZE_MB = 142;

interface VoiceRecordButtonProps {
  isRecording: boolean;
  isAvailable: boolean;
  isModelLoading?: boolean;
  isTranscribing?: boolean;
  partialResult: string;
  error?: string | null;
  disabled?: boolean;
  onStartRecording: () => void;
  onStopRecording: () => void;
  onCancelRecording: () => void;
  asSendButton?: boolean;
}

const CANCEL_DISTANCE = 80;

type CallbacksRef = { onStartRecording: () => void; onStopRecording: () => void; onCancelRecording: () => void };

function buildPanResponder({
  isDraggingToCancel,
  cancelOffsetX,
  callbacksRef,
}: {
  isDraggingToCancel: React.MutableRefObject<boolean>;
  cancelOffsetX: Animated.Value;
  callbacksRef: React.MutableRefObject<CallbacksRef>;
}) {
  return PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: () => {
      logger.log('[VoiceButton] Press started');
      Vibration.vibrate(50);
      isDraggingToCancel.current = false;
      callbacksRef.current.onStartRecording();
    },
    onPanResponderMove: (_: GestureResponderEvent, gestureState: PanResponderGestureState) => {
      const offsetX = Math.min(0, gestureState.dx);
      cancelOffsetX.setValue(offsetX);
      const wasInCancelZone = isDraggingToCancel.current;
      const isInCancelZone = Math.abs(offsetX) > CANCEL_DISTANCE;
      if (isInCancelZone && !wasInCancelZone) Vibration.vibrate(30);
      isDraggingToCancel.current = isInCancelZone;
    },
    onPanResponderRelease: () => {
      logger.log('[VoiceButton] Press released, cancel:', isDraggingToCancel.current);
      Vibration.vibrate(30);
      if (isDraggingToCancel.current) {
        callbacksRef.current.onCancelRecording();
      } else {
        callbacksRef.current.onStopRecording();
      }
      Animated.spring(cancelOffsetX, { toValue: 0, useNativeDriver: true }).start();
      isDraggingToCancel.current = false;
    },
    onPanResponderTerminate: () => {
      logger.log('[VoiceButton] Press terminated');
      callbacksRef.current.onCancelRecording();
      Animated.spring(cancelOffsetX, { toValue: 0, useNativeDriver: true }).start();
      isDraggingToCancel.current = false;
    },
  });
}

type VoiceButtonStyles = ReturnType<typeof createStyles>;

/** Chat-mode (hold-to-record) button style stack. Extracted to module scope to
 *  keep the component's cyclomatic complexity under the lint limit. */
const buildChatButtonStyle = (
  styles: VoiceButtonStyles,
  opts: { asSendButton: boolean; isRecording: boolean; disabled?: boolean },
) => [
  styles.button,
  opts.asSendButton && styles.buttonAsSend,
  opts.isRecording && styles.buttonRecording,
  opts.disabled && styles.buttonDisabled,
];

/** Audio-mode (tap-to-toggle) busy face: the load vs transcribe spinner. Audio mode has no
 *  hold gesture, so it can safely replace the whole button while busy. Module scope keeps the
 *  pick out of the component's complexity budget. */
const AudioBusyFace: React.FC<{ kind: 'loading' | 'transcribing'; loadingAnim: Animated.Value }> = ({ kind, loadingAnim }) =>
  kind === 'loading'
    ? <LoadingState asSendButton={false} loadingAnim={loadingAnim} />
    : <TranscribingState asSendButton={false} loadingAnim={loadingAnim} />;

/** The inner face of the chat-mode hold button — a spinner while a cold model load /
 *  transcription is in flight, the mic otherwise. Extracted to module scope so the
 *  branch stays out of the component's cyclomatic-complexity budget, and so the ONE
 *  gesturable wrapper can swap its face without ever unmounting (the slide-to-cancel /
 *  ghost-recording fix). */
const ChatButtonFace: React.FC<{
  kind: 'loading' | 'transcribing' | 'ready' | 'downloading' | 'unavailable';
  loadingAnim: Animated.Value;
  buttonStyle: ReturnType<typeof buildChatButtonStyle>;
  isRecording: boolean;
}> = ({ kind, loadingAnim, buttonStyle, isRecording }) => {
  if (kind === 'loading') return <LoadingState asSendButton loadingAnim={loadingAnim} />;
  if (kind === 'transcribing') return <TranscribingState asSendButton loadingAnim={loadingAnim} />;
  return (
    <View style={buttonStyle}>
      <ButtonIcon asSendButton isRecording={isRecording} />
    </View>
  );
};

export const VoiceRecordButton: React.FC<VoiceRecordButtonProps> = ({
  isRecording,
  isAvailable,
  isModelLoading,
  isTranscribing,
  partialResult,
  error: _error,
  disabled,
  onStartRecording,
  onStopRecording,
  onCancelRecording,
  asSendButton = false,
}) => {
  const styles = useThemedStyles(createStyles);
  const downloadModel = useWhisperStore((s) => s.downloadModel);
  const downloadProgressById = useWhisperStore((s) => s.downloadProgressById);
  // The ONE derivation of what the mic renders (see derive.ts): a background STT
  // download is never the busy spinner — that is reserved for a tap-triggered
  // model load and live transcription.
  const buttonState = deriveVoiceButtonState({
    isAvailable,
    isModelLoading: !!isModelLoading,
    isTranscribing: !!isTranscribing,
    isRecording,
    downloadProgressById,
  });
  // State-machine trace: which face the mic renders. This is the crux of the
  // slide-to-cancel / release-during-load behaviour — when kind flips to 'loading'
  // the hold-to-record view (and its PanResponder) is replaced by a gesture-less
  // spinner, so the finger that is still down loses its cancel affordance.
  logger.log('[VoiceButton-SM] render kind=', buttonState.kind, 'asSend=', asSendButton, 'recording=', isRecording);

  const pulseAnim = useRef(new Animated.Value(1)).current;
  const loadingAnim = useRef(new Animated.Value(0)).current;
  const cancelOffsetX = useRef(new Animated.Value(0)).current;
  const isDraggingToCancel = useRef(false);
  const [alertState, setAlertState] = useState<AlertState>(initialAlertState);

  const rippleScale = useSharedValue(1);
  const rippleOpacity = useSharedValue(0);

  useEffect(() => {
    if (isRecording) {
      rippleScale.value = 1;
      rippleOpacity.value = 0.4;
      rippleScale.value = withRepeat(withTiming(2.2, { duration: 1200, easing: Easing.out(Easing.ease) }), -1, false);
      rippleOpacity.value = withRepeat(withTiming(0, { duration: 1200, easing: Easing.out(Easing.ease) }), -1, false);
    } else {
      rippleScale.value = 1;
      rippleOpacity.value = 0;
    }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRecording]);

  const rippleStyle = useAnimatedStyle(() => ({
    transform: [{ scale: rippleScale.value }],
    opacity: rippleOpacity.value,
  }));

  useEffect(() => {
    if (buttonState.kind === 'loading' || buttonState.kind === 'transcribing') {
      const spin = Animated.loop(Animated.timing(loadingAnim, { toValue: 1, duration: 1000, useNativeDriver: true }));
      spin.start();
      return () => spin.stop();
    }
    loadingAnim.setValue(0);
  }, [buttonState.kind, loadingAnim]);

  const callbacksRef = useRef<CallbacksRef>({ onStartRecording, onStopRecording, onCancelRecording });
  callbacksRef.current = { onStartRecording, onStopRecording, onCancelRecording };

  useEffect(() => {
    if (isRecording) {
      // Jump the mic noticeably bigger the instant it's pressed (like WhatsApp), so it's obvious the
      // hold registered, then breathe gently around that enlarged size while recording.
      pulseAnim.setValue(1.4);
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.5, duration: 600, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1.4, duration: 600, useNativeDriver: true }),
        ]),
      );
      pulse.start();
      return () => pulse.stop();
    }
    pulseAnim.setValue(1);
  }, [isRecording, pulseAnim]);

  const panResponder = useRef(buildPanResponder({ isDraggingToCancel, cancelOffsetX, callbacksRef })).current;

  const handleUnavailableTap = () => {
    setAlertState(showAlert(
      'Download Voice Model',
      `Download Whisper Base to enable voice input? (${DOWNLOAD_MODEL_SIZE_MB} MB)`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Download',
          onPress: () => {
            setAlertState(hideAlert());
            downloadModel(DOWNLOAD_MODEL_ID).catch((err) => {
              logger.error('[VoiceRecordButton] Download failed:', err);
            });
          },
        },
      ],
    ));
  };

  const alert = (
    <CustomAlert
      visible={alertState.visible}
      title={alertState.title}
      message={alertState.message}
      buttons={alertState.buttons}
      onClose={() => setAlertState(hideAlert())}
    />
  );

  // Audio mode (tap-to-toggle) has no hold gesture, so a load/transcribe spinner can
  // safely REPLACE the button. Chat mode (asSendButton, hold-to-record + slide-to-cancel)
  // must NOT early-return here: replacing the button with a bare spinner unmounts the
  // PanResponder mid-hold, severing the finger's gesture the instant a cold model load
  // begins — that is what broke slide-to-cancel and left a ghost recording on release
  // (no responderRelease reached a handler). Chat mode keeps ONE gesturable wrapper
  // mounted across ready/loading/transcribing and swaps only the inner face (below).
  if (!asSendButton && (buttonState.kind === 'loading' || buttonState.kind === 'transcribing')) {
    return (
      <View style={styles.container}>
        <AudioBusyFace kind={buttonState.kind} loadingAnim={loadingAnim} />
        {alert}
      </View>
    );
  }

  if (buttonState.kind === 'downloading' || buttonState.kind === 'unavailable') {
    return (
      <View style={styles.container}>
        <TouchableOpacity
          testID="voice-record-button-unavailable"
          style={styles.buttonWrapper}
          onPress={handleUnavailableTap}
          disabled={buttonState.kind === 'downloading'}
        >
          {buttonState.kind === 'downloading'
            ? <DownloadingButton asSendButton={asSendButton} progress={buttonState.progress} />
            : <UnavailableButton asSendButton={asSendButton} />}
        </TouchableOpacity>
        {alert}
      </View>
    );
  }

  const buttonStyle = buildChatButtonStyle(styles, { asSendButton, isRecording, disabled });

  // ── Audio mode: tap-to-toggle (tap to start, tap to stop & send) ───────────
  if (!asSendButton) {
    const handleToggle = () => {
      if (disabled) return;
      Vibration.vibrate(50);
      if (isRecording) {
        onStopRecording();
      } else {
        onStartRecording();
      }
    };

    return (
      <View style={styles.container}>
        {isRecording && <ReanimatedAnimated.View style={[styles.rippleRing, rippleStyle]} />}
        <Animated.View
          style={[styles.buttonWrapper, { transform: [{ scale: isRecording ? pulseAnim : 1 }] }]}
        >
          <TouchableOpacity
            testID="voice-record-button-audio"
            onPress={handleToggle}
            disabled={disabled}
            activeOpacity={0.7}
          >
            <View style={[styles.button, styles.buttonAudio, isRecording && styles.buttonRecording, disabled && styles.buttonDisabled]}>
              {isRecording
                ? <Icon name="square" size={24} color="#fff" />
                : <ButtonIcon asSendButton={false} isRecording={false} size={30} />}
            </View>
          </TouchableOpacity>
        </Animated.View>
        {alert}
      </View>
    );
  }

  // ── Chat mode: hold-to-record with slide-to-cancel ─────────────────────────
  // The mic follows the finger (translateX) and scales up while pressed. The "Slide to cancel"
  // hint is NOT drawn here — it lives inline in the composer (ChatInput), the WhatsApp pattern —
  // so it's always visible and never overlaps the mic. The gesturable wrapper stays mounted across
  // ready/loading so the hold + slide + release gesture is continuous even through a cold load.
  return (
    <View style={styles.container}>
      {isRecording && partialResult && (
        <View style={styles.partialResultContainer}>
          <Text style={styles.partialResultText} numberOfLines={1}>{partialResult}</Text>
        </View>
      )}
      {isRecording && <ReanimatedAnimated.View style={[styles.rippleRing, rippleStyle]} />}
      <Animated.View
        testID="voice-record-button"
        style={[styles.buttonWrapper, { transform: [{ scale: isRecording ? pulseAnim : 1 }, { translateX: cancelOffsetX }] }]}
        {...(disabled ? {} : panResponder.panHandlers)}
      >
        <ChatButtonFace kind={buttonState.kind} loadingAnim={loadingAnim} buttonStyle={buttonStyle} isRecording={isRecording} />
      </Animated.View>
      {alert}
    </View>
  );
};
