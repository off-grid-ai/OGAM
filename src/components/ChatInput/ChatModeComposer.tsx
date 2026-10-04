import React from 'react';
import {
  Animated,
  Platform,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import type { ThemeColors } from '../../theme';
import type { MediaAttachment } from '../../types';
import { CustomAlert, hideAlert, type AlertState } from '../CustomAlert';
import {
  VoiceRecordButton,
  type VoiceRecordInteractionMode,
} from '../VoiceRecordButton';
import { AttachmentPreview } from './Attachments';
import { ComposerIconsRow } from './ComposerIconsRow';
import { AttachPickerPopover, QuickSettingsPopover } from './Popovers';
import { RecordingHint } from './RecordingHint';
import type { createStyles } from './styles';
import { QueueRow } from './Toolbar';
import type { useKeyboardAwarePopover } from './useKeyboardAwarePopover';
import type { VoiceProcessingState } from './voiceProcessingState';

type Styles = ReturnType<typeof createStyles>;
type Popover = ReturnType<typeof useKeyboardAwarePopover>;
interface ChatModeComposerProps {
  styles: Styles;
  colors: ThemeColors;
  attachments: MediaAttachment[];
  removeAttachment: (id: string) => void;
  onImagePress?: (uri: string) => void;
  queueCount: number;
  queuedTexts: string[];
  onClearQueue?: () => void;
  showVoiceStatus: boolean;
  isAwaitingSpeech: boolean;
  voiceInteractionMode: VoiceRecordInteractionMode;
  voiceProcessingState: VoiceProcessingState;
  inputRef: React.RefObject<TextInput | null>;
  message: string;
  setMessage: (message: string) => void;
  placeholder: string;
  disabled?: boolean;
  hasText: boolean;
  iconsAnim: Animated.Value;
  pillIconsExpandedWidth: number;
  attachPicker: Popover;
  handleAttachPress: () => void;
  quickSettings: Popover;
  showSettingsDot: boolean;
  canSend: boolean;
  handleSend: () => void;
  isGenerating?: boolean;
  onStop?: () => void;
  handleStop: () => void;
  isRecording: boolean;
  voiceAvailable: boolean;
  isModelLoading: boolean;
  isTranscribing: boolean;
  partialResult: string;
  error: string | null;
  startRecording: () => void;
  stopRecording: () => void;
  cancelRecording: () => void;
  setVoiceInteractionMode: (mode: VoiceRecordInteractionMode) => void;
  supportsVision: boolean;
  handleVisionPress: () => void;
  handlePickDocument: () => void;
  imageMode: 'auto' | 'force' | 'disabled';
  handleImageModeToggle: () => void;
  imageModelLoaded: boolean;
  supportsThinking: boolean;
  supportsToolCalling: boolean;
  enabledToolCount: number;
  onToolsPress?: () => void;
  mcpToolCount: number;
  onMcpPress?: () => void;
  alertState: AlertState;
  setAlertState: (state: AlertState) => void;
}

/** Chat-mode presentation. State and Shared Speech commands stay in ChatInput. */
export const ChatModeComposer: React.FC<ChatModeComposerProps> = props => {
  const actionButton = props.canSend ? (
    <TouchableOpacity
      testID="send-button"
      style={props.styles.circleButton}
      onPress={props.handleSend}
    >
      <Icon name="send" size={18} color={props.colors.background} />
    </TouchableOpacity>
  ) : props.isGenerating && props.onStop ? (
    <TouchableOpacity
      testID="stop-button"
      style={[props.styles.circleButton, props.styles.circleButtonStop]}
      onPress={props.handleStop}
    >
      <Icon name="square" size={18} color={props.colors.background} />
    </TouchableOpacity>
  ) : (
    <VoiceRecordButton
      isRecording={props.isRecording}
      isAvailable={props.voiceAvailable}
      isModelLoading={props.isModelLoading}
      isTranscribing={props.isTranscribing}
      asSendButton
      partialResult={props.partialResult}
      error={props.error}
      disabled={props.disabled}
      onStartRecording={props.startRecording}
      onStopRecording={props.stopRecording}
      onCancelRecording={props.cancelRecording}
      onInteractionModeChange={props.setVoiceInteractionMode}
    />
  );

  return (
    <View style={props.styles.container}>
      <AttachmentPreview
        attachments={props.attachments}
        onRemove={props.removeAttachment}
        onImagePress={props.onImagePress}
      />
      <QueueRow
        queueCount={props.queueCount}
        queuedTexts={props.queuedTexts}
        onClearQueue={props.onClearQueue}
      />
      <View style={props.styles.mainRow}>
        <View style={props.styles.pill}>
          {props.showVoiceStatus ? (
            <RecordingHint
              awaitingSpeech={props.isAwaitingSpeech}
              interactionMode={props.voiceInteractionMode}
              processing={props.voiceProcessingState}
            />
          ) : (
            <>
              <TextInput
                ref={props.inputRef}
                testID="chat-input"
                style={props.styles.pillInput}
                value={props.message}
                onChangeText={props.setMessage}
                placeholder={props.placeholder}
                placeholderTextColor={props.colors.textMuted}
                multiline
                scrollEnabled
                editable={!props.disabled}
                blurOnSubmit={false}
                returnKeyType="default"
              />
              <ComposerIconsRow
                hasText={props.hasText}
                iconsAnim={props.iconsAnim}
                pillIconsExpandedWidth={props.pillIconsExpandedWidth}
                attachTriggerRef={props.attachPicker.triggerRef}
                onAttachPress={props.handleAttachPress}
                quickSettingsTriggerRef={props.quickSettings.triggerRef}
                onQuickSettingsPress={props.quickSettings.show}
                showSettingsDot={props.showSettingsDot}
                disabled={props.disabled}
              />
            </>
          )}
        </View>
        {actionButton}
      </View>

      {Platform.OS !== 'ios' && (
        <AttachPickerPopover
          visible={props.attachPicker.visible}
          onClose={props.attachPicker.hide}
          anchorY={props.attachPicker.anchor.y}
          anchorX={props.attachPicker.anchor.x}
          supportsVision={props.supportsVision}
          onPhoto={props.handleVisionPress}
          onDocument={props.handlePickDocument}
        />
      )}
      <QuickSettingsPopover
        visible={props.quickSettings.visible}
        onClose={props.quickSettings.hide}
        anchorY={props.quickSettings.anchor.y}
        anchorX={props.quickSettings.anchor.x}
        imageMode={props.imageMode}
        onImageModeToggle={props.handleImageModeToggle}
        imageModelLoaded={props.imageModelLoaded}
        supportsThinking={props.supportsThinking}
        supportsToolCalling={props.supportsToolCalling}
        enabledToolCount={props.enabledToolCount}
        onToolsPress={props.onToolsPress}
        mcpToolCount={props.mcpToolCount}
        onMcpPress={props.onMcpPress}
      />
      <CustomAlert
        visible={props.alertState.visible}
        title={props.alertState.title}
        message={props.alertState.message}
        buttons={props.alertState.buttons}
        onClose={() => props.setAlertState(hideAlert())}
      />
    </View>
  );
};
