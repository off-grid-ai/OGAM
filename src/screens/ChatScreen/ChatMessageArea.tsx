import React, { useState, useMemo } from 'react';
import { View, FlatList, Text, Keyboard, ActivityIndicator, Platform, StyleSheet } from 'react-native';
import { useTTSStore } from '../../stores/ttsStore';
import Icon from 'react-native-vector-icons/Feather';
import Animated, { FadeIn } from 'react-native-reanimated';
import { AttachStep } from 'react-native-spotlight-tour';
import { ChatInput, ToolPickerSheet, ThinkingIndicator } from '../../components';
import { AnimatedPressable } from '../../components/AnimatedPressable';
import { generationService } from '../../services';
import { EmptyChat, ImageProgressIndicator } from './ChatScreenComponents';
import { getPlaceholderText, useChatScreen } from './useChatScreen';
import { createStyles } from './styles';
import { useTheme } from '../../theme';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../navigation/types';

export type ChatMessageAreaProps = {
  flatListRef: React.RefObject<FlatList | null>;
  isNearBottomRef: React.MutableRefObject<boolean>;
  chat: ReturnType<typeof useChatScreen>;
  styles: ReturnType<typeof createStyles>;
  colors: ReturnType<typeof useTheme>['colors'];
  handleScroll: (event: any) => void;
  renderItem: (info: { item: any; index: number }) => React.JSX.Element;
  chatSpotlight: number | null;
};

export const ChatMessageArea: React.FC<ChatMessageAreaProps> = ({
  flatListRef, isNearBottomRef, chat, styles, colors, handleScroll, renderItem, chatSpotlight,
}) => {
  // Hide FlatList until initial layout + scroll is complete to prevent visible scroll jump
  const [isListReady, setIsListReady] = useState(false);
  const hasScrolledRef = React.useRef(false);
  const interfaceMode = useTTSStore((s) => s.settings.interfaceMode);
  const tabNav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [inputHeight, setInputHeight] = useState(84);
  const activeModelRepoId = chat.activeModelId?.split('/').slice(0, 2).join('/');
  const handleRepairVision = activeModelRepoId
    ? () => tabNav.navigate('Main', { screen: 'ModelsTab', params: { repairModelId: activeModelRepoId } })
    : undefined;
  const scrollToBottomStyle = useMemo(
    () => [styles.scrollToBottomContainer, { bottom: inputHeight + 8 }],
    [styles.scrollToBottomContainer, inputHeight],
  );
  return (
    <>
      {chat.displayMessages.length === 0 ? (
        <EmptyChat
          styles={styles} colors={colors}
          activeModel={chat.activeModel}
          activeModelName={chat.activeModelName}
          activeProject={chat.activeProject}
          setShowProjectSelector={chat.setShowProjectSelector}
          isRemote={chat.activeModelInfo?.isRemote}
        />
      ) : (
        <FlatList
          ref={flatListRef}
          style={isListReady ? undefined : hiddenStyle.hidden}
          data={chat.displayMessages}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          extraData={interfaceMode}
          contentContainerStyle={styles.messageList}
          onScroll={handleScroll}
          onContentSizeChange={(_w, h) => {
            if (!hasScrolledRef.current && h > 0) {
              // Initial layout: force scroll to bottom regardless of isNearBottom
              flatListRef.current?.scrollToEnd({ animated: false });
              hasScrolledRef.current = true;
              // Reveal after a frame so the scroll position settles
              requestAnimationFrame(() => {
                requestAnimationFrame(() => setIsListReady(true));
              });
            } else if (isNearBottomRef.current) {
              flatListRef.current?.scrollToEnd({ animated: false });
            }
          }}
          onLayout={() => { }}
          scrollEventThrottle={16}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          onTouchStart={() => Keyboard.dismiss()}
          maintainVisibleContentPosition={{ minIndexForVisible: 0, autoscrollToTopThreshold: 100 }}
          removeClippedSubviews={Platform.OS !== 'android'}
        />
      )}
      {chat.showScrollToBottom && chat.displayMessages.length > 0 && (
        <Animated.View entering={FadeIn.duration(150)} style={scrollToBottomStyle}>
          <AnimatedPressable hapticType="impactLight" style={styles.scrollToBottomButton} onPress={() => flatListRef.current?.scrollToEnd({ animated: true })}>
            <Icon name="chevron-down" size={20} color={colors.textSecondary} />
          </AnimatedPressable>
        </Animated.View>
      )}
      {chat.isGeneratingImage && (
        <ImageProgressIndicator
          styles={styles} colors={colors}
          imagePreviewPath={chat.imagePreviewPath}
          imageGenerationStatus={chat.imageGenerationStatus}
          imageGenerationProgress={chat.imageGenerationProgress}
          onStop={chat.handleStop}
        />
      )}
      {chat.isClassifying && (
        <View style={styles.classifyingBar}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={styles.classifyingText}>Understanding your request...</Text>
        </View>
      )}
      {chat.isCompacting && (
        <Animated.View entering={FadeIn.duration(200)} style={styles.classifyingBar}>
          <ThinkingIndicator text="Compacting your conversation..." />
        </Animated.View>
      )}
      {chat.hasPendingSettings && !chat.isCompacting && !chat.activeModelInfo?.isRemote && (
        <Animated.View entering={FadeIn.duration(200)}>
          <AnimatedPressable style={styles.pendingSettingsBar} onPress={chat.handleReloadTextModel}>
            <Icon name="alert-circle" size={16} color={colors.warning} />
            <Text style={styles.pendingSettingsText}>
              Settings changed — tap to reload model
            </Text>
            <Icon name="refresh-cw" size={14} color={colors.warning} />
          </AnimatedPressable>
        </Animated.View>
      )}
      {/* Steps 3/15 share the same AttachStep wrapping ChatInput (multi-index).
         Steps 12/16 are handled inside ChatInput via activeSpotlight prop. */}
      <View onLayout={(e) => setInputHeight(e.nativeEvent.layout.height)}>
        <AttachStep index={[3, 15]} fill>
          <ChatInput
            onSend={chat.handleSend}
            onStop={chat.handleStop}
            disabled={!chat.hasActiveModel}
            isGenerating={chat.isStreaming || chat.isThinking}
            supportsVision={chat.supportsVision}
            conversationId={chat.activeConversationId}
            imageModelLoaded={chat.imageModelLoaded}
            onOpenSettings={() => chat.setShowSettingsPanel(true)}
            queueCount={chat.queueCount}
            queuedTexts={chat.queuedTexts}
            onClearQueue={() => generationService.clearQueue()}
            placeholder={getPlaceholderText(chat.hasActiveModel, chat.supportsVision)}
            onToolsPress={() => chat.setShowToolPicker(true)}
            enabledToolCount={chat.enabledTools.length}
            supportsToolCalling={chat.supportsToolCalling}
            supportsThinking={chat.supportsThinking}
            onRepairVision={handleRepairVision}
            activeSpotlight={chatSpotlight === 12 ? chatSpotlight : null}
          />
        </AttachStep>
      </View>
      <ToolPickerSheet
        visible={chat.showToolPicker}
        onClose={() => chat.setShowToolPicker(false)}
        enabledTools={chat.enabledTools}
        onToggleTool={chat.handleToggleTool}
      />
    </>
  );
};

const hiddenStyle = StyleSheet.create({
  hidden: { opacity: 0 },
});
