import React from 'react';
import { View, TouchableOpacity, Text, ActivityIndicator } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme } from '../../theme';
import { ImageModeState, MediaAttachment } from '../../types';
import { VoiceRecordButton } from '../VoiceRecordButton';
import { triggerHaptic } from '../../utils/haptics';
import { CustomAlert, hideAlert, AlertState } from '../CustomAlert';
import { QueueRow } from './Toolbar';
import { AttachmentPreview } from './Attachments';
import { AttachPickerPopover, VoicePickerPopover, QuickSettingsPopover } from './Popovers';
import { useTTSStore } from '../../stores/ttsStore';
import type { KOKORO_VOICES } from '../../constants/kokoroModels';

interface AudioModeLayoutProps {
  styles: any;
  disabled?: boolean;
  isGenerating?: boolean;
  imageMode: ImageModeState;
  imageModelLoaded: boolean;
  supportsThinking: boolean;
  supportsToolCalling: boolean;
  enabledToolCount: number;
  thinkingEnabled: boolean;
  currentVoice: typeof KOKORO_VOICES[number];
  // Attachments
  attachments: MediaAttachment[];
  onRemoveAttachment: (id: string) => void;
  // Queue
  queueCount: number;
  queuedTexts: string[];
  onClearQueue?: () => void;
  // Voice recording
  isRecording: boolean;
  voiceAvailable: boolean;
  isModelLoading: boolean;
  isTranscribing: boolean;
  partialResult: string;
  error: string | null;
  onStartRecording: () => void;
  onStopRecording: () => void;
  onCancelRecording: () => void;
  // Handlers
  onStop?: () => void;
  onImageModeToggle: () => void;
  onThinkingToggle: () => void;
  onToolsPress?: () => void;
  onVisionPress: () => void;
  onPickDocument: () => void;
  // Popovers
  attachPicker: any;
  voicePicker: any;
  quickSettings: any;
  supportsVision: boolean;
  // Alert
  alertState: AlertState;
  setAlertState: (s: AlertState) => void;
}

export const AudioModeLayout: React.FC<AudioModeLayoutProps> = ({
  styles,
  disabled,
  isGenerating,
  imageMode,
  imageModelLoaded,
  supportsThinking,
  supportsToolCalling,
  enabledToolCount,
  thinkingEnabled,
  currentVoice,
  attachments,
  onRemoveAttachment,
  queueCount,
  queuedTexts,
  onClearQueue,
  isRecording,
  voiceAvailable,
  isModelLoading,
  isTranscribing,
  partialResult,
  error,
  onStartRecording,
  onStopRecording,
  onCancelRecording,
  onStop,
  onImageModeToggle,
  onThinkingToggle,
  onToolsPress,
  onVisionPress,
  onPickDocument,
  attachPicker,
  voicePicker,
  quickSettings,
  supportsVision,
  alertState,
  setAlertState,
}) => {
  const { colors } = useTheme();
  const isChangingVoice = useTTSStore((s) => s.settings.kokoroVoiceId !== s.kokoroActiveVoiceId);

  const handleStop = () => {
    if (onStop && isGenerating) {
      triggerHaptic('impactLight');
      onStop();
    }
  };

  const audioStopButton = isGenerating && onStop ? (
    <TouchableOpacity
      testID="stop-button"
      style={styles.circleButton}
      onPress={handleStop}
    >
      <Icon name="square" size={18} color={colors.background} />
    </TouchableOpacity>
  ) : null;

  return (
    <View style={styles.container}>
      <AttachmentPreview attachments={attachments} onRemove={onRemoveAttachment} />
      <QueueRow
        queueCount={queueCount}
        queuedTexts={queuedTexts}
        onClearQueue={onClearQueue}
      />
      <View style={styles.audioModeRow}>
        <TouchableOpacity
          ref={attachPicker.triggerRef}
          style={styles.pillIconButton}
          onPress={() => attachPicker.show()}
          disabled={disabled}
          hitSlop={{ top: 4, bottom: 4, left: 8, right: 8 }}
        >
          <Icon name="plus" size={20} color={disabled ? colors.textMuted : colors.textSecondary} />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.pillIconButton}
          onPress={() => {
            triggerHaptic('impactLight');
            useTTSStore.getState().updateSettings({ interfaceMode: 'chat' });
          }}
          hitSlop={{ top: 4, bottom: 4, left: 8, right: 8 }}
        >
          <Icon name="message-square" size={18} color={colors.textSecondary} />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.pillIconButton}
          onPress={onImageModeToggle}
          disabled={disabled || !imageModelLoaded}
          hitSlop={{ top: 4, bottom: 4, left: 8, right: 8 }}
        >
          <Icon name="image" size={18} color={imageMode === 'force' ? colors.primary : !imageModelLoaded ? colors.textMuted : colors.textSecondary} />
        </TouchableOpacity>
        {supportsThinking && (
          <TouchableOpacity
            style={styles.pillIconButton}
            onPress={onThinkingToggle}
            disabled={disabled}
            hitSlop={{ top: 4, bottom: 4, left: 8, right: 8 }}
          >
            <Icon name="zap" size={18} color={thinkingEnabled ? colors.primary : (disabled ? colors.textMuted : colors.textSecondary)} />
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={styles.pillIconButton}
          onPress={() => { triggerHaptic('impactLight'); onToolsPress?.(); }}
          disabled={disabled || !supportsToolCalling}
          hitSlop={{ top: 4, bottom: 4, left: 8, right: 8 }}
        >
          <Icon name="tool" size={18} color={enabledToolCount > 0 ? colors.primary : !supportsToolCalling ? colors.textMuted : colors.textSecondary} />
        </TouchableOpacity>
        <TouchableOpacity
          ref={voicePicker.triggerRef}
          style={styles.audioVoiceButton}
          onPress={() => voicePicker.show()}
          hitSlop={{ top: 4, bottom: 4, left: 8, right: 8 }}
        >
          {isChangingVoice
            ? <ActivityIndicator size="small" color={colors.textMuted} />
            : <Icon name="user" size={14} color={colors.textSecondary} />}
          <Text style={styles.audioVoiceLabel}>{currentVoice.label}</Text>
        </TouchableOpacity>

        {isGenerating && onStop ? (
          audioStopButton
        ) : (
          <VoiceRecordButton
            isRecording={isRecording}
            isAvailable={voiceAvailable}
            isModelLoading={isModelLoading}
            isTranscribing={isTranscribing}
            partialResult={partialResult}
            error={error}
            disabled={disabled}
            onStartRecording={onStartRecording}
            onStopRecording={onStopRecording}
            onCancelRecording={onCancelRecording}
          />
        )}
      </View>

      <AttachPickerPopover
        visible={attachPicker.visible}
        onClose={attachPicker.hide}
        anchorY={attachPicker.anchor.y}
        anchorX={attachPicker.anchor.x}
        supportsVision={supportsVision}
        onPhoto={onVisionPress}
        onDocument={onPickDocument}
      />
      <VoicePickerPopover
        visible={voicePicker.visible}
        onClose={voicePicker.hide}
        anchorY={voicePicker.anchor.y}
        anchorX={voicePicker.anchor.x}
      />
      <QuickSettingsPopover
        visible={quickSettings.visible}
        onClose={quickSettings.hide}
        anchorY={quickSettings.anchor.y}
        anchorX={quickSettings.anchor.x}
        imageMode={imageMode}
        onImageModeToggle={onImageModeToggle}
        imageModelLoaded={imageModelLoaded}
        supportsThinking={supportsThinking}
        supportsToolCalling={supportsToolCalling}
        enabledToolCount={enabledToolCount}
        onToolsPress={onToolsPress}
      />
      <CustomAlert
        visible={alertState.visible}
        title={alertState.title}
        message={alertState.message}
        buttons={alertState.buttons}
        onClose={() => setAlertState(hideAlert())}
      />
    </View>
  );
};
