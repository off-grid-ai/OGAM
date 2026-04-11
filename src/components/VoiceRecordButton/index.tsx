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
import { LoadingState, TranscribingState, UnavailableButton, ButtonIcon } from './states';
import { useWhisperStore } from '../../stores';
import logger from '../../utils/logger';

const DOWNLOAD_MODEL_ID = 'small.en';
const DOWNLOAD_MODEL_SIZE_MB = 466;

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
  const { downloadModel, isDownloading, downloadProgress } = useWhisperStore();

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
    if (isModelLoading || (isTranscribing && !isRecording)) {
      const spin = Animated.loop(Animated.timing(loadingAnim, { toValue: 1, duration: 1000, useNativeDriver: true }));
      spin.start();
      return () => spin.stop();
    }
    loadingAnim.setValue(0);
  }, [isModelLoading, isTranscribing, isRecording, loadingAnim]);

  const callbacksRef = useRef<CallbacksRef>({ onStartRecording, onStopRecording, onCancelRecording });
  callbacksRef.current = { onStartRecording, onStopRecording, onCancelRecording };

  useEffect(() => {
    if (isRecording) {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.2, duration: 500, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 500, useNativeDriver: true }),
        ]),
      );
      pulse.start();
      return () => pulse.stop();
    }
    pulseAnim.setValue(1);
  }, [isRecording, pulseAnim]);

  const panResponder = useRef(buildPanResponder({ isDraggingToCancel, cancelOffsetX, callbacksRef })).current;

  const handleUnavailableTap = () => {
    if (isDownloading) { return; }
    setAlertState(showAlert(
      'Download Voice Model',
      `Download Whisper Small to enable voice input? (${DOWNLOAD_MODEL_SIZE_MB} MB)`,
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

  if (isModelLoading) {
    return (
      <View style={styles.container}>
        <LoadingState asSendButton={asSendButton} loadingAnim={loadingAnim} />
        {alert}
      </View>
    );
  }

  if (isTranscribing && !isRecording) {
    return (
      <View style={styles.container}>
        <TranscribingState asSendButton={asSendButton} loadingAnim={loadingAnim} />
        {alert}
      </View>
    );
  }

  if (!isAvailable) {
    return (
      <View style={styles.container}>
        <TouchableOpacity style={styles.buttonWrapper} onPress={handleUnavailableTap} disabled={isDownloading}>
          <UnavailableButton asSendButton={asSendButton} downloadProgress={isDownloading ? downloadProgress : undefined} />
        </TouchableOpacity>
        {alert}
      </View>
    );
  }

  const buttonStyle = [
    styles.button,
    asSendButton && styles.buttonAsSend,
    isRecording && styles.buttonRecording,
    disabled && styles.buttonDisabled,
  ];

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
            onPress={handleToggle}
            disabled={disabled}
            activeOpacity={0.7}
          >
            <View style={buttonStyle}>
              {isRecording
                ? <Icon name="square" size={16} color="#fff" />
                : <ButtonIcon asSendButton={false} isRecording={false} />}
            </View>
          </TouchableOpacity>
        </Animated.View>
        {alert}
      </View>
    );
  }

  // ── Chat mode: hold-to-record with slide-to-cancel ─────────────────────────
  return (
    <View style={styles.container}>
      {isRecording && (
        <Animated.View
          style={[styles.cancelHint, { opacity: cancelOffsetX.interpolate({ inputRange: [-CANCEL_DISTANCE, 0], outputRange: [1, 0], extrapolate: 'clamp' }) }]}
        >
          <Text style={styles.cancelHintText}>Slide to cancel</Text>
        </Animated.View>
      )}
      {isRecording && partialResult && (
        <View style={styles.partialResultContainer}>
          <Text style={styles.partialResultText} numberOfLines={1}>{partialResult}</Text>
        </View>
      )}
      {isRecording && <ReanimatedAnimated.View style={[styles.rippleRing, rippleStyle]} />}
      <Animated.View
        style={[styles.buttonWrapper, { transform: [{ scale: isRecording ? pulseAnim : 1 }, { translateX: cancelOffsetX }] }]}
        {...(disabled ? {} : panResponder.panHandlers)}
      >
        <View style={buttonStyle}>
          <ButtonIcon asSendButton={asSendButton} isRecording={isRecording} />
        </View>
      </Animated.View>
      {alert}
    </View>
  );
};
