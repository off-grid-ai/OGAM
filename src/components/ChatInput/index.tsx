import React, { useState, useRef, useEffect } from 'react';
import { View, TextInput, TouchableOpacity, Animated, StyleSheet, Platform, ActionSheetIOS } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme, useThemedStyles } from '../../theme';
import { ImageModeState, MediaAttachment } from '../../types';
import { VoiceRecordButton } from '../VoiceRecordButton';
import { AttachStep } from 'react-native-spotlight-tour';
import { triggerHaptic } from '../../utils/haptics';
import { CustomAlert, showAlert, hideAlert, AlertState, initialAlertState } from '../CustomAlert';
import { createStyles, PILL_ICON_SIZE, ANIM_DURATION_IN, ANIM_DURATION_OUT } from './styles';
import { QueueRow } from './Toolbar';
import { AttachmentPreview, useAttachments } from './Attachments';
import { useVoiceInput } from './Voice';
import { buildVoiceNoteHandlers } from './voiceNoteSend';
import { QuickSettingsPopover, AttachPickerPopover } from './Popovers';
import { useKeyboardAwarePopover } from './useKeyboardAwarePopover';
import { useAppStore } from '../../stores';
import { useUiModeStore } from '../../stores';
import { getSlot, SLOTS } from '../../bootstrap/slotRegistry';

interface ChatInputProps {
  onSend: (message: string, attachments?: MediaAttachment[], imageMode?: ImageModeState) => void;
  onStop?: () => void;
  disabled?: boolean;
  isGenerating?: boolean;
  placeholder?: string;
  supportsVision?: boolean;
  conversationId?: string | null;
  imageModelLoaded?: boolean;
  onImageModeChange?: (mode: ImageModeState) => void;
  onOpenSettings?: () => void;
  queueCount?: number;
  queuedTexts?: string[];
  onClearQueue?: () => void;
  onToolsPress?: () => void;
  enabledToolCount?: number;
  supportsToolCalling?: boolean;
  mcpToolCount?: number;
  onMcpPress?: () => void;
  supportsThinking?: boolean;
  onRepairVision?: () => void;
  /** Whether the active text model is a remote (server) model. Remote models
   * can't be repaired from the Download Manager, so the "no vision" dialog must
   * not offer that action for them. */
  isRemote?: boolean;
  activeSpotlight?: number | null;
  showSettingsDot?: boolean;
}

const IMAGE_MODE_CYCLE: ImageModeState[] = ['auto', 'force', 'disabled'];

/**
 * Expanded width of the collapsing pill-icons row. '+' and the settings gear
 * are always present; the thinking toggle and the pro mode-toggle are
 * conditional. Sizing to the real count prevents the rightmost icons from
 * being clipped by the row's `overflow: hidden`.
 */
// Attach + quick-settings only. The Chat/Voice mode toggle is no longer in this
// (collapsing) row — it's rendered persistently above the input instead.
const computePillIconsWidth = (): number => PILL_ICON_SIZE * 2;

/**
 * Alert shown when the user attaches an image to a model without vision support.
 * Remote (server) models have no local vision-projector file to repair, so the
 * Download Manager / eye-icon advice is omitted for them — it can't be acted on.
 */
const buildNoVisionAlert = (opts: {
  isRemote: boolean;
  onRepairVision?: () => void;
  dismiss: () => void;
}): AlertState => {
  if (opts.isRemote) {
    return showAlert(
      'Vision Not Supported',
      'This remote model does not support image input.\n\nSelect a vision-capable model on the server, or switch to a local vision model to send images.',
      [{ text: 'OK', onPress: opts.dismiss }],
    );
  }
  return showAlert(
    'Vision Not Supported',
    'The loaded model does not have vision support.\n\nIf this model supports vision, open Download Manager and tap the eye icon next to the model to repair it.',
    [
      { text: 'Cancel', onPress: opts.dismiss },
      ...(opts.onRepairVision
        ? [{ text: 'Go to Download Manager', onPress: () => { opts.dismiss(); opts.onRepairVision!(); } }]
        : [{ text: 'OK' }]),
    ],
  );
};

// ─── Main Component ─────────────────────────────────────────────────────────

export const ChatInput: React.FC<ChatInputProps> = ({
  onSend,
  onStop,
  disabled,
  isGenerating,
  placeholder = 'Message',
  supportsVision = false,
  conversationId,
  imageModelLoaded = false,
  onImageModeChange,
  onOpenSettings: _onOpenSettings,
  queueCount = 0,
  queuedTexts = [],
  onClearQueue,
  onToolsPress,
  enabledToolCount = 0,
  supportsToolCalling = false,
  supportsThinking = false,
  mcpToolCount = 0,
  onMcpPress,
  onRepairVision,
  isRemote = false,
  activeSpotlight = null,
  showSettingsDot = false,
}) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const [message, setMessage] = useState('');
  const [imageMode, setImageMode] = useState<ImageModeState>('auto');
  const [alertState, setAlertState] = useState<AlertState>(initialAlertState);
  const quickSettings = useKeyboardAwarePopover();
  const attachPicker = useKeyboardAwarePopover();
  const voicePicker = useKeyboardAwarePopover();
  const inputRef = useRef<TextInput>(null);
  const attachmentsRef = useRef<MediaAttachment[]>([]);
  const hasText = message.length > 0;
  const iconsAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(iconsAnim, {
      toValue: hasText ? 1 : 0,
      duration: hasText ? ANIM_DURATION_IN : ANIM_DURATION_OUT,
      useNativeDriver: false,
    }).start();
  }, [hasText, iconsAnim]);

  const { attachments, removeAttachment, clearAttachments, handlePickImage, handlePickDocument, addAudioAttachment } = useAttachments(setAlertState);
  attachmentsRef.current = attachments;
  const interfaceMode = useUiModeStore((s) => s.interfaceMode);
  const isAudioMode = interfaceMode === 'audio';

  // All voice-note send/attach decisions live in buildVoiceNoteHandlers (the
  // owning logic), not in this View. The View only supplies dependencies and
  // dispatches; a standalone Chat-mode note and Audio Mode both auto-send through
  // the one shared path so buildOAIMessages handles text/vision/audio models.
  const voiceHandlers = buildVoiceNoteHandlers({
    getComposerText: () => message,
    getPendingAttachments: () => attachmentsRef.current,
    isAudioMode,
    imageMode,
    onSend,
    addAudioAttachment,
    clearAttachments,
    onHaptic: () => triggerHaptic('impactMedium'),
    appendTranscript: (text) => setMessage(prev => {
      const prefix = prev.trim() ? `${prev.trim()} ` : '';
      return prefix + text;
    }),
  });

  const { isRecording, isModelLoading, isTranscribing, partialResult, error, voiceAvailable, startRecording, stopRecording, cancelRecording } = useVoiceInput({
    conversationId,
    onTranscript: voiceHandlers.onTranscript,
    onAudioAttachment: voiceHandlers.onAudioAttachment,
    onAutoSend: voiceHandlers.onAutoSend,
  });

  const { settings: appSettings, updateSettings: updateAppSettings } = useAppStore();
  const thinkingEnabled = appSettings.thinkingEnabled;

  const handleThinkingToggle = () => {
    triggerHaptic('impactLight');
    updateAppSettings({ thinkingEnabled: !thinkingEnabled });
  };

  const canSend = (message.trim().length > 0 || attachments.length > 0) && !disabled;

  const handleSend = () => {
    if (!canSend) return;
    triggerHaptic('impactMedium');
    onSend(message.trim(), attachments.length > 0 ? attachments : undefined, imageMode);
    setMessage('');
    clearAttachments();
    inputRef.current?.focus();
    if (imageMode === 'force') {
      setImageMode('auto');
      onImageModeChange?.('auto');
    }
  };

  const handleImageModeToggle = () => {
    // Gate on whether an image model is DOWNLOADED, not whether it was selected
    // on the Home screen. If one is downloaded but not yet selected, select it
    // here (it loads lazily on the next send). Only warn when none exist.
    if (!imageModelLoaded) {
      const { downloadedImageModels, setActiveImageModelId } = useAppStore.getState();
      if (downloadedImageModels.length === 0) {
        setAlertState(showAlert('No Image Model', 'Download an image generation model from the Models screen to enable this feature.', [{ text: 'OK' }]));
        quickSettings.hide();
        return;
      }
      setActiveImageModelId(downloadedImageModels[0].id);
    }
    const newMode = IMAGE_MODE_CYCLE[(IMAGE_MODE_CYCLE.indexOf(imageMode) + 1) % IMAGE_MODE_CYCLE.length];
    setImageMode(newMode);
    onImageModeChange?.(newMode);
  };

  const handleVisionPress = () => {
    if (!supportsVision) {
      setAlertState(buildNoVisionAlert({ isRemote, onRepairVision, dismiss: () => setAlertState(hideAlert()) }));
      return;
    }
    handlePickImage();
  };

  const handleStop = () => {
    if (onStop && isGenerating) {
      triggerHaptic('impactLight');
      onStop();
    }
  };

  const handleQuickSettingsPress = () => quickSettings.show();

  const handleAttachPress = () => {
    if (Platform.OS === 'ios') {
      const options = supportsVision
        ? ['Photo', 'Document', 'Cancel']
        : ['Document', 'Cancel'];
      ActionSheetIOS.showActionSheetWithOptions(
        { options, cancelButtonIndex: options.length - 1 },
        (index) => {
          if (supportsVision) {
            if (index === 0) handleVisionPress();
            else if (index === 1) handlePickDocument();
          } else {
            if (index === 0) handlePickDocument();
          }
        },
      );
    } else {
      attachPicker.show();
    }
  };

  // ─── Audio mode: pro renders the mic-only layout via a slot ─────────────────
  // Free builds have no audio slot, so interfaceMode never becomes 'audio' and
  // this branch is skipped entirely.
  const AudioInput = getSlot(SLOTS.chatInputAudioMode);
  if (isAudioMode && AudioInput) {
    return (
      <AudioInput
        styles={styles}
        disabled={disabled}
        onSend={onSend}
        isGenerating={isGenerating}
        imageMode={imageMode}
        imageModelLoaded={imageModelLoaded}
        supportsThinking={supportsThinking}
        supportsToolCalling={supportsToolCalling}
        enabledToolCount={enabledToolCount}
        thinkingEnabled={thinkingEnabled}
        attachments={attachments}
        onRemoveAttachment={removeAttachment}
        onClearAttachments={clearAttachments}
        queueCount={queueCount}
        queuedTexts={queuedTexts}
        onClearQueue={onClearQueue}
        isRecording={isRecording}
        voiceAvailable={voiceAvailable}
        isModelLoading={isModelLoading}
        isTranscribing={isTranscribing}
        partialResult={partialResult}
        error={error}
        onStartRecording={startRecording}
        onStopRecording={stopRecording}
        onCancelRecording={cancelRecording}
        onStop={onStop}
        onImageModeToggle={handleImageModeToggle}
        onThinkingToggle={handleThinkingToggle}
        onToolsPress={onToolsPress}
        onMcpPress={onMcpPress}
        mcpToolCount={mcpToolCount}
        onVisionPress={handleVisionPress}
        onPickDocument={handlePickDocument}
        attachPicker={attachPicker}
        voicePicker={voicePicker}
        quickSettings={quickSettings}
        supportsVision={supportsVision}
        alertState={alertState}
        setAlertState={setAlertState}
      />
    );
  }

  // Pro-only inline Chat↔Audio toggle (empty slot in free builds → null).
  const pillIconsExpandedWidth = computePillIconsWidth();

  const actionButton = canSend ? (
    <TouchableOpacity
      testID="send-button"
      style={styles.circleButton}
      onPress={handleSend}
    >
      <Icon name="send" size={18} color={colors.background} />
    </TouchableOpacity>
  ) : isGenerating && onStop ? (
    <TouchableOpacity
      testID="stop-button"
      style={[styles.circleButton, styles.circleButtonStop]}
      onPress={handleStop}
    >
      <Icon name="square" size={18} color={colors.background} />
    </TouchableOpacity>
  ) : (
    <VoiceRecordButton
      isRecording={isRecording}
      isAvailable={voiceAvailable}
      isModelLoading={isModelLoading}
      isTranscribing={isTranscribing}
      asSendButton
      partialResult={partialResult}
      error={error}
      disabled={disabled}
      onStartRecording={startRecording}
      onStopRecording={stopRecording}
      onCancelRecording={cancelRecording}
    />
  );

  return (
    <View style={styles.container}>
      <AttachmentPreview attachments={attachments} onRemove={removeAttachment} />
      <QueueRow
        queueCount={queueCount}
        queuedTexts={queuedTexts}
        onClearQueue={onClearQueue}
      />
      <View style={styles.mainRow}>
        <View style={styles.pill}>
          <TextInput
            ref={inputRef}
            testID="chat-input"
            style={styles.pillInput}
            value={message}
            onChangeText={setMessage}
            placeholder={placeholder}
            placeholderTextColor={colors.textMuted}
            multiline
            scrollEnabled
            editable={!disabled}
            blurOnSubmit={false}
            returnKeyType="default"
          />
          <Animated.View
            pointerEvents={hasText ? 'none' : 'auto'}
            style={[styles.pillIcons, {
              width: iconsAnim.interpolate({ inputRange: [0, 1], outputRange: [pillIconsExpandedWidth, 0] }),
              opacity: iconsAnim.interpolate({ inputRange: [0, 0.4], outputRange: [1, 0], extrapolate: 'clamp' }),
              overflow: 'hidden' as const,
            }]}
          >
            <TouchableOpacity
              ref={attachPicker.triggerRef}
              testID="attach-button"
              style={styles.pillIconButton}
              onPress={handleAttachPress}
              disabled={disabled}
              hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
            >
              <Icon name="plus" size={20} color={disabled ? colors.textMuted : colors.textSecondary} />
            </TouchableOpacity>
            <TouchableOpacity
              ref={quickSettings.triggerRef}
              testID="quick-settings-button"
              style={styles.pillIconButton}
              onPress={handleQuickSettingsPress}
              disabled={disabled}
              hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
            >
              <View style={styles.iconWrapper}>
                <Icon name="settings" size={18} color={disabled ? colors.textMuted : colors.textSecondary} />
                {showSettingsDot && <View style={styles.toolWarningDot} />}
              </View>
            </TouchableOpacity>
          </Animated.View>
        </View>

        {activeSpotlight === 12 ? (
          <AttachStep index={12} style={spotlightStyles.centered}>{actionButton}</AttachStep>
        ) : actionButton}
      </View>

      {Platform.OS !== 'ios' && (
        <AttachPickerPopover
          visible={attachPicker.visible}
          onClose={attachPicker.hide}
          anchorY={attachPicker.anchor.y}
          anchorX={attachPicker.anchor.x}
          supportsVision={supportsVision}
          onPhoto={handleVisionPress}
          onDocument={handlePickDocument}
        />
      )}

      <QuickSettingsPopover
        visible={quickSettings.visible}
        onClose={quickSettings.hide}
        anchorY={quickSettings.anchor.y}
        anchorX={quickSettings.anchor.x}
        imageMode={imageMode}
        onImageModeToggle={handleImageModeToggle}
        imageModelLoaded={imageModelLoaded}
        supportsThinking={supportsThinking}
        supportsToolCalling={supportsToolCalling}
        enabledToolCount={enabledToolCount}
        onToolsPress={onToolsPress}
        mcpToolCount={mcpToolCount}
        onMcpPress={onMcpPress}
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

const spotlightStyles = StyleSheet.create({
  centered: { alignSelf: 'center' },
});
