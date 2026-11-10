import React, { useState, useRef, useEffect } from 'react';
import { useStopTapGuard } from './useStopTapGuard';
import { View, Text, TextInput, Animated, Platform, ActionSheetIOS } from 'react-native';
import { TouchableOpacity } from '../Touchable';
import Icon from 'react-native-vector-icons/Feather';
import { GodIcon } from '../GodIcon';
import { useTheme, useThemedStyles } from '../../theme';
import { ImageModeState, MediaAttachment } from '../../types';
import { VoiceRecordButton, type VoiceRecordInteractionMode } from '../VoiceRecordButton';
import { RecordingHint } from './RecordingHint';
import { ComposerIconsRow } from './ComposerIconsRow';
import { triggerHaptic } from '../../utils/haptics';
import logger from '../../utils/logger';
import { CustomAlert, showAlert, hideAlert, AlertState, initialAlertState } from '../CustomAlert';
import { createStyles, PILL_ICON_SIZE, ANIM_DURATION_IN, ANIM_DURATION_OUT } from './styles';
import { QueueRow, type QueueActions, type QueueView } from './Toolbar';
import { AttachmentPreview, useAttachments } from './Attachments';
import { useVoiceInput } from './Voice';
import { buildVoiceNoteHandlers } from './voiceNoteSend';
import { QuickSettingsPopover, AttachPickerPopover, type AttachChoice } from './Popovers';
import { useKeyboardAwarePopover } from './useKeyboardAwarePopover';
import { useAppStore } from '../../stores';
import { useRemoteServerStore } from '../../stores/remoteServerStore';
import { remoteServerCapabilities } from '../../types/remoteServer';
import { useUiModeStore } from '../../stores';
import { getSlot, SLOTS } from '../../bootstrap/slotRegistry';
import { callHook, HOOKS } from '../../bootstrap/hookRegistry';
import { videoSeam } from '../../bootstrap/videoSeam';
import { hardwareService } from '../../services/hardware';
import { bestInstalledVideoModel, videoPacksForPhone } from '../../services/phoneVideoPacks';
import { AppSheet } from '../AppSheet';
import { Button } from '../Button';
import { StyleRow } from '../MediaStyles/StyleRow';
import { NEW_CHAT_STYLE_KEY, useMediaStyleStore } from '../../stores/mediaStyleStore';

type AssistantAvailability = 'no-pro' | 'needs-sync' | 'unavailable' | 'ready';

interface ChatInputProps {
  /** `sendNow`: while a reply runs, stop it and send this message at once instead of queueing it. */
  onSend: (message: string, attachments?: MediaAttachment[], imageMode?: ImageModeState, assistantEnabled?: boolean, sendNow?: boolean) => void;
  onStop?: () => void;
  disabled?: boolean;
  isGenerating?: boolean;
  placeholder?: string;
  supportsVision?: boolean;
  conversationId?: string | null;
  /** Space under the bar for the home indicator or nav bar; the composer's box runs down through it. */
  bottomInset?: number;
  imageModelLoaded?: boolean;
  onImageModeChange?: (mode: ImageModeState) => void;
  /** Video is Pro. Called instead of turning video on when Pro is not active. */
  onVideoUpgrade?: () => void;
  /** Opens the screen where a computer is paired. Offered when no video model is reachable. */
  onFindComputer?: () => void;
  /** Opens the video models to download one. Offered instead when this phone can run one. */
  onGetVideoModel?: () => void;
  onOpenSettings?: () => void;
  queue?: QueueView;
  queueActions?: QueueActions;
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
  assistantAvailability?: AssistantAvailability;
  onAssistantUpgrade?: () => void;
  onAssistantSetupSync?: () => void;
  onAssistantEnableTools?: () => boolean;
  assistantSelected?: boolean;
  onAssistantSelectedChange?: (selected: boolean) => void;
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

type VoiceProcessingState = 'loading' | 'starting' | 'transcribing' | undefined;

/** Project the recorder lifecycle into one display state. */
const deriveVoiceProcessingState = (input: {
  isRecording: boolean;
  isModelLoading: boolean;
  isStartingRecording: boolean;
  isTranscribing: boolean;
}): VoiceProcessingState => {
  if (input.isRecording) return undefined;
  if (input.isModelLoading) return 'loading';
  if (input.isStartingRecording) return 'starting';
  if (input.isTranscribing) return 'transcribing';
  return undefined;
};

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
      'This model supports vision, but its vision file has not been installed.\n\nOpen Downloads and tap the wrench next to the model to download it.',
      [
        { text: 'Cancel', onPress: opts.dismiss },
        ...(opts.onRepairVision
          ? [
              {
                text: 'Open Downloads',
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
  bottomInset = 0,
  imageModelLoaded = false,
  onImageModeChange,
  onVideoUpgrade,
  onFindComputer,
  onGetVideoModel,
  onOpenSettings: _onOpenSettings,
  queue,
  queueActions,
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
  assistantAvailability = 'no-pro',
  onAssistantUpgrade,
  onAssistantSetupSync,
  onAssistantEnableTools,
  assistantSelected,
  onAssistantSelectedChange,
}) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const [message, setMessage] = useState('');
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  // Focus draws light to the field (brand: its edge glows while you are inside it).
  const [isFocused, setIsFocused] = useState(false);
  const [localAssistantEnabled, setLocalAssistantEnabled] = useState(false);
  const assistantEnabled = assistantSelected ?? localAssistantEnabled;
  const setAssistantEnabled = (selected: boolean) => {
    if (onAssistantSelectedChange) onAssistantSelectedChange(selected);
    else setLocalAssistantEnabled(selected);
  };
  const [assistantTransitioning, setAssistantTransitioning] = useState(false);
  const [assistantGateOpen, setAssistantGateOpen] = useState(false);
  const [imageMode, setImageMode] = useState<ImageModeState>('auto');
  // Image or video mode shows the styles for that kind; the chat remembers the one it chose.
  const styleKind = imageMode === 'force' ? 'image' : imageMode === 'video' ? 'video' : null;
  const styleChatKey = conversationId ?? NEW_CHAT_STYLE_KEY;
  const chosenStyle = useMediaStyleStore(state =>
    styleKind ? state.byChat[styleChatKey]?.[styleKind] : undefined,
  );
  const setChatStyle = useMediaStyleStore(state => state.setStyle);
  // A pick folds the row to the line that names it; turning the mode off and on, or Clear, opens it again.
  const [stylesShown, setStylesShown] = useState(true);
  useEffect(() => {
    if (styleKind) setStylesShown(true);
  }, [styleKind]);
  const pickStyle = (kind: 'image' | 'video', styleId: string | null) => {
    setChatStyle(styleChatKey, kind, styleId);
    setStylesShown(!styleId);
  };
  const [voiceInteractionMode, setVoiceInteractionMode] = useState<VoiceRecordInteractionMode>('idle');
  const [alertState, setAlertState] = useState<AlertState>(initialAlertState);
  const quickSettings = useKeyboardAwarePopover();
  const attachPicker = useKeyboardAwarePopover();
  const voicePicker = useKeyboardAwarePopover();
  const inputRef = useRef<TextInput>(null);
  const assistantTransitionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  useEffect(() => () => {
    if (assistantTransitionTimer.current) {
      clearTimeout(assistantTransitionTimer.current);
    }
  }, []);

  const { attachments, removeAttachment, clearAttachments, handlePickImage, pickFromCamera, pickFromLibrary, handlePickDocument, addAudioAttachment } = useAttachments(setAlertState);
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
    getAssistantEnabled: () => assistantEnabled,
    onAssistantConsumed: () => setAssistantEnabled(false),
    addAudioAttachment,
    clearAttachments,
    onHaptic: () => triggerHaptic('impactMedium'),
    appendTranscript: heard => {
      const text = callHook<string>(HOOKS.dictationFormat, heard, 'plain') ?? heard;
      setMessage(prev => {
        const prefix = prev.trim() ? `${prev.trim()} ` : '';
        return prefix + text;
      });
    },
  });

  const {
    isRecording,
    isModelLoading,
    isStartingRecording,
    isTranscribing,
    partialResult,
    error,
    transcriptionNotice,
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
  });  // The mic takes Stop's place when a reply ends; a late Stop tap must not start recording.
  const { start: startRecordingAfterStop, resting: micResting } = useStopTapGuard(isGenerating, startRecording);

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

  const thinkingEnabled = useAppStore(state => state.settings.thinkingEnabled);
  const updateAppSettings = useAppStore(state => state.updateSettings);

  const handleThinkingToggle = () => {
    triggerHaptic('impactLight');
    updateAppSettings({ thinkingEnabled: !thinkingEnabled });
  };

  const canSend = (message.trim().length > 0 || attachments.length > 0) && !disabled;

  /** `sendNow` (long-press while a reply runs): the reply stops and this message goes at once. */
  const handleSend = (sendNow = false) => {
    logger.log(`[COMPOSER-SM] handleSend canSend=${canSend} disabled=${disabled} hasText=${message.trim().length > 0} attachments=${attachments.length} imageMode=${imageMode} sendNow=${sendNow}`);
    if (!canSend) return;
    triggerHaptic('impactMedium');
    const outgoingAttachments = attachments.length > 0 ? attachments : undefined;
    if (sendNow) {
      onSend(message.trim(), outgoingAttachments, imageMode, assistantEnabled || undefined, true);
    } else if (assistantEnabled) {
      onSend(message.trim(), outgoingAttachments, imageMode, true);
    } else {
      onSend(message.trim(), outgoingAttachments, imageMode);
    }
    if (assistantTransitionTimer.current) {
      clearTimeout(assistantTransitionTimer.current);
      assistantTransitionTimer.current = null;
    }
    setAssistantTransitioning(false);
    setAssistantEnabled(false);
    setMessage('');
    clearAttachments();
    inputRef.current?.focus();
    if (imageMode === 'force' || imageMode === 'video') {
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

  /** No video model and no computer: download one when this phone can run it, else find the computer. */
  const offerVideoStart = async () => {
    await hardwareService.getDeviceInfo();
    const phoneCanMakeVideo = videoPacksForPhone(hardwareService.getTotalMemoryGB()).length > 0;
    if (phoneCanMakeVideo && onGetVideoModel) {
      setAlertState(
        showAlert('Make videos on this phone', 'Download a video model, and videos are made right here.', [
          { text: 'Not now' },
          {
            text: 'Get a video model',
            onPress: () => {
              setAlertState(hideAlert());
              onGetVideoModel();
            },
          },
        ]),
      );
      return;
    }
    setAlertState(
      showAlert(
        'Videos are made on your computer',
        'Find your computer running Off Grid AI Desktop, and videos are made there.',
        onFindComputer
          ? [
              { text: 'Not now' },
              {
                text: 'Find my computer',
                onPress: () => {
                  setAlertState(hideAlert());
                  onFindComputer();
                },
              },
            ]
          : [{ text: 'OK' }],
      ),
    );
  };

  const handleVideoModeToggle = () => {
    if (imageMode !== 'video' && !videoSeam.available()) {
      quickSettings.hide();
      onVideoUpgrade?.();
      return;
    }
    if (imageMode !== 'video') {
      const { activeVideoModelId, downloadedVideoModels, setActiveVideoModelId } =
        useAppStore.getState();
      const remoteVideoId =
        useRemoteServerStore.getState().activeRemoteMediaServerIds.video;
      const localVideoSelected = downloadedVideoModels.some(
        model => model.id === activeVideoModelId,
      );
      if (!remoteVideoId && !localVideoSelected) {
        if (downloadedVideoModels.length === 0) {
          const remote = useRemoteServerStore.getState();
          const computer = [
            ...remote.servers.filter(server => server.id === remote.activeServerId),
            ...remote.servers,
          ].find(server => remoteServerCapabilities(server).videoGeneration);
          if (computer) {
            remote.setActiveRemoteMediaServerId('video', computer.id);
          } else {
            quickSettings.hide();
            offerVideoStart().catch(() => {});
            return;
          }
        } else {
          setActiveVideoModelId(bestInstalledVideoModel(downloadedVideoModels)!.id);
        }
      }
    }
    const newMode: ImageModeState = imageMode === 'video' ? 'auto' : 'video';
    setImageMode(newMode);
    onImageModeChange?.(newMode);
  };

  const handleVisionPress = () => {
    if (!supportsVision) {
      setAlertState(buildNoVisionAlert({ isRemote, needsRepair: visionNeedsRepair, onRepairVision, dismiss: () => setAlertState(hideAlert()) }));
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

  const handleAssistantPress = () => {
    triggerHaptic('impactLight');
    if (assistantAvailability !== 'ready') {
      setAssistantGateOpen(true);
      return;
    }
    if (!assistantEnabled && !onAssistantEnableTools?.()) {
      setAssistantGateOpen(true);
      return;
    }
    setAssistantEnabled(!assistantEnabled);
    setAssistantTransitioning(true);
    if (assistantTransitionTimer.current) {
      clearTimeout(assistantTransitionTimer.current);
    }
    assistantTransitionTimer.current = setTimeout(() => {
      setAssistantTransitioning(false);
      assistantTransitionTimer.current = null;
    }, ANIM_DURATION_IN);
  };

  const assistantGate =
    assistantAvailability === 'no-pro'
      ? {
          title: 'Assistant requires Pro',
          body: 'Assistant uses Web Use and Computer Use on a connected Desktop.',
          action: 'View Pro',
          onPress: onAssistantUpgrade,
        }
      : assistantAvailability === 'unavailable'
        ? {
            title: 'Desktop tasks unavailable',
            body: 'This Desktop is connected, but Web Use and Computer Use are not available. Allow remote tasks on the Desktop and try again.',
            action: 'OK',
            onPress: undefined,
          }
        : {
            title: 'Connect a Desktop',
            body: 'Set up Sync and connect Off Grid AI Desktop to use Web Use and Computer Use.',
            action: 'Set up Sync',
            onPress: onAssistantSetupSync,
          };

  // Each picker reports its own failure to the user; a rejection here is only logged.
  const settle = (picking: Promise<unknown>) => {
    picking.catch(reason => logger.warn('[COMPOSER-SM] attach failed:', reason));
  };
  // One list, one step, on both phones: a photo is taken or chosen right here, not behind a second
  // menu (Mac, 2026-11-07: Photo, then Camera or Photo Library, asked twice). A model that can't see
  // keeps a Photo row, which says why and offers the repair when the vision file is broken.
  const attachChoices: AttachChoice[] = supportsVision
    ? [
        { key: 'camera', label: 'Take photo', icon: 'camera', onPress: () => settle(pickFromCamera()) },
        { key: 'library', label: 'Choose photo', icon: 'image', onPress: () => settle(pickFromLibrary()) },
        { key: 'document', label: 'Document', icon: 'file', onPress: () => settle(handlePickDocument()) },
      ]
    : [
        { key: 'photo', label: 'Photo', icon: 'image', onPress: handleVisionPress },
        { key: 'document', label: 'Document', icon: 'file', onPress: () => settle(handlePickDocument()) },
      ];

  const handleAttachPress = () => {
    logger.log(`[COMPOSER-SM] attach pressed platform=${Platform.OS} supportsVision=${supportsVision}`);
    if (Platform.OS === 'ios') {
      const options = [...attachChoices.map(choice => choice.label), 'Cancel'];
      ActionSheetIOS.showActionSheetWithOptions({ options, cancelButtonIndex: options.length - 1 }, index =>
        attachChoices[index]?.onPress(),
      );
    } else {
      attachPicker.show();
    }
  };

  // ─── Audio mode: pro renders the mic-only layout via a slot ─────────────────
  // Free builds have no audio slot, so interfaceMode never becomes 'audio' and
  // this branch is skipped entirely.
  const AudioInput = getSlot(SLOTS.chatInputAudioMode);
  // Scribe (Pro): underlines in the composer and the fix for the word at the caret.
  const ScribeText = getSlot(SLOTS.scribeInputText);
  const ScribeBar = getSlot(SLOTS.scribeInputBar);
  if (isAudioMode && AudioInput) {
    return (
      <>
      {/* The composer owns the footer inset; this branch returns before it, so it clears the home indicator here. */}
      <View style={{ paddingBottom: bottomInset }}>
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
        queue={queue}
        queueActions={queueActions}
        isRecording={isRecording}
        voiceAvailable={voiceAvailable}
        isModelLoading={isModelLoading}
        isTranscribing={isTranscribing}
        partialResult={partialResult}
        error={error}
        onStartRecording={startRecordingAfterStop}
        onStopRecording={stopRecording}
        onCancelRecording={cancelRecording}
        onStop={onStop}
        onImageModeToggle={handleImageModeToggle}
        onVideoModeToggle={handleVideoModeToggle}
        onThinkingToggle={handleThinkingToggle}
        onToolsPress={onToolsPress}
        onMcpPress={onMcpPress}
        mcpToolCount={mcpToolCount}
        attachChoices={attachChoices}
        onAttachPress={handleAttachPress}
        attachPicker={attachPicker}
        voicePicker={voicePicker}
        quickSettings={quickSettings}
        alertState={alertState}
        setAlertState={setAlertState}
        assistantSelected={assistantEnabled}
        onAssistantPress={handleAssistantPress}
      />
      </View>
      <AppSheet
        sheet="assistant-gate"
        visible={assistantGateOpen}
        onClose={() => setAssistantGateOpen(false)}
        title={assistantGate.title}
        enableDynamicSizing
      >
        <View style={styles.assistantGateContent}>
          <Text style={styles.assistantGateText}>{assistantGate.body}</Text>
          <Button title={assistantGate.action} onPress={() => {
            setAssistantGateOpen(false);
            assistantGate.onPress?.();
          }} />
        </View>
      </AppSheet>
      </>
    );
  }

  // Pro-only inline Chat↔Audio toggle (empty slot in free builds → null).
  const pillIconsExpandedWidth = computePillIconsWidth();

  const actionButton = canSend ? (
    <TouchableOpacity
      testID="send-button"
      accessibilityRole="button"
      accessibilityLabel={isGenerating ? 'Queue message' : 'Send message'}
      accessibilityHint={isGenerating ? 'Long press to stop the reply and send now' : undefined}
      style={styles.circleButton}
      onPress={() => handleSend()}
      onLongPress={isGenerating ? () => handleSend(true) : undefined}
    >
      <Icon name="send" size={18} color={colors.background} />
    </TouchableOpacity>
  ) : isGenerating && onStop ? (
    <TouchableOpacity
      testID="stop-button"
      accessibilityRole="button"
      accessibilityLabel="Stop reply"
      style={[styles.circleButton, styles.circleButtonStop]}
      onPress={handleStop}
    >
      <Icon name="square" size={16} color={colors.text} />
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
      disabled={disabled || micResting}
      onStartRecording={startRecordingAfterStop}
      onStopRecording={stopRecording}
      onCancelRecording={cancelRecording}
      onInteractionModeChange={setVoiceInteractionMode}
    />
  );

  return (
    <View style={styles.container}>
      <View style={styles.aboveComposer}>
        <QueueRow queue={queue} actions={queueActions} />
        {transcriptionNotice ? (
          <Text style={styles.transcriptionNotice} testID="transcription-notice">
            {transcriptionNotice}
          </Text>
        ) : null}
      </View>
      {/* One box across the full width, down to the screen's bottom edge; in image or video mode the styles
          are its top, the input and send below. */}
      {/* Full width down to the screen's bottom edge: the home-indicator inset is padding inside it. */}
      <View style={[styles.composer, isFocused && styles.composerFocused, { paddingBottom: 8 + bottomInset }]}>
      {/* What you attach sits inside the box it goes with, on the same surface (brand Mobile profile;
          Mac, 2026-11-06: a photo above the composer read as a separate white tile). */}
      <AttachmentPreview attachments={attachments} onRemove={removeAttachment} onImagePress={onImagePress} />
      {styleKind && (stylesShown || chosenStyle) ? (
        <StyleRow
          attached
          collapsed={!stylesShown}
          kind={styleKind}
          selectedId={chosenStyle}
          onChange={styleId => pickStyle(styleKind, styleId)}
        />
      ) : null}
      {/* Scribe's fix for the word at the caret, or Improve for a selection: inside the box it acts on. */}
      {ScribeBar && !showVoiceStatus ? (
        <ScribeBar text={message} selection={selection} onChangeText={setMessage} />
      ) : null}
      <View style={styles.mainRow}>
        <View style={[styles.pill, styles.pillInComposer]} testID="composer-pill" accessibilityState={{ selected: isFocused }}>
          {showVoiceStatus ? (
            <RecordingHint
              awaitingSpeech={isAwaitingSpeech}
              interactionMode={voiceInteractionMode}
              processing={voiceProcessingState}
            />
          ) : (
            <>
              <Button
                title=""
                variant="ghost"
                size="small"
                testID="assistant-toggle"
                accessibilityLabel="Assistant"
                accessibilityState={{
                  selected: assistantEnabled,
                  busy: assistantTransitioning,
                }}
                onPress={handleAssistantPress}
                active={assistantEnabled}
                loading={assistantTransitioning}
                style={styles.assistantButton}
                icon={<GodIcon
                  size={19}
                  fill={assistantEnabled ? colors.primary : 'none'}
                  stroke={assistantEnabled ? 'none' : colors.textSecondary}
                  strokeWidth={1.5}
                  color={assistantEnabled ? colors.primary : colors.textSecondary}
                />}
              />
              <TextInput
                ref={inputRef}
                testID="chat-input"
                style={styles.pillInput}
                value={ScribeText ? undefined : message}
                onChangeText={setMessage}
                onSelectionChange={e => setSelection(e.nativeEvent.selection)}
                placeholder={
                  imageMode === 'video' ? 'Describe a video' : imageMode === 'force' ? 'Describe a picture' : placeholder
                }
                placeholderTextColor={colors.textMuted}
                multiline
                scrollEnabled
                editable={!disabled}
                blurOnSubmit={false}
                returnKeyType="default"
                onFocus={() => setIsFocused(true)}
                onBlur={() => setIsFocused(false)}
              >
                {ScribeText ? <ScribeText text={message} /> : null}
              </TextInput>
              <ComposerIconsRow
                hasText={hasText}
                iconsAnim={iconsAnim}
                pillIconsExpandedWidth={pillIconsExpandedWidth}
                attachTriggerRef={attachPicker.triggerRef}
                onAttachPress={handleAttachPress}
                quickSettingsTriggerRef={quickSettings.triggerRef}
                onQuickSettingsPress={handleQuickSettingsPress}
                showSettingsDot={showSettingsDot}
                disabled={disabled}
              />
            </>
          )}
        </View>

        {actionButton}
      </View>
      </View>

      {Platform.OS !== 'ios' && (
        <AttachPickerPopover
          visible={attachPicker.visible}
          onClose={attachPicker.hide}
          anchorY={attachPicker.anchor.y}
          anchorX={attachPicker.anchor.x}
          choices={attachChoices}
        />
      )}

      <QuickSettingsPopover
        visible={quickSettings.visible}
        onClose={quickSettings.hide}
        anchorY={quickSettings.anchor.y}
        anchorX={quickSettings.anchor.x}
        imageMode={imageMode}
        onImageModeToggle={handleImageModeToggle}
        onVideoModeToggle={handleVideoModeToggle}
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
      <AppSheet
        sheet="assistant-gate"
        visible={assistantGateOpen}
        onClose={() => setAssistantGateOpen(false)}
        title={assistantGate.title}
        enableDynamicSizing
      >
        <View style={styles.assistantGateContent}>
          <Text style={styles.assistantGateText}>{assistantGate.body}</Text>
          <Button
            title={assistantGate.action}
            onPress={() => {
              setAssistantGateOpen(false);
              assistantGate.onPress?.();
            }}
          />
        </View>
      </AppSheet>
    </View>
  );
};
