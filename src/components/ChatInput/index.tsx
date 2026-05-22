import React, { useState, useRef, useEffect } from 'react';
import { View, TextInput, TouchableOpacity, Animated, StyleSheet, Platform, ActionSheetIOS } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme, useThemedStyles } from '../../theme';
import { ImageModeState, MediaAttachment } from '../../types';
import { VoiceRecordButton } from '../VoiceRecordButton';
import { AttachStep } from 'react-native-spotlight-tour';
import { triggerHaptic } from '../../utils/haptics';
import { CustomAlert, showAlert, hideAlert, AlertState, initialAlertState } from '../CustomAlert';
import { createStyles, PILL_ICONS_WIDTH, ANIM_DURATION_IN, ANIM_DURATION_OUT } from './styles';
import { ContextRing } from '../ContextRing';
import { QueueRow } from './Toolbar';
import { AttachmentPreview, useAttachments } from './Attachments';
import { useVoiceInput } from './Voice';
import { QuickSettingsPopover, AttachPickerPopover } from './Popovers';
import { useKeyboardAwarePopover } from './useKeyboardAwarePopover';

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
  supportsThinking?: boolean;
  onRepairVision?: () => void;
  /** When set, mounts a single AttachStep for that index. Only one at a time to avoid waypoint dots. */
  activeSpotlight?: number | null;
  /** LiteRT context fill level. Renders a small ring indicator inside the pill when non-zero. */
  contextUsage?: { used: number; max: number };
}

const IMAGE_MODE_CYCLE: ImageModeState[] = ['auto', 'force', 'disabled'];

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
  onRepairVision,
  activeSpotlight = null,
  contextUsage,
}) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const [message, setMessage] = useState('');
  const [imageMode, setImageMode] = useState<ImageModeState>('auto');
  const [alertState, setAlertState] = useState<AlertState>(initialAlertState);
  const quickSettings = useKeyboardAwarePopover();
  const attachPicker = useKeyboardAwarePopover();
  const inputRef = useRef<TextInput>(null);
  const hasText = message.length > 0;
  const iconsAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(iconsAnim, {
      toValue: hasText ? 1 : 0,
      duration: hasText ? ANIM_DURATION_IN : ANIM_DURATION_OUT,
      useNativeDriver: false,
    }).start();
  }, [hasText, iconsAnim]);

  const { attachments, removeAttachment, clearAttachments, handlePickImage, handlePickDocument } = useAttachments(setAlertState);

  const { isRecording, isModelLoading, isTranscribing, partialResult, error, voiceAvailable, startRecording, stopRecording, clearResult } = useVoiceInput({
    conversationId,
    onTranscript: (text) => {
      setMessage(prev => {
        const prefix = prev.trim() ? `${prev.trim()} ` : '';
        return prefix + text;
      });
    },
  });

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
    if (!imageModelLoaded) { setAlertState(showAlert('No Image Model', 'Download an image generation model from the Models screen to enable this feature.', [{ text: 'OK' }])); quickSettings.hide(); return; }
    const newMode = IMAGE_MODE_CYCLE[(IMAGE_MODE_CYCLE.indexOf(imageMode) + 1) % IMAGE_MODE_CYCLE.length];
    setImageMode(newMode);
    onImageModeChange?.(newMode);
  };

  const handleVisionPress = () => {
    if (!supportsVision) {
      setAlertState(showAlert(
        'Vision Not Supported',
        'The loaded model does not have vision support.\n\nIf this model supports vision, open Download Manager and tap the eye icon next to the model to repair it.',
        [
          { text: 'Cancel', onPress: () => setAlertState(hideAlert()) },
          ...(onRepairVision ? [{ text: 'Go to Download Manager', onPress: () => { setAlertState(hideAlert()); onRepairVision(); } }] : [{ text: 'OK' }]),
        ],
      ));
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
      onCancelRecording={() => { stopRecording(); clearResult(); }}
    />
  );

  const content = (
    <View style={styles.container}>
      <AttachmentPreview attachments={attachments} onRemove={removeAttachment} />
      <QueueRow
        queueCount={queueCount}
        queuedTexts={queuedTexts}
        onClearQueue={onClearQueue}
      />
      <View style={styles.mainRow}>
        {/* Pill: text input + right icons */}
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
          {contextUsage && contextUsage.used > 0 && contextUsage.max > 0 && (
            <View style={styles.contextRingWrapper}>
              <ContextRing used={contextUsage.used} max={contextUsage.max} />
            </View>
          )}
          {/* Icons collapse when user starts typing, reappear when input is empty */}
          <Animated.View
            pointerEvents={hasText ? 'none' : 'auto'}
            style={[styles.pillIcons, {
              width: iconsAnim.interpolate({ inputRange: [0, 1], outputRange: [PILL_ICONS_WIDTH, 0] }),
              opacity: iconsAnim.interpolate({ inputRange: [0, 0.4], outputRange: [1, 0], extrapolate: 'clamp' }),
              overflow: 'hidden' as const,
            }]}
          >
            {/* Attach button — opens picker for image or document */}
            <TouchableOpacity
              ref={attachPicker.triggerRef}
              testID="attach-button"
              style={styles.pillIconButton}
              onPress={handleAttachPress}
              disabled={disabled}
              hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
            >
              <Icon
                name="plus"
                size={20}
                color={disabled ? colors.textMuted : colors.textSecondary}
              />
            </TouchableOpacity>

            {/* Quick settings button */}
            <TouchableOpacity
              ref={quickSettings.triggerRef}
              testID="quick-settings-button"
              style={styles.pillIconButton}
              onPress={handleQuickSettingsPress}
              disabled={disabled}
              hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
            >
              <Icon name="settings" size={18} color={disabled ? colors.textMuted : colors.textSecondary} />
            </TouchableOpacity>

          </Animated.View>
        </View>

        {/* Circular action button — conditionally wrapped with AttachStep */}
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

  return content;
};

const spotlightStyles = StyleSheet.create({
  centered: { alignSelf: 'center' },
});

