import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  View,
  FlatList,
  Text,
  Platform,
} from 'react-native';
import { LIST_CLIPPING_PROPS } from '../../constants/listClipping';
import { useUiModeStore } from '../../stores/uiModeStore';
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
  RequiredThinkingAdviceCard,
  VisionRepairAdviceCard,
} from '../../components';
import { AnimatedPressable } from '../../components/AnimatedPressable';
import { generationService } from '../../services';
import type { QueueActions } from '../../components/ChatInput/Toolbar';
import { RestyleSheet } from '../../components/MediaStyles/RestyleSheet';
import { EmptyChat, ImageProgressIndicator } from './ChatScreenComponents';
import { getPlaceholderText, useChatScreen } from './useChatScreen';
import { createStyles } from './styles';
import { useTheme } from '../../theme';
import { useAppStore } from '../../stores';
import { getToolExtensions } from '../../services/tools/extensions';
import { enableAssistantTools, useAssistantToolAvailability, useExtensionToolCount } from '../../services/tools/useExtensionToolCount';
import { offeredTools } from '../../services/tools';
import { useOpenProTools } from '../../hooks/useOpenProTools';
import { useIsProActive } from '../../hooks/useIsProActive';
import { getSlot, useSlot, SLOTS } from '../../bootstrap/slotRegistry';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../navigation/types';
import { SPACING } from '../../constants';
import { proGateShown } from '../../services/analytics/analytics';
import { toolsForTurn, useHasSearchableKnowledge } from '../../services/documents/searchableKnowledge';

export type ChatMessageAreaProps = {
  assistantSelected: boolean;
  onAssistantSelectedChange: (selected: boolean) => void;
  flatListRef: React.RefObject<FlatList | null>;
  isNearBottomRef: React.MutableRefObject<boolean>;
  chat: ReturnType<typeof useChatScreen>;
  styles: ReturnType<typeof createStyles>;
  colors: ReturnType<typeof useTheme>['colors'];
  handleScroll: (event: any) => void;
  renderItem: (info: { item: any; index: number }) => React.JSX.Element;
};

// The bottom gap below the input controls should visually MATCH the top gap
// (the ChatInput container's paddingTop = 12), not consume the full home-indicator
// safe-area inset — that made the bottom feel like a large dead band vs the top.
// The container already pads its bottom by 8, so cap the extra footer at 4 → 12
// total, symmetric with the top. Collapses to 0 while the keyboard is up.
//
// BUT that cap only applies to a thin overlay inset (iOS home indicator / gesture
// nav), which draws *over* content. A 3-button navigation bar is opaque and owns
// real space at the bottom — capping there renders the input controls UNDER the
// nav buttons. We distinguish by the inset size (not Platform.OS): anything above
// the overlay threshold is a real nav bar, so honor the full inset and clear it.
const FOOTER_SAFE_CAP = 4;
const IOS_COMPOSER_LIFT = SPACING.sm;
// Home-indicator / gesture-nav overlays sit at ~24px or below on the devices we
// target; a 3-button nav bar is taller. Above this, treat the inset as opaque.
const OVERLAY_INSET_MAX = 24;
export const computeFooterPaddingBottom = (
  keyboardVisible: boolean,
  insetBottom: number,
): number => {
  if (keyboardVisible) return 0;
  if (Platform.OS === 'ios') return IOS_COMPOSER_LIFT + Math.min(insetBottom, FOOTER_SAFE_CAP);
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
  const last = chat.displayMessages[chat.displayMessages.length - 1];
  return last?.role === 'user';
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

/**
 * Compacting can take a minute on a phone (the model summarises the older turns). Say what it is for
 * and how long it has run, so the wait never looks stuck (hand test 23: 90 s of bare dots).
 */
const CompactingNote: React.FC = () => {
  const [seconds, setSeconds] = React.useState(0);
  React.useEffect(() => {
    const timer = setInterval(() => setSeconds(s => s + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <ThinkingIndicator
      text={`Making room for your answer by summarising earlier messages${seconds >= 5 ? ` · ${seconds} s` : '…'}`}
    />
  );
};

/** The chat list's position rule: keep the first visible row in place; never auto-scroll to the start. */
export const CHAT_LIST_KEEP_POSITION = { minIndexForVisible: 0 } as const;

const OPENING_HIDDEN = { opacity: 0 };
// Explicit, never undefined: a style that goes from opacity 0 to undefined keeps the 0 on Fabric,
// and the chat stayed blank (hand test 55).
const OPENING_SHOWN = { opacity: 1 };

export const ChatMessageArea: React.FC<ChatMessageAreaProps> = ({
  assistantSelected,
  onAssistantSelectedChange,
  flatListRef,
  isNearBottomRef,
  chat,
  styles,
  colors,
  handleScroll,
  renderItem,
}) => {
  const hasScrolledRef = React.useRef(false);
  // A chat opens at its newest message. The list renders in batches, so one scroll on the first
  // layout lands at the end of the first batch only; until you touch the list, every growth pins
  // it to the end again (hand test 51: a long chat opened from Home sat at its oldest message).
  const openingRef = React.useRef(true);
  // While a chat opens, rows above the end are still measuring. Keeping the first visible row in
  // place (maintainVisibleContentPosition) then pushes the end out of view, so it is switched on
  // only once the content has stopped growing (hand test 53: a cold open sat two turns short).
  const [settled, setSettled] = useState(false);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(() => {
    openingRef.current = true;
    hasScrolledRef.current = false;
    setSettled(false);
    // Never hidden for long: whatever the content does, the list shows within 800 ms.
    const fallback = setTimeout(() => setSettled(true), 800);
    return () => {
      clearTimeout(fallback);
      if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    };
  }, [chat.activeConversationId]);
  const interfaceMode = useUiModeStore(s => s.interfaceMode);
  const tabNav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const toolCountHintDismissed = useAppStore(state => state.toolCountHintDismissed);
  // Subscribe to Pro activation so this re-renders the moment a license is
  // activated. loadProFeatures() registers the tool extensions + the Pro Tools
  // screen in one pass; without this subscription the getToolExtensions() reads
  // below are non-reactive and the Pro Tools badge stayed stale until an app
  // restart. Return is intentionally unused — the count is naturally 0 when Pro
  // is inactive (no extensions registered); we only need the re-render.
  const isProActive = useIsProActive();
  const queueActions: QueueActions = {
    onSendNow: id => {
      chat.handleSendQueuedNow(id);
    },
    onRemove: id => generationService.removeFromQueue(id),
    onResume: () => generationService.resumeQueue(),
    onClear: () => generationService.clearQueue(),
  };
  const assistantAvailability = useAssistantToolAvailability();
  // extToolCount is the live MCP tool count (the email/calendar extension reports 0
  // here because those live in settings.enabledTools — see EmailCalendarExtension).
  // Subscribed, not read at render: deactivating an MCP server cleared the store but the mounted
  // chat never re-rendered, so the badge said 3 while the Pro tools screen said none.
  const extToolCount = useExtensionToolCount();
  // Pro tools (email/calendar) are toggled through settings.enabledTools, so count
  // how many of them are on and fold MCP in — this is the "Pro Tools" badge.
  const searchableKnowledge = useHasSearchableKnowledge(chat.activeConversation);
  const proToolIds = getToolExtensions().flatMap(e =>
    (e.getToolDefinitions?.() ?? []).map(t => t.id),
  );
  const proToolsActiveCount = proToolIds.filter(id =>
    chat.enabledTools.includes(id),
  ).length;
  const proToolsCount = proToolsActiveCount + extToolCount;
  // The free Tools page lists only the tools offered now, so its badge counts just those
  // (pro email/calendar ids are surfaced under Pro Tools instead, not double-counted; the video
  // tool counts only while Pro video is on).
  const freeToolIds = new Set(offeredTools().map(t => t.id));
  // The same rule the turn sends by: knowledge search counts only when there is something to search.
  const freeToolsCount = toolsForTurn(chat.enabledTools, searchableKnowledge).filter(id =>
    freeToolIds.has(id),
  ).length;
  const totalToolCount = freeToolsCount + proToolsCount;
  const handleProToolsPress = useOpenProTools();
  const showSettingsDot = totalToolCount > 3 && !toolCountHintDismissed;
  const [inputHeight, setInputHeight] = useState(84);
  const flatListHeightRef = useRef(0);
  const generationWasActiveRef = useRef(false);
  const userScrolledDuringGenerationRef = useRef(false);

  // Your own message comes into view the moment you send it: a sent message is the one thing you
  // always want to see, whatever the list was doing (hand test 50: out of view ~5 s, keyboard up).
  // Keyed on the newest USER message, not the last row: a thinking row lands in the same render as
  // the sent message, so the sent one is never last (hygiene found this; the scroll never ran).
  const lastSentId = useMemo(() => {
    for (let i = chat.displayMessages.length - 1; i >= 0; i -= 1) {
      if (chat.displayMessages[i].role === 'user') return chat.displayMessages[i].id;
    }
    return undefined;
  }, [chat.displayMessages]);
  useEffect(() => {
    if (!lastSentId) return;
    userScrolledDuringGenerationRef.current = false;
    requestAnimationFrame(() => flatListRef.current?.scrollToEnd({ animated: true }));
  }, [lastSentId, flatListRef]);

  // Bottom safe-area for the input footer. We own it here (rather than on the
  // screen's SafeAreaView) so the inset replaces — not stacks on top of — the
  // input's own bottom padding, and collapses while the keyboard is open (the
  // keyboard already covers the home-indicator / gesture area). Using the live
  // inset value keeps this correct on both iOS and Android without any
  // Platform.OS layout branching.
  const insets = useSafeAreaInsets();
  // Video is Pro: its live status fills this slot; free builds render nothing here.
  const VideoStatus = useSlot(SLOTS.videoStatus);
  const keyboardVisible = useKeyboardVisible();
  const footerPaddingBottom = computeFooterPaddingBottom(
    keyboardVisible,
    insets.bottom,
  );
  const isStreaming = chat.isStreaming || chat.isThinking;
  const prevIsStreamingRef = useRef(isStreaming);
  useEffect(() => {
    prevIsStreamingRef.current = isStreaming;
  }, [isStreaming]);
  useEffect(() => {
    if (
      chat.isGeneratingForThisConversation &&
      !generationWasActiveRef.current
    ) {
      userScrolledDuringGenerationRef.current = false;
    }
    generationWasActiveRef.current = chat.isGeneratingForThisConversation;
  }, [chat.isGeneratingForThisConversation]);
  const activeModelRepoId = chat.activeModelId
    ?.split('/')
    .slice(0, 2)
    .join('/');
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
          return AudioEmpty && interfaceMode === 'audio' ? (
            <AudioEmpty />
          ) : (
            <EmptyChat
              styles={styles}
              colors={colors}
              activeModel={chat.activeModel}
              activeModelName={chat.activeModelName}
              activeProject={chat.activeProject}
              setShowProjectSelector={chat.setShowProjectSelector}
              isRemote={chat.activeModelInfo?.isRemote}
              // Starters are text prompts, so they need a text model: with only an image model a tap drew a picture.
              onStarter={chat.hasTextModel && !chat.isModelLoading ? prompt => chat.handleSend(prompt) : undefined}
            />
          );
        })()
      ) : (
        <FlatList
          testID="chat-message-list"
          ref={flatListRef}
          // Drawn once it rests at the newest message, so an opening chat never shows old turns
          // and then jumps (hand test 54: at 1 s a cold open still showed 5:07).
          style={settled ? OPENING_SHOWN : OPENING_HIDDEN}
          data={chat.displayMessages}
          renderItem={renderItem}
          keyExtractor={item => item.id}
          extraData={interfaceMode}
          ListFooterComponent={
            VideoStatus ? <VideoStatus conversationId={chat.activeConversationId} /> : null
          }
          contentContainerStyle={styles.messageList}
          onScroll={handleScroll}
          onContentSizeChange={(_w, h) => {
            if (openingRef.current && h > 0) {
              flatListRef.current?.scrollToEnd({ animated: false });
              // Settled once the content has not grown for 400 ms: one last scroll, then the list
              // keeps a reader's place as usual.
              if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
              settleTimerRef.current = setTimeout(() => {
                if (openingRef.current) flatListRef.current?.scrollToEnd({ animated: false });
                setSettled(true);
              }, 400);
              hasScrolledRef.current = true;
            } else if (!hasScrolledRef.current && h > 0) {
              // Initial layout: force scroll to bottom regardless of isNearBottom
              flatListRef.current?.scrollToEnd({ animated: false });
              hasScrolledRef.current = true;
            } else if (
              isNearBottomRef.current ||
              (chat.isGeneratingForThisConversation &&
                !userScrolledDuringGenerationRef.current)
            ) {
              flatListRef.current?.scrollToEnd({ animated: false });
            }
          }}
          onScrollBeginDrag={() => {
            openingRef.current = false;
            if (chat.isGeneratingForThisConversation) {
              userScrolledDuringGenerationRef.current = true;
            }
          }}
          onLayout={e => {
            const newHeight = e.nativeEvent.layout.height;
            const prevHeight = flatListHeightRef.current;
            flatListHeightRef.current = newHeight;
            if (prevHeight > 0 && newHeight < prevHeight) {
              setTimeout(
                () => flatListRef.current?.scrollToEnd({ animated: true }),
                50,
              );
            }
          }}
          scrollEventThrottle={16}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          // Keep the reader's place when rows above them change, and nothing more. No
          // autoscrollToTopThreshold: that option is for inverted lists, where the top is the
          // newest message. In this list the top is the OLDEST message, so whenever the offset sat
          // within 100 pt of the start (a short chat, or any chat once the keyboard shrinks the
          // list) iOS jumped to the first message on each content change, against scrollToEnd,
          // and a streaming reply stayed out of view (hand test, iPhone, keyboard up).
          maintainVisibleContentPosition={settled ? CHAT_LIST_KEEP_POSITION : undefined}
          {...LIST_CLIPPING_PROPS}
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
        modelName={chat.loadingModel?.name}
        styles={styles}
      />
      {chat.isCompacting && (
        <Animated.View
          entering={FadeIn.duration(200)}
          style={styles.classifyingBar}
        >
          <CompactingNote />
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
      {/* Reload through the SAME seam the reload banner uses — one owner of "reload the text model". */}
      <MtpAdviceCard onEnable={chat.handleReloadTextModel} />
      <RequiredThinkingAdviceCard
        modelName={chat.activeModelName}
        required={Boolean(
          chat.activeRemoteModel?.capabilities.thinkingLevelsOnly,
        )}
      />
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
        style={{ backgroundColor: colors.background }}
      >
        <RestyleSheet
          onSend={(prompt, kind) => chat.handleSend(prompt, undefined, kind === 'video' ? 'video' : 'force')}
        />
        <ChatInput
          assistantSelected={assistantSelected}
          onAssistantSelectedChange={onAssistantSelectedChange}
          onSend={chat.handleSend}
          onStop={chat.handleStop}
          disabled={!chat.hasActiveModel}
          isGenerating={
            chat.isGeneratingForThisConversation || chat.isStreaming || chat.isThinking
          }
          supportsVision={chat.supportsVision}
          visionNeedsRepair={chat.visionNeedsRepair}
          conversationId={chat.activeConversationId}
          bottomInset={footerPaddingBottom}
          imageModelLoaded={chat.imageModelLoaded}
          onOpenSettings={() => chat.setShowSettingsPanel(true)}
          queue={chat.queue}
          queueActions={queueActions}
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
          assistantAvailability={
            !isProActive
              ? 'no-pro'
              : assistantAvailability
          }
          onAssistantEnableTools={enableAssistantTools}
          onAssistantUpgrade={() => {
            proGateShown('assistant');
            tabNav.navigate('ProDetail');
          }}
          onAssistantSetupSync={() => tabNav.navigate('Sync')}
          onFindComputer={() => tabNav.navigate('RemoteServers')}
          onGetVideoModel={() => tabNav.navigate('Main', { screen: 'ModelsTab', params: { initialTab: 'video' } })}
          onVideoUpgrade={() => {
            proGateShown('video');
            tabNav.navigate('ProDetail');
          }}
        />
      </View>
    </>
  );
};
