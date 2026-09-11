import React, { useState, useMemo, useEffect, useRef } from 'react';
import { View, FlatList, Text, Platform } from 'react-native';
import { useSpeechProjection } from '../../hooks/useApplicationProjection';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useKeyboardVisible } from '../../hooks/useKeyboardVisible';
import Icon from 'react-native-vector-icons/Feather';
import Animated, { FadeIn } from 'react-native-reanimated';
import {
  ChatInput,
  ThinkingIndicator,
  ModelFailureCard,
  ImageGenAdviceCard,
  MtpAdviceCard,
  VisionRepairAdviceCard,
} from '../../components';
import { AnimatedPressable } from '../../components/AnimatedPressable';
import { mobileChatSession } from './mobileChatSession';
import { EmptyChat, ImageProgressIndicator } from './ChatScreenComponents';
import { getPlaceholderText, useChatScreen } from './useChatScreen';
import { createStyles } from './styles';
import { useTheme } from '../../theme';
import { useAppStore } from '../../stores';
import { useEffectiveToolProjection } from '../../services/tools/useEffectiveToolProjection';
import { useOpenProTools } from '../../hooks/useOpenProTools';
import { useIsProActive } from '../../hooks/useIsProActive';
import { getSlot, SLOTS } from '../../bootstrap/slotRegistry';
import { useModelResidencyBusy } from '../../services/modelServices/useModelResidencyBusy';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../navigation/types';
import { SPACING } from '../../constants';

export type ChatMessageAreaProps = {
  flatListRef: React.RefObject<FlatList | null>;
  isNearBottomRef: React.MutableRefObject<boolean>;
  chat: ReturnType<typeof useChatScreen>;
  styles: ReturnType<typeof createStyles>;
  colors: ReturnType<typeof useTheme>['colors'];
  handleScroll: (event: any) => void;
  renderItem: (info: { item: any; index: number }) => React.JSX.Element;
};

// Keep the composer clear of the iPhone home indicator. The input owns its base padding;
// this footer adds one design-system spacing step on iOS and preserves the existing capped inset.
// It collapses while the keyboard is up so no gap opens above the keyboard.
//
// iOS reports its home-indicator overlay at about 34px on many devices. Android can
// report a similarly tall inset for an opaque 3-button navigation bar. The size
// alone cannot distinguish them: iOS is always an overlay here, while only Android
// needs the tall-inset exception for real navigation controls.
const FOOTER_SAFE_CAP = 4;
const IOS_COMPOSER_LIFT = SPACING.sm;
// Home-indicator / gesture-nav overlays sit at ~24px or below on the devices we
// target; a 3-button nav bar is taller. Above this, treat the inset as opaque.
const OVERLAY_INSET_MAX = 24;
export const computeFooterPaddingBottom = (
  keyboardVisible: boolean,
  insetBottom: number,
  platform: typeof Platform.OS = Platform.OS,
): number => {
  if (keyboardVisible) return 0;
  if (platform === 'ios')
    return IOS_COMPOSER_LIFT + Math.min(insetBottom, FOOTER_SAFE_CAP);
  // Opaque nav bar (tall inset): pad the full inset so controls clear it.
  if (insetBottom > OVERLAY_INSET_MAX) return insetBottom;
  // Thin overlay inset: keep the symmetric-with-top cap.
  return Math.min(insetBottom, FOOTER_SAFE_CAP);
};

// Show the "tap to continue" bar only when a text reply is genuinely PENDING — the
// selected text model was evicted AND the last message is an unanswered user turn.
// After a completed turn (text or image), the last message is an assistant reply, so
// the bar hides — it read as misplaced when it lingered after a finished image turn.
// Checking the tail role is modality-agnostic: any completed turn ends with 'assistant'.
export const shouldShowEvictedBar = (
  chat: ReturnType<typeof useChatScreen>,
): boolean => {
  if (!chat.textModelEvicted || chat.isModelLoading || chat.isCompacting)
    return false;
  if (chat.isGeneratingImage) return false;
  if (!chat.activeModelId || chat.activeModelInfo?.isRemote) return false;
  // A user turn the shared session recorded as an IMAGE turn (stopped or failed) is not waiting
  // for a text reply either, so the text model's absence is not what the person needs told.
  const last = chat.displayMessages[chat.displayMessages.length - 1];
  return last?.role === 'user' && last.turnKind !== 'image';
};

// "Model unloaded to free memory — tap to continue": the active text model was evicted
// (e.g. an image/TTS load in voice mode) but stays selected. Tapping reloads it.
const ModelEvictedBar: React.FC<{
  visible: boolean;
  onPress: () => void;
  styles: any;
  colors: any;
}> = ({ visible, onPress, styles, colors }) => {
  if (!visible) return null;
  return (
    <Animated.View entering={FadeIn.duration(200)}>
      <AnimatedPressable style={styles.pendingSettingsBar} onPress={onPress}>
        <Icon name="cpu" size={16} color={colors.warning} />
        <Text style={styles.pendingSettingsText}>
          Model unloaded to free memory — tap to continue
        </Text>
        <Icon name="refresh-cw" size={14} color={colors.warning} />
      </AnimatedPressable>
    </Animated.View>
  );
};

// Small status bar above the input: classifying takes precedence over the
// background model-load indicator.
const ModelStatusBar: React.FC<{
  loading: boolean;
  classifying: boolean;
  modelName?: string;
  styles: any;
}> = ({ loading, classifying, modelName, styles }) => {
  // The app's OWN "working" indicator, not the platform ActivityIndicator. On Android that renders a
  // Material arc whose tapered end reads as a static rotate glyph — the bar looked like it was
  // offering a retry button rather than telling you a model was loading (device-confirmed). The
  // pulsing dots are the same thing the reply bubble uses while the model works, so "working" looks
  // the same everywhere and can never be mistaken for something to press.
  if (classifying) {
    return (
      <View style={styles.classifyingBar}>
        <ThinkingIndicator
          text="Understanding your request..."
          textStyle={styles.classifyingText}
        />
      </View>
    );
  }
  if (loading) {
    return (
      <View style={styles.classifyingBar}>
        <ThinkingIndicator
          text={modelName ? `Loading ${modelName}...` : 'Loading model...'}
          textStyle={styles.classifyingText}
        />
      </View>
    );
  }
  return null;
};

// FlatList is a PureComponent: an inline literal or arrow here is a NEW prop on every render, so
// it re-renders every mounted cell. These do not depend on render state, so they are declared once.
const keyExtractor = (item: { id: string }) => item.id;
const MAINTAIN_VISIBLE_CONTENT_POSITION = {
  minIndexForVisible: 0,
  autoscrollToTopThreshold: 100,
};
const REMOVE_CLIPPED_SUBVIEWS = Platform.OS !== 'android';

export const ChatMessageArea: React.FC<ChatMessageAreaProps> = ({
  flatListRef,
  isNearBottomRef,
  chat,
  styles,
  colors,
  handleScroll,
  renderItem,
}) => {
  const hasScrolledRef = React.useRef(false);
  const voiceMode = useSpeechProjection().preferences.voiceMode;
  // Switching to voice loads the voice model (about 15 s on a phone). The list must not go quiet
  // for that long: say what is happening, above whatever is already on screen.
  const voiceBusy = useModelResidencyBusy('voice');
  const preparingVoice = voiceMode && voiceBusy;
  const tabNav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const toolCountHintDismissed = useAppStore(s => s.toolCountHintDismissed);
  // Pro activation registers tool adapters. Shared's effective-tool projection subscribes to that
  // registry; this hook is still needed to activate the lazy Pro composition itself.
  useIsProActive();
  const effectiveTools = useEffectiveToolProjection();
  const freeToolsCount = effectiveTools.counts.builtIn;
  const proToolsCount =
    effectiveTools.counts.pro + effectiveTools.counts.remote;
  const totalToolCount = effectiveTools.counts.total;
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
  const footerPaddingBottom = computeFooterPaddingBottom(
    keyboardVisible,
    insets.bottom,
    Platform.OS,
  );
  const isStreaming = chat.isStreaming;
  const prevIsStreamingRef = useRef(isStreaming);
  useEffect(() => {
    prevIsStreamingRef.current = isStreaming;
  }, [isStreaming]);
  const activeModelRepoId = chat.activeModelId
    ?.split('/')
    .slice(0, 2)
    .join('/');
  const handleRepairVision = activeModelRepoId
    ? () => tabNav.navigate('DownloadManager')
    : undefined;
  // Both depend only on refs, so they are created once and the list never sees a changed prop.
  const handleContentSizeChange = React.useCallback(
    (_width: number, height: number) => {
      if (!hasScrolledRef.current && height > 0) {
        // Initial layout: force scroll to bottom regardless of isNearBottom
        flatListRef.current?.scrollToEnd({ animated: false });
        hasScrolledRef.current = true;
      } else if (isNearBottomRef.current) {
        flatListRef.current?.scrollToEnd({ animated: false });
      }
    },
    [flatListRef, isNearBottomRef],
  );
  const handleListLayout = React.useCallback(
    (event: { nativeEvent: { layout: { height: number } } }) => {
      const newHeight = event.nativeEvent.layout.height;
      const prevHeight = flatListHeightRef.current;
      flatListHeightRef.current = newHeight;
      if (prevHeight > 0 && newHeight < prevHeight) {
        setTimeout(
          () => flatListRef.current?.scrollToEnd({ animated: true }),
          50,
        );
      }
    },
    [flatListRef],
  );
  const scrollToBottomStyle = useMemo(
    () => [styles.scrollToBottomContainer, { bottom: inputHeight + 8 }],
    [styles.scrollToBottomContainer, inputHeight],
  );
  return (
    <>
      {preparingVoice ? (
        <View testID="voice-preparing" style={styles.voicePreparingRow}>
          <ThinkingIndicator text="Preparing voice…" />
        </View>
      ) : null}
      {chat.displayMessages.length === 0 ? (
        // Voice mode gets its own welcome hero (big "tap to speak" mic); free
        // builds / chat mode fall back to the standard empty chat.
        (() => {
          const AudioEmpty = getSlot(SLOTS.chatEmptyAudio);
          return AudioEmpty && voiceMode ? (
            <AudioEmpty />
          ) : (
            <EmptyChat
              styles={styles}
              colors={colors}
              activeModel={chat.activeModel}
              activeModelName={chat.activeModelName}
              activeProject={chat.activeProject}
              setShowProjectSelector={chat.setShowProjectSelector}
            />
          );
        })()
      ) : (
        <FlatList
          testID="chat-message-list"
          ref={flatListRef}
          data={chat.displayMessages}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          extraData={voiceMode}
          contentContainerStyle={styles.messageList}
          onScroll={handleScroll}
          onContentSizeChange={handleContentSizeChange}
          onLayout={handleListLayout}
          scrollEventThrottle={16}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          maintainVisibleContentPosition={MAINTAIN_VISIBLE_CONTENT_POSITION}
          removeClippedSubviews={REMOVE_CLIPPED_SUBVIEWS}
        />
      )}
      {chat.showScrollToBottom && chat.displayMessages.length > 0 && (
        <Animated.View
          entering={FadeIn.duration(150)}
          style={scrollToBottomStyle}
        >
          <AnimatedPressable
            hapticType="impactLight"
            style={styles.scrollToBottomButton}
            onPress={() => flatListRef.current?.scrollToEnd({ animated: true })}
          >
            <Icon name="chevron-down" size={20} color={colors.textSecondary} />
          </AnimatedPressable>
        </Animated.View>
      )}
      {chat.isGeneratingImage && (
        <ImageProgressIndicator
          styles={styles}
          colors={colors}
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
        modelName={chat.loadingModelName}
        styles={styles}
      />
      {chat.isCompacting && (
        <Animated.View
          entering={FadeIn.duration(200)}
          style={styles.classifyingBar}
        >
          <ThinkingIndicator text="Compacting your conversation..." />
        </Animated.View>
      )}
      {/* Everything between the list and the composer is one stack, ordered by SHAPE, not by
          when it was added: rounded cards first, then the flat full-bleed bars directly above
          the composer. A flat bar carries a top border edge-to-edge, so putting one above a
          rounded card draws a hard rule across the card's top corners and the card reads as
          clipped. Cards on top, bars at the bottom, and each group keeps its own order. */}
      {/* Single dismissible surface for every model failure (text/image/tts/stt/
          embedding). Reads modelFailureStore itself — no props. */}
      <ModelFailureCard />
      {/* GPU-path (no-NPU) image tips — shown in chat (not buried in settings) so a user
          hitting slow/garbled generations sees the fix. Self-hides at good settings. */}
      <ImageGenAdviceCard />
      {/* The settings facade owns the setting commit and any required model restart. */}
      <MtpAdviceCard />
      {/* A vision model missing its projector: repairable from here, because this is where the
          user finds out they cannot attach a photo. */}
      <VisionRepairAdviceCard onRepaired={chat.handleReloadTextModel} />
      {chat.hasPendingSettings &&
        !chat.isCompacting &&
        !chat.activeModelInfo?.isRemote && (
          <Animated.View entering={FadeIn.duration(200)}>
            <AnimatedPressable
              testID="reload-model-banner"
              style={styles.pendingSettingsBar}
              onPress={chat.handleReloadTextModel}
            >
              <Icon name="alert-circle" size={16} color={colors.warning} />
              <Text style={styles.pendingSettingsText}>
                Settings changed — tap to reload model
              </Text>
              <Icon name="refresh-cw" size={14} color={colors.warning} />
            </AnimatedPressable>
          </Animated.View>
        )}
      {/* Text model evicted to free RAM (e.g. voice-mode image/TTS load) but still
          selected — reload it on demand, even a large model. This flat "tap to continue"
          snackbar sits directly above the composer, BELOW the rounded cards. */}
      <ModelEvictedBar
        visible={shouldShowEvictedBar(chat)}
        onPress={chat.handleReloadTextModel}
        styles={styles}
        colors={colors}
      />
      <View
        onLayout={e => setInputHeight(e.nativeEvent.layout.height)}
        style={{
          backgroundColor: colors.background,
          paddingBottom: footerPaddingBottom,
        }}
      >
        <ChatInput
          onSend={chat.handleSend}
          onStop={chat.handleStop}
          disabled={!chat.hasActiveModel}
          isGenerating={chat.isGeneratingForThisConversation}
          supportsVision={chat.supportsVision}
          visionNeedsRepair={chat.visionNeedsRepair}
          conversationId={chat.activeConversationId}
          imageModelLoaded={chat.imageModelLoaded}
          onOpenSettings={() => chat.setShowSettingsPanel(true)}
          queueCount={chat.queueCount}
          queuedTexts={chat.queuedTexts}
          onClearQueue={() => mobileChatSession.clearQueued()}
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
          isRemote={chat.activeModelInfo.isRemote}
          onImagePress={chat.handleImagePress}
        />
      </View>
    </>
  );
};
