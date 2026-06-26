import React, { useState, useMemo, useEffect, useRef } from 'react';
import { View, FlatList, Text, Keyboard, ActivityIndicator, Platform, StyleSheet } from 'react-native';
import { useUiModeStore } from '../../stores/uiModeStore';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useKeyboardVisible } from '../../hooks/useKeyboardVisible';
import Icon from 'react-native-vector-icons/Feather';
import Animated, { FadeIn } from 'react-native-reanimated';
import { AttachStep } from 'react-native-spotlight-tour';
import { ChatInput, ThinkingIndicator } from '../../components';
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
import { AVAILABLE_TOOLS } from '../../services/tools';
import { useOpenProTools } from '../../hooks/useOpenProTools';
import { getSlot, SLOTS } from '../../bootstrap/slotRegistry';
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

// The ChatInput container already pads its bottom by this much; subtracting it
// makes the footer's total bottom space equal the safe-area inset (not inset +
// pad), so the bar clears the home indicator with no extra gap. Collapses to 0
// while the keyboard is up, since the keyboard covers the safe area.
const INPUT_FOOTER_BASE_PAD = 8;
const computeFooterPaddingBottom = (keyboardVisible: boolean, insetBottom: number): number =>
  keyboardVisible ? 0 : Math.max(insetBottom - INPUT_FOOTER_BASE_PAD, 0);

// Small status bar above the input: classifying takes precedence over the
// background model-load indicator.
const ModelStatusBar: React.FC<{ loading: boolean; classifying: boolean; modelName?: string; styles: any; colors: any }> = ({
  loading, classifying, modelName, styles, colors,
}) => {
  if (classifying) {
    return (
      <View style={styles.classifyingBar}>
        <ActivityIndicator size="small" color={colors.primary} />
        <Text style={styles.classifyingText}>Understanding your request...</Text>
      </View>
    );
  }
  if (loading) {
    return (
      <View style={styles.classifyingBar}>
        <ActivityIndicator size="small" color={colors.primary} />
        <Text style={styles.classifyingText}>{modelName ? `Loading ${modelName}...` : 'Loading model...'}</Text>
      </View>
    );
  }
  return null;
};

export const ChatMessageArea: React.FC<ChatMessageAreaProps> = ({
  flatListRef, isNearBottomRef, chat, styles, colors, handleScroll, renderItem, chatSpotlight,
}) => {
  // Hide FlatList until initial layout + scroll is complete to prevent visible scroll jump
  const [isListReady, setIsListReady] = useState(false);
  const hasScrolledRef = React.useRef(false);
  const interfaceMode = useUiModeStore((s) => s.interfaceMode);
  const tabNav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { toolCountHintDismissed } = useAppStore();
  // extToolCount is the live MCP tool count (the email/calendar extension reports 0
  // here because those live in settings.enabledTools — see EmailCalendarExtension).
  const extToolCount = getToolExtensions().reduce((n, e) => n + e.enabledToolCount(), 0);
  // Pro tools (email/calendar) are toggled through settings.enabledTools, so count
  // how many of them are on and fold MCP in — this is the "Pro Tools" badge.
  const proToolIds = getToolExtensions().flatMap(e => (e.getToolDefinitions?.() ?? []).map(t => t.id));
  const proToolsActiveCount = proToolIds.filter(id => chat.enabledTools.includes(id)).length;
  const proToolsCount = proToolsActiveCount + extToolCount;
  // The free Tools page lists only AVAILABLE_TOOLS, so its badge counts just those
  // (pro email/calendar ids are surfaced under Pro Tools instead, not double-counted).
  const freeToolIds = new Set(AVAILABLE_TOOLS.map(t => t.id));
  const freeToolsCount = chat.enabledTools.filter(id => freeToolIds.has(id)).length;
  const totalToolCount = freeToolsCount + proToolsCount;
  const handleProToolsPress = useOpenProTools();
  const showSettingsDot = totalToolCount > 3 && !toolCountHintDismissed;
  const [inputHeight, setInputHeight] = useState(84);
  const flatListHeightRef = useRef(0);

  // Bottom safe-area for the input footer. We own it here (rather than on the
  // screen's SafeAreaView) so the inset replaces — not stacks on top of — the
  // input's own bottom padding, and collapses while the keyboard is open (the
  // keyboard already covers the home-indicator / gesture area). Using the live
  // inset value keeps this correct on both iOS and Android without any
  // Platform.OS layout branching.
  const insets = useSafeAreaInsets();
  const keyboardVisible = useKeyboardVisible();
  const footerPaddingBottom = computeFooterPaddingBottom(keyboardVisible, insets.bottom);
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
        // Voice mode gets its own welcome hero (big "tap to speak" mic); free
        // builds / chat mode fall back to the standard empty chat.
        (() => {
          const AudioEmpty = getSlot(SLOTS.chatEmptyAudio);
          return AudioEmpty && interfaceMode === 'audio' ? <AudioEmpty /> : (
        <EmptyChat
          styles={styles} colors={colors}
          activeModel={chat.activeModel}
          activeModelName={chat.activeModelName}
          activeProject={chat.activeProject}
          setShowProjectSelector={chat.setShowProjectSelector}
          isRemote={chat.activeModelInfo?.isRemote}
        />
          );
        })()
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
      <ModelStatusBar
        // While generating for this chat the loading state is shown inside the
        // reply bubble ("Loading <model>…"), so don't also show it in this bar.
        loading={chat.isModelLoading && !chat.isGeneratingForThisConversation}
        classifying={chat.isClassifying}
        modelName={chat.loadingModel?.name}
        styles={styles}
        colors={colors}
      />
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
            OpenCL is not recommended. Switch to CPU in Settings, or use a LiteRT model for GPU support.
          </Text>
        </View>
      )}
      {/* Steps 3/15 share the same AttachStep wrapping ChatInput (multi-index).
         Steps 12/16 are handled inside ChatInput via activeSpotlight prop. */}
      <View
        onLayout={(e) => setInputHeight(e.nativeEvent.layout.height)}
        style={{ backgroundColor: colors.background, paddingBottom: footerPaddingBottom }}
      >
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
            onToolsPress={() => tabNav.navigate('Tools')}
            enabledToolCount={freeToolsCount}
            showSettingsDot={showSettingsDot}
            mcpToolCount={proToolsCount}
            onMcpPress={handleProToolsPress}
            supportsToolCalling={chat.supportsToolCalling}
            supportsThinking={chat.supportsThinking}
            onRepairVision={handleRepairVision}
            activeSpotlight={chatSpotlight === 12 ? chatSpotlight : null}
          />
        </AttachStep>
      </View>
    </>
  );
};

const openCLBannerStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm },
  text: { ...TYPOGRAPHY.meta, flex: 1 },
});

const hiddenStyle = StyleSheet.create({
  hidden: { opacity: 0 },
});
