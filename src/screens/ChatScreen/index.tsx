import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, KeyboardAvoidingView, InteractionManager } from 'react-native';
import { useTTSStore } from '../../stores/ttsStore';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { useSpotlightTour } from 'react-native-spotlight-tour';
import { CustomAlert, hideAlert, SharePromptSheet } from '../../components';
import { consumePendingSpotlight } from '../../components/onboarding/spotlightState';
import { subscribeSharePrompt } from '../../utils/sharePrompt';
import { VOICE_HINT_STEP_INDEX, IMAGE_SETTINGS_STEP_INDEX } from '../../components/onboarding/spotlightConfig';
import { useAppStore } from '../../stores/appStore';
import type { Conversation, Message } from '../../types';
import { useTheme, useThemedStyles } from '../../theme';
import { createStyles } from './styles';
import { useChatScreen } from './useChatScreen';
import { MessageRenderer } from './MessageRenderer';
import { NoModelScreen, LoadingScreen, ChatHeader } from './ChatScreenComponents';
import { ChatModalSection } from './ChatModalSection';
import { ChatMessageArea } from './ChatMessageArea';

function countConversationImages(conv: Conversation | undefined): number {
  return (conv?.messages || []).reduce((n: number, m: Message) =>
    n + (m.attachments?.filter((a) => a.type === 'image').length || 0), 0);
}
export const ChatScreen: React.FC = () => {
  const flatListRef = React.useRef<FlatList>(null);
  const isNearBottomRef = React.useRef(true);
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const chat = useChatScreen();
  const { goTo, current } = useSpotlightTour();
  const pendingNextRef = useRef<number | null>(null);

  const [sharePromptVisible, setSharePromptVisible] = useState(false);
  useEffect(() => subscribeSharePrompt(() => setSharePromptVisible(true)), []);
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
  }, []);
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

  // Reset scroll when switching between chat/audio interface modes
  const interfaceMode = useTTSStore((s) => s.settings.interfaceMode);
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
      onClose={() => chat.setAlertState(hideAlert())}
    />
  );
  if (!chat.hasActiveModel) {
    return (
      <>
        <NoModelScreen
          styles={styles} colors={colors}
          navigation={chat.navigation}
          downloadedModelsCount={chat.downloadedModels.length}
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

  if (chat.isModelLoading) {
    const sizeSource = chat.loadingModel ?? chat.activeModel;
    const modelName = chat.loadingModel?.name || chat.activeModelName || 'Unknown';
    return (
      <>
        <LoadingScreen
          styles={styles} colors={colors}
          navigation={chat.navigation}
          loadingModelName={modelName}
          modelSize={sizeSource ? chat.hardwareService.formatModelSize(sizeSource) : ''}
          hasVision={!!(chat.loadingModel?.mmProjPath || chat.activeModel?.mmProjPath)}
        />
        {alertEl}
      </>
    );
  }

  const handleScroll = (event: any) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    isNearBottomRef.current = contentSize.height - layoutMeasurement.height - contentOffset.y < 100;
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
      onGenerateImage={chat.handleGenerateImageFromMessage}
      onImagePress={chat.handleImagePress}
    />
  );

  const imageCount = countConversationImages(chat.activeConversation);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <KeyboardAvoidingView testID="chat-screen" style={styles.keyboardView} behavior="padding" keyboardVerticalOffset={0}>
        <ChatHeader
          styles={styles} colors={colors}
          activeConversation={chat.activeConversation}
          activeModel={chat.activeModel}
          activeModelName={chat.activeModelName}
          activeImageModel={chat.activeImageModel}
          activeProject={chat.activeProject}
          navigation={chat.navigation}
          setShowModelSelector={chat.setShowModelSelector}
          setShowSettingsPanel={chat.setShowSettingsPanel}
          setShowProjectSelector={chat.setShowProjectSelector}
          isRemote={chat.activeModelInfo?.isRemote}
        />
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
        <ChatModalSection
          styles={styles} colors={colors}
          showProjectSelector={chat.showProjectSelector}
          setShowProjectSelector={chat.setShowProjectSelector}
          showDebugPanel={chat.showDebugPanel}
          setShowDebugPanel={chat.setShowDebugPanel}
          showModelSelector={chat.showModelSelector}
          setShowModelSelector={chat.setShowModelSelector}
          showSettingsPanel={chat.showSettingsPanel}
          setShowSettingsPanel={chat.setShowSettingsPanel}
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
    </SafeAreaView>
  );
};
