/* eslint-disable react-native/no-inline-styles, max-lines-per-function, complexity -- Existing chat orchestrator coordinates many native model and UI lifecycles. */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useWideLayout } from '../../hooks/useWideLayout';
import { isProtectedProjectUnlocked } from '../../stores/protectedProjectStorage';
import { FlatList, Keyboard, InteractionManager, Platform, View } from 'react-native';
// Edge-to-edge-aware KeyboardAvoidingView. RN's own version leaves a residual
// padding band on Android under edge-to-edge (adjustResize is a no-op there);
// this one reconciles the keyboard frame against the navigation-bar inset.
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useUiModeStore } from '../../stores/uiModeStore';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../navigation/types';
import { useSpotlightTour } from 'react-native-spotlight-tour';
import { CustomAlert, hideAlert, showAlert, SharePromptSheet } from '../../components';
import { useEjectAllModels } from '../../hooks/useEjectAllModels';
import { consumePendingSpotlight } from '../../components/onboarding/spotlightState';
import { VOICE_HINT_STEP_INDEX, IMAGE_SETTINGS_STEP_INDEX } from '../../components/onboarding/spotlightConfig';
import { useAppStore } from '../../stores/appStore';
import { useChatOptions } from '../../components/ChatOptions';
import type { Conversation, Message } from '../../types';
import { useTheme, useThemedStyles } from '../../theme';
import { createStyles } from './styles';
import { useChatScreen } from './useChatScreen';
import { MessageRenderer } from './MessageRenderer';
import { NoModelScreen, ChatHeader } from './ChatScreenComponents';
import { ChatModalSection } from './ChatModalSection';
import { ChatPinGate } from '../../components/ChatPinGate';
import { ChatMessageArea } from './ChatMessageArea';
import { ModelsManagerSheet, ModelRowType } from '../../components/models/ModelsManagerSheet';
import { WhisperPickerSheet } from '../../components/models/WhisperPickerSheet';
import { VoiceModelsSheet } from '../../components/models/VoiceModelsSheet';
import { useWhisperStore } from '../../stores/whisperStore';
import { WHISPER_MODELS } from '../../services';
import { getTextRuntimeInfo } from '../../services/activeModelService/runtimeInfo';
import { formatRemoteRuntimeStatus, formatTextRuntimeStatus } from '../../utils/modelRuntimeStatus';
import { speedHealthLabel, useSpeedStats } from '../../atlasTools/speed';

function countConversationImages(conv: Conversation | undefined): number {
  return (conv?.messages || []).reduce((n: number, m: Message) =>
    n + (m.attachments?.filter((a) => a.type === 'image').length || 0), 0);
}
export const ChatScreen: React.FC = () => {
  const flatListRef = React.useRef<FlatList>(null);
  const isNearBottomRef = React.useRef(true);
  const rootNavigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const chat = useChatScreen();
  // Deleting the open chat from its header menu leaves the screen instead of showing a deleted chat.
  const chatOptions = useChatOptions({ onDeleted: () => { if (rootNavigation.canGoBack()) rootNavigation.goBack(); } });
  const { goTo, current } = useSpotlightTour();

  // Collapsed Models control (shared with home): header "Models" → manager sheet.
  const [modelsManagerOpen, setModelsManagerOpen] = useState(false);
  // Which tab the model selector opens on — set from the manager row the user tapped so
  // tapping "Image" focuses the Image tab (it defaulted to Text regardless of the row).
  const [modelSelectorTab, setModelSelectorTab] = useState<'text' | 'image'>('text');
  const [whisperOpen, setWhisperOpen] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const voiceSummary = useUiModeStore((s) => s.voiceSummary);
  const whisperModelId = useWhisperStore((s) => s.downloadedModelId);
  const modelNicknames = useAppStore(s => s.modelNicknames);
  const modelLabels: Record<ModelRowType, string> = {
    text: chat.activeModelInfo?.modelId && modelNicknames[chat.activeModelInfo.modelId]
      || chat.activeModelName || chat.activeModel?.name || '—',
    image: chat.activeImageModel?.name ?? '—',
    voice: voiceSummary ?? '—',
    speech: WHISPER_MODELS.find((m) => m.id === whisperModelId)?.name ?? '—',
  };

  // Subscribe to the service's reactive residency projection so this status flips
  // immediately from selected -> loading -> actually loaded (and loaded -> evicted).
  const loadedTextModelId = useAppStore((s) => s.loadedTextModelId);
  const textModelEvicted = useAppStore((s) => s.textModelEvicted);
  let localRuntimeInfo = getTextRuntimeInfo(loadedTextModelId, !!chat.isModelLoading);
  if (chat.isModelLoading && !chat.activeModelInfo?.isRemote) {
    localRuntimeInfo = {
      ...localRuntimeInfo,
      state: 'loading',
      modelId: chat.loadingModel?.id ?? localRuntimeInfo.modelId,
      modelName: chat.loadingModel?.name ?? localRuntimeInfo.modelName,
    };
  } else if (chat.activeModelId && loadedTextModelId !== chat.activeModelId && textModelEvicted) {
    localRuntimeInfo = { ...localRuntimeInfo, state: 'evicted' };
  }
  const textRuntime = chat.activeModelInfo?.isRemote
    ? formatRemoteRuntimeStatus(chat.activeModelName)
    : formatTextRuntimeStatus(localRuntimeInfo);
  const activeSpeed = useSpeedStats((s) => chat.activeModelInfo?.modelId ? s.byModel[chat.activeModelInfo.modelId]?.decode : undefined);
  const textRuntimeDetail = activeSpeed && activeSpeed > 0
    ? `${textRuntime.detail} · typical ${activeSpeed.toFixed(1)} tok/s (${speedHealthLabel(activeSpeed)})`
    : textRuntime.detail;

  const pendingModelRowRef = useRef<ModelRowType | null>(null);
  // Eject All — shared with Home via one hook (the unload side-effect lives in the
  // service, not duplicated per screen). Deferred until the sheet fully closes so
  // the confirm dialog isn't rendered under it (same pattern as the row pickers).
  const { isEjecting, hasActiveModel: hasEjectableModel, ejectAll } = useEjectAllModels();
  const pendingEjectRef = useRef(false);
  const confirmEjectAll = () => {
    chat.setAlertState(showAlert('Eject All Models', 'Unload all active models to free up memory?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Eject', style: 'destructive',
        onPress: async () => {
          chat.setAlertState(hideAlert());
          try {
            const count = await ejectAll();
            if (count > 0) chat.setAlertState(showAlert('Done', `Unloaded ${count} model${count > 1 ? 's' : ''}`));
          } catch {
            chat.setAlertState(showAlert('Error', 'Failed to unload models'));
          }
        },
      },
    ]));
  };
  const openModelRowNow = (type: ModelRowType) => {
    if (type === 'text' || type === 'image') { setModelSelectorTab(type); chat.setShowModelSelector(true); }
    else if (type === 'speech') setWhisperOpen(true);
    else setVoiceOpen(true);
  };
  const openModelRow = (type: ModelRowType) => {
    // Defer opening the target sheet until the manager sheet has FULLY closed.
    // Presenting a sheet while another is still dismissing drops the present on
    // iOS, so the row tap just closed the manager and nothing opened.
    pendingModelRowRef.current = type;
    setModelsManagerOpen(false);
  };
  const pendingNextRef = useRef<number | null>(null);

  // Keyboard avoidance is handled by KeyboardAvoidingView behavior="padding"
  // (same as main, on both platforms). The custom androidKbPad mechanism that
  // previously lived here floated the input mid-screen, so it was removed.

  // Clean layout (the default) uses more of a tablet's width; Bubbles keeps the narrower reading column.
  const chatLayout = useAppStore((s) => s.settings.appearance?.chatLayout ?? 'clean');
  const wide = useWideLayout(chatLayout === 'clean' ? 1180 : undefined);
  const [sharePromptVisible, setSharePromptVisible] = useState(false);
  // Atlas: no share prompts.

  // Only ONE AttachStep mounted at a time to avoid waypoint dots/lines.
  // chatSpotlight controls which index is active (3, 12, 15, or 16).
  const [chatSpotlight, setChatSpotlight] = useState<number | null>(null);
  const onboardingChecklist = useAppStore(s => s.onboardingChecklist);
  const shownSpotlights = useAppStore(s => s.shownSpotlights);
  const markSpotlightShown = useAppStore(s => s.markSpotlightShown);
  const step3ShownRef = useRef(false);
  // If user arrived here via onboarding spotlight flow, show input spotlight
  useEffect(() => {
    const pending = consumePendingSpotlight();
    if (pending === 3) {
      // Chain: step 3 (ChatInput) → step 12 (VoiceRecordButton)
      pendingNextRef.current = VOICE_HINT_STEP_INDEX;
      step3ShownRef.current = false;
      const task = InteractionManager.runAfterInteractions(() => {
        step3ShownRef.current = true;
        goTo(3);
      });
      return () => task.cancel();
    } else if (pending !== null) {
      const task = InteractionManager.runAfterInteractions(() => goTo(pending));
      return () => task.cancel();
    }
  }, [goTo]);
  const chainingRef = useRef(false);
  // When the spotlight tour stops after step 3, fire the chained step 12
  useEffect(() => {
    if (current === undefined && step3ShownRef.current && pendingNextRef.current !== null) {
      step3ShownRef.current = false;
      chainingRef.current = true;
      const next = pendingNextRef.current;
      pendingNextRef.current = null;
      // Switch AttachStep index — need time for new AttachStep to mount + measure layout
      setChatSpotlight(next);
      setTimeout(() => {
        chainingRef.current = false;
        goTo(next);
      }, 800);
    } else if (current === undefined && !chainingRef.current && !step3ShownRef.current && pendingNextRef.current === null) {
      // Tour stopped and no chain pending — clear spotlight
      setChatSpotlight(null);
    }
  }, [current, goTo]);
  useFocusEffect(
    useCallback(() => {
      const pending = consumePendingSpotlight();
      if (pending !== null) {
        const task = InteractionManager.runAfterInteractions(() => goTo(pending));
        return () => task.cancel();
      }
    }, [goTo]),
  );
  const generatedImages = useAppStore(s => s.generatedImages);
  useEffect(() => {
    if (
      generatedImages.length > 0 &&
      !shownSpotlights.imageSettings &&
      onboardingChecklist.triedImageGen
    ) {
      markSpotlightShown('imageSettings');
      InteractionManager.runAfterInteractions(() => goTo(IMAGE_SETTINGS_STEP_INDEX));
    }
  }, [generatedImages.length, shownSpotlights, onboardingChecklist.triedImageGen, markSpotlightShown, goTo]);

  React.useEffect(() => {
    if (chat.activeConversation?.messages.length && isNearBottomRef.current) {
      setTimeout(() => { flatListRef.current?.scrollToEnd({ animated: true }); }, 100);
    }
  }, [chat.activeConversation?.messages.length]);

  React.useEffect(() => {
    const event = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const sub = Keyboard.addListener(event, () => {
      flatListRef.current?.scrollToEnd({ animated: true });
    });
    return () => sub.remove();
  }, []);

  // Reset scroll when switching between chat/audio interface modes
  const interfaceMode = useUiModeStore((s) => s.interfaceMode);
  const prevModeRef = React.useRef(interfaceMode);
  React.useEffect(() => {
    if (prevModeRef.current !== interfaceMode) {
      prevModeRef.current = interfaceMode;
      isNearBottomRef.current = true;
      chat.setShowScrollToBottom(false);
      // FlatList re-renders via extraData; onContentSizeChange fires and scrolls.
      // Backup: scroll after items have had time to re-measure.
      setTimeout(() => { flatListRef.current?.scrollToEnd({ animated: false }); }, 300);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interfaceMode]);

  const alertEl = (
    <CustomAlert
      visible={chat.alertState.visible}
      title={chat.alertState.title}
      message={chat.alertState.message}
      buttons={chat.alertState.buttons}
      prominentMessage={chat.alertState.prominentMessage}
      onClose={() => chat.setAlertState(hideAlert())}
    />
  );
  if (!chat.hasActiveModel && chat.displayMessages.length === 0) {
    return (
      <>
        <NoModelScreen
          styles={styles} colors={colors}
          navigation={chat.navigation}
          hasAvailableModels={chat.hasAvailableModels}
          showModelSelector={chat.showModelSelector}
          setShowModelSelector={chat.setShowModelSelector}
          onSelectModel={chat.handleModelSelect}
          onUnloadModel={chat.handleUnloadModel}
          isModelLoading={chat.isModelLoading}
        />
        {alertEl}
      </>
    );
  }

  // Model loading is shown inline (a "Loading model" bar above the input via
  // ChatMessageArea), so the chat stays visible while a text/image model loads —
  // no full-screen takeover.

  const handleScroll = (event: any) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const distFromBottom = contentSize.height - layoutMeasurement.height - contentOffset.y;
    isNearBottomRef.current = distFromBottom < 100;
    chat.setShowScrollToBottom(!isNearBottomRef.current);
  };

  const renderItem = ({ item, index }: { item: any; index: number }) => (
    <MessageRenderer
      item={item} index={index}
      displayMessagesLength={chat.displayMessages.length}
      animateLastN={chat.animateLastN}
      imageModelLoaded={chat.imageModelLoaded}
      isStreaming={chat.isStreaming}
      isGeneratingImage={chat.isGeneratingImage}
      showGenerationDetails={chat.settings.showGenerationDetails}
      onCopy={chat.handleCopyMessage}
      onRetry={chat.handleRetryMessage}
      onEdit={chat.handleEditMessage}
      onDelete={chat.handleDeleteMessage}
      onSaveToProject={chat.activeProject && !chat.activeConversation?.isPrivate &&
        (chat.activeProject.pinVerifier ? isProtectedProjectUnlocked(chat.activeProject.id) : !chat.activeConversation?.pinVerifier)
        ? chat.handleSaveReportToProject : undefined}
      onGenerateImage={chat.handleGenerateImageFromMessage}
      onImagePress={chat.handleImagePress}
    />
  );

  const imageCount = countConversationImages(chat.activeConversation);

  // Bottom safe-area is applied on the input footer (ChatMessageArea), not here
  // — otherwise the inset stacks on top of the input's own padding and leaves a
  // gap below the bar.
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <KeyboardAvoidingView testID="chat-screen" style={styles.keyboardView} behavior="padding" keyboardVerticalOffset={0}>
        <View style={wide.column}>
        <ChatHeader
          styles={styles} colors={colors}
          activeConversation={chat.activeConversation}
          activeProject={chat.activeProject}
          navigation={chat.navigation}
          onOpenModels={() => setModelsManagerOpen(true)}
          onOpenChatOptions={() => chat.activeConversation && chatOptions.open(chat.activeConversation)}
          setShowSettingsPanel={chat.setShowSettingsPanel}
          researchMode={chat.researchMode}
          setShowProjectSelector={chat.setShowProjectSelector}
          isRemote={chat.activeModelInfo?.isRemote}
          modelRuntimeLabel={textRuntime.compact}
          modelRuntimeState={textRuntime.state}
        />
        </View>
        <ModelsManagerSheet
          visible={modelsManagerOpen}
          onClose={() => setModelsManagerOpen(false)}
          onClosed={() => {
            const t = pendingModelRowRef.current;
            pendingModelRowRef.current = null;
            if (t) openModelRowNow(t);
            if (pendingEjectRef.current) { pendingEjectRef.current = false; confirmEjectAll(); }
          }}
          labels={modelLabels}
          details={{ text: textRuntimeDetail }}
          remote={{ text: !!chat.activeModelInfo?.isRemote }}
          loadingState={{ isLoading: !!chat.isModelLoading, type: 'text' }}
          isEjecting={isEjecting}
          hasActiveModel={hasEjectableModel}
          onOpenRow={openModelRow}
          onEject={() => { pendingEjectRef.current = true; setModelsManagerOpen(false); }}
        />
        <WhisperPickerSheet visible={whisperOpen} onClose={() => setWhisperOpen(false)} />
        <VoiceModelsSheet visible={voiceOpen} onClose={() => setVoiceOpen(false)} />
        <View style={[{ flex: 1 }, wide.column]}>
        <ChatMessageArea
          flatListRef={flatListRef}
          isNearBottomRef={isNearBottomRef}
          chat={chat}
          styles={styles}
          colors={colors}
          handleScroll={handleScroll}
          renderItem={renderItem}
          chatSpotlight={chatSpotlight}
        />
        </View>
        <ChatModalSection
          styles={styles} colors={colors}
          onOpenModels={() => { chat.setShowSettingsPanel(false); setTimeout(() => setModelsManagerOpen(true), 250); }}
          showProjectSelector={chat.showProjectSelector}
          setShowProjectSelector={chat.setShowProjectSelector}
          showDebugPanel={chat.showDebugPanel}
          setShowDebugPanel={chat.setShowDebugPanel}
          showModelSelector={chat.showModelSelector}
          setShowModelSelector={chat.setShowModelSelector}
          modelSelectorTab={modelSelectorTab}
          showSettingsPanel={chat.showSettingsPanel}
          setShowSettingsPanel={chat.setShowSettingsPanel}
          researchMode={chat.researchMode}
          setResearchMode={chat.setResearchMode}
          researchDepth={chat.researchDepth}
          setResearchDepth={chat.setResearchDepth}
          researchBusy={chat.isStreaming || chat.isGeneratingImage || !!chat.researchStatus}
          researchStatus={chat.researchStatus}
          debugInfo={chat.debugInfo}
          activeProject={chat.activeProject}
          activeConversation={chat.activeConversation}
          settings={chat.settings}
          projects={chat.projects}
          handleSelectProject={chat.handleSelectProject}
          handleModelSelect={chat.handleModelSelect}
          handleUnloadModel={chat.handleUnloadModel}
          handleDeleteConversation={chat.handleDeleteConversation}
          isModelLoading={chat.isModelLoading}
          imageCount={imageCount}
          activeConversationId={chat.activeConversationId}
          navigation={chat.navigation}
          viewerImageUri={chat.viewerImageUri}
          setViewerImageUri={chat.setViewerImageUri}
          handleSaveImage={chat.handleSaveImage}
          isRemote={chat.activeModelInfo?.isRemote}
        />
      </KeyboardAvoidingView>
      {alertEl}
      <SharePromptSheet visible={sharePromptVisible} onClose={() => setSharePromptVisible(false)} />
      {chatOptions.element}
      <ChatPinGate conversationId={chat.activeConversationId} />
    </SafeAreaView>
  );
};
