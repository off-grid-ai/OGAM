import React, { useState, useRef, useEffect } from 'react';
import { TextInput, Animated, Platform, ActionSheetIOS } from 'react-native';
import { modelsFailureMessage } from '@offgrid/application';
import { useTheme, useThemedStyles } from '../../theme';
import { ImageModeState, MediaAttachment } from '../../types';
import type { VoiceRecordInteractionMode } from '../VoiceRecordButton';
import { triggerHaptic } from '../../utils/haptics';
import logger from '../../utils/logger';
import {
  showAlert,
  hideAlert,
  AlertState,
  initialAlertState,
} from '../CustomAlert';
import {
  createStyles,
  PILL_ICON_SIZE,
  ANIM_DURATION_IN,
  ANIM_DURATION_OUT,
} from './styles';
import { useAttachments } from './Attachments';
import { useVoiceInput } from './Voice';
import { buildVoiceNoteHandlers } from './voiceNoteSend';
import { useKeyboardAwarePopover } from './useKeyboardAwarePopover';
import {
  useModelsProjection,
  useSpeechProjection,
} from '../../hooks/useApplicationProjection';
import { useAppStore } from '../../stores';
import { getSlot, SLOTS } from '../../bootstrap/slotRegistry';
import { selectMobileModel } from '../../services/modelServices';
import { applicationFacade } from '../../services/applicationFacade';
import { ChatModeComposer } from './ChatModeComposer';
import { deriveVoiceProcessingState } from './voiceProcessingState';

interface ChatInputProps {
  onSend: (
    message: string,
    attachments?: MediaAttachment[],
    imageMode?: ImageModeState,
  ) => void;
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
  /** True when the active model IS a vision model but its projector isn't installed (repairable). */
  visionNeedsRepair?: boolean;
  showSettingsDot?: boolean;
  /** Opens the shared fullscreen image viewer when a pending (pre-send)
   * attachment thumbnail is tapped — the same handler in-message images use. */
  onImagePress?: (uri: string) => void;
}

const IMAGE_MODE_CYCLE: ImageModeState[] = ['auto', 'force', 'disabled'];

async function saveThinkingSetting(
  enabled: boolean,
): Promise<AlertState | null> {
  const outcome = await applicationFacade().models.settings.save({
    origin: 'local',
    patch: { thinkingEnabled: enabled },
  });
  const failure = outcome.ok ? outcome.value.syncFailure : outcome.failure;
  return failure
    ? showAlert(
        outcome.ok ? 'Saved on this device' : 'Error',
        modelsFailureMessage(failure),
      )
    : null;
}

/**
 * Expanded width of the collapsing pill-icons row. '+' and the settings gear
 * are always present; the thinking toggle and the pro mode-toggle are
 * conditional. Sizing to the real count prevents the rightmost icons from
 * being clipped by the row's `overflow: hidden`.
 */
// Attach + quick-settings only. The Chat/Voice mode toggle is no longer in this
// (collapsing) row — it's rendered persistently above the input instead.
const computePillIconsWidth = (): number => PILL_ICON_SIZE * 2;

function selectFirstDownloadedImageModel(): boolean {
  const model = useAppStore.getState().downloadedImageModels[0];
  if (!model) return false;
  selectMobileModel({
    source: 'local',
    hostId: model.backend ?? 'image-runtime',
    modality: 'image',
    modelId: model.id,
  }).catch(() => undefined);
  return true;
}

/**
 * Alert shown when the user attaches an image to a model without vision support.
 * Remote (server) models have no local vision-projector file to repair, so the
 * Download Manager / eye-icon advice is omitted for them — it can't be acted on.
 */
const buildNoVisionAlert = (opts: {
  isRemote: boolean;
  /** The active model IS a vision model but its projector (mmproj) isn't installed — repairable. */
  needsRepair?: boolean;
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
  // Distinguish the two states the system can tell apart: a vision model MISSING its projector (repairable)
  // vs a model that simply has no vision. Only offer repair when it can actually be repaired.
  if (opts.needsRepair) {
    return showAlert(
      'Vision File Missing',
      'This model supports vision, but its vision file has not been installed.\n\nOpen Download Manager and tap the wrench next to the model to download it.',
      [
        { text: 'Cancel', onPress: opts.dismiss },
        ...(opts.onRepairVision
          ? [
              {
                text: 'Go to Download Manager',
                onPress: () => {
                  opts.dismiss();
                  opts.onRepairVision!();
                },
              },
            ]
          : [{ text: 'OK' }]),
      ],
    );
  }
  return showAlert(
    'Vision Not Supported',
    'This model does not support image input.\n\nSwitch to a vision-capable model to send images.',
    [{ text: 'OK', onPress: opts.dismiss }],
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
  visionNeedsRepair = false,
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
  showSettingsDot = false,
  onImagePress,
}) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const [message, setMessage] = useState('');
  const [imageMode, setImageMode] = useState<ImageModeState>('auto');
  const [voiceInteractionMode, setVoiceInteractionMode] =
    useState<VoiceRecordInteractionMode>('idle');
  const [alertState, setAlertState] = useState<AlertState>(initialAlertState);
  const quickSettings = useKeyboardAwarePopover();
  const attachPicker = useKeyboardAwarePopover();
  const voicePicker = useKeyboardAwarePopover();
  const inputRef = useRef<TextInput>(null);
  const attachmentsRef = useRef<MediaAttachment[]>([]);
  const isSavingThinkingRef = useRef(false);
  const hasText = message.length > 0;
  const iconsAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(iconsAnim, {
      toValue: hasText ? 1 : 0,
      duration: hasText ? ANIM_DURATION_IN : ANIM_DURATION_OUT,
      useNativeDriver: false,
    }).start();
  }, [hasText, iconsAnim]);

  const {
    attachments,
    removeAttachment,
    clearAttachments,
    handlePickImage,
    handlePickDocument,
    addAudioAttachment,
  } = useAttachments(setAlertState);
  attachmentsRef.current = attachments;
  const isAudioMode = useSpeechProjection().preferences.voiceMode;
  const interfaceMode = isAudioMode ? 'audio' : 'chat';

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
    appendTranscript: text =>
      setMessage(prev => {
        const prefix = prev.trim() ? `${prev.trim()} ` : '';
        return prefix + text;
      }),
  });

  const {
    isRecording,
    isModelLoading,
    isStartingRecording,
    isTranscribing,
    partialResult,
    error,
    voiceAvailable,
    isAwaitingSpeech,
    startRecording,
    stopRecording,
    cancelRecording,
  } = useVoiceInput({
    conversationId,
    interfaceMode,
    onTranscript: voiceHandlers.onTranscript,
    onAudioAttachment: voiceHandlers.onAudioAttachment,
    onAutoSend: voiceHandlers.onAutoSend,
  });
  const voiceProcessingState = deriveVoiceProcessingState({
    isRecording,
    isModelLoading,
    isStartingRecording,
    isTranscribing,
  });
  // Model loading is shared across composers. It must not replace an idle composer that did not
  // start the voice action. The local interaction and recorder states own this surface.
  const showVoiceStatus =
    isRecording ||
    voiceInteractionMode !== 'idle' ||
    isStartingRecording ||
    isTranscribing;

  // Narrow selectors: the composer must not re-render when an unrelated app-store field
  // changes (a settings edit, a generated image, a download counter) while a transcript is
  // on screen.
  const thinkingEnabled = useModelsProjection().settings.thinkingEnabled;
  const handleThinkingToggle = async (): Promise<void> => {
    if (isSavingThinkingRef.current) return;
    isSavingThinkingRef.current = true;
    triggerHaptic('impactLight');
    try {
      const alert = await saveThinkingSetting(!thinkingEnabled);
      if (alert) setAlertState(alert);
    } finally {
      isSavingThinkingRef.current = false;
    }
  };
  const canSend =
    (message.trim().length > 0 || attachments.length > 0) && !disabled;

  const handleSend = () => {
    logger.log(
      `[COMPOSER-SM] handleSend canSend=${canSend} disabled=${disabled} hasText=${
        message.trim().length > 0
      } attachments=${attachments.length} imageMode=${imageMode}`,
    );
    if (!canSend) return;
    triggerHaptic('impactMedium');
    onSend(
      message.trim(),
      attachments.length > 0 ? attachments : undefined,
      imageMode,
    );
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
    if (!imageModelLoaded && !selectFirstDownloadedImageModel()) {
      setAlertState(
        showAlert(
          'No Image Model',
          'Download an image generation model from the Models screen to enable this feature.',
          [{ text: 'OK' }],
        ),
      );
      quickSettings.hide();
      return;
    }
    const newMode =
      IMAGE_MODE_CYCLE[
        (IMAGE_MODE_CYCLE.indexOf(imageMode) + 1) % IMAGE_MODE_CYCLE.length
      ];
    setImageMode(newMode);
    onImageModeChange?.(newMode);
  };

  const handleVisionPress = () => {
    if (!supportsVision) {
      setAlertState(
        buildNoVisionAlert({
          isRemote,
          needsRepair: visionNeedsRepair,
          onRepairVision,
          dismiss: () => setAlertState(hideAlert()),
        }),
      );
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

  const handleAttachPress = () => {
    logger.log(
      `[COMPOSER-SM] attach pressed platform=${Platform.OS} supportsVision=${supportsVision}`,
    );
    if (Platform.OS === 'ios') {
      const options = supportsVision
        ? ['Photo', 'Document', 'Cancel']
        : ['Document', 'Cancel'];
      ActionSheetIOS.showActionSheetWithOptions(
        { options, cancelButtonIndex: options.length - 1 },
        index => {
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
  // Free builds have no audio slot, so this branch remains unavailable even if a migrated
  // preference requests Voice mode.
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
        onAttachPress={handleAttachPress}
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

  return (
    <ChatModeComposer
      styles={styles}
      colors={colors}
      attachments={attachments}
      removeAttachment={removeAttachment}
      onImagePress={onImagePress}
      queueCount={queueCount}
      queuedTexts={queuedTexts}
      onClearQueue={onClearQueue}
      showVoiceStatus={showVoiceStatus}
      isAwaitingSpeech={isAwaitingSpeech}
      voiceInteractionMode={voiceInteractionMode}
      voiceProcessingState={voiceProcessingState}
      inputRef={inputRef}
      message={message}
      setMessage={setMessage}
      placeholder={placeholder}
      disabled={disabled}
      hasText={hasText}
      iconsAnim={iconsAnim}
      pillIconsExpandedWidth={pillIconsExpandedWidth}
      attachPicker={attachPicker}
      handleAttachPress={handleAttachPress}
      quickSettings={quickSettings}
      showSettingsDot={showSettingsDot}
      canSend={canSend}
      handleSend={handleSend}
      isGenerating={isGenerating}
      onStop={onStop}
      handleStop={handleStop}
      isRecording={isRecording}
      voiceAvailable={voiceAvailable}
      isModelLoading={isModelLoading}
      isTranscribing={isTranscribing}
      partialResult={partialResult}
      error={error}
      startRecording={startRecording}
      stopRecording={stopRecording}
      cancelRecording={cancelRecording}
      setVoiceInteractionMode={setVoiceInteractionMode}
      supportsVision={supportsVision}
      handleVisionPress={handleVisionPress}
      handlePickDocument={handlePickDocument}
      imageMode={imageMode}
      handleImageModeToggle={handleImageModeToggle}
      imageModelLoaded={imageModelLoaded}
      supportsThinking={supportsThinking}
      supportsToolCalling={supportsToolCalling}
      enabledToolCount={enabledToolCount}
      onToolsPress={onToolsPress}
      mcpToolCount={mcpToolCount}
      onMcpPress={onMcpPress}
      alertState={alertState}
      setAlertState={setAlertState}
    />
  );
};
