import React, { useState, useMemo, useEffect, useRef } from 'react';
import { View, FlatList, Text, Keyboard, ActivityIndicator, Platform, StyleSheet } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import Animated, { FadeIn } from 'react-native-reanimated';
import { AttachStep } from 'react-native-spotlight-tour';
import { ChatInput, ToolPickerSheet, ThinkingIndicator } from '../../components';
import { AnimatedPressable } from '../../components/AnimatedPressable';
import { generationService } from '../../services';
import { INFERENCE_BACKENDS } from '../../types';
import { TYPOGRAPHY, SPACING } from '../../constants';
import { EmptyChat, ImageProgressIndicator } from './ChatScreenComponents';
import { getPlaceholderText, useChatScreen } from './useChatScreen';
import { createStyles } from './styles';
import { useTheme } from '../../theme';
import { useAppStore } from '../../stores';
import { getToolExtensions } from '../../services/tools/extensions';
import { getRegisteredScreens } from '../../navigation/screenRegistry';
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
  const tabNav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { toolCountHintDismissed } = useAppStore();
  const extToolCount = getToolExtensions().reduce((n, e) => n + e.enabledToolCount(), 0);
  const totalToolCount = chat.enabledTools.length + extToolCount;
  const handleMcpPress = () => {
    const hasMcpScreen = getRegisteredScreens().some(s => s.name === 'McpServers');
    if (hasMcpScreen) {
      tabNav.navigate('McpServers' as any);
    } else {
      tabNav.navigate('ProDetail');
    }
  };
  const showSettingsDot = totalToolCount > 3 && !toolCountHintDismissed;
  const [inputHeight, setInputHeight] = useState(84);
  const flatListHeightRef = useRef(0);
  const isStreaming = chat.isStreaming || chat.isThinking;
  const prevIsStreamingRef = useRef(isStreaming);
  useEffect(() => {
    prevIsStreamingRef.current = isStreaming;
  }, [isStreaming]);
  const activeModelRepoId = chat.activeModelId?.split('/').slice(0, 2).join('/');
  const handleRepairVision = activeModelRepoId
    ? () => tabNav.navigate('DownloadManager')
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
          data={chat.displayMessages}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.messageList}
          onScroll={handleScroll}
          onContentSizeChange={(_w, _h) => { if (isNearBottomRef.current) flatListRef.current?.scrollToEnd({ animated: false }); }}
          onLayout={(e) => {
            const newHeight = e.nativeEvent.layout.height;
            const prevHeight = flatListHeightRef.current;
            flatListHeightRef.current = newHeight;
            if (prevHeight > 0 && newHeight < prevHeight) {
              setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 50);
            }
          }}
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
      {chat.settings.inferenceBackend === INFERENCE_BACKENDS.OPENCL
        && chat.activeModel?.engine === 'llama'
        && !chat.activeModelInfo?.isRemote
        && (
        <View style={[openCLBannerStyles.row, { backgroundColor: `${colors.warning}15` }]}>
          <Icon name="info" size={13} color={colors.warning} />
          <Text style={[openCLBannerStyles.text, { color: colors.warning }]}>
            OpenCL is not recommended. Consider switching to CPU in Settings.
          </Text>
        </View>
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
            placeholder={getPlaceholderText({
              hasModel: chat.hasActiveModel,
              isModelLoading: chat.isModelLoading,
              supportsVision: chat.supportsVision,
              imageOnly: chat.imageModelLoaded && !chat.hasTextModel,
            })}
            onToolsPress={() => chat.setShowToolPicker(true)}
            enabledToolCount={chat.enabledTools.length}
            showSettingsDot={showSettingsDot}
            mcpToolCount={extToolCount}
            onMcpPress={handleMcpPress}
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

const openCLBannerStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm },
  text: { ...TYPOGRAPHY.meta, flex: 1 },
});
