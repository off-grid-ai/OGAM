import { videoModelDisplayName } from '../../utils/modelHelpers';
import { useAppStore } from '../../stores/appStore';
import React from 'react';
import { View, Text, Image } from 'react-native';
import Animated from 'react-native-reanimated';
import { TouchableOpacity } from '../../components/Touchable';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';
import {
  Button,
  Card,
  CustomAlert,
  hideAlert,
  ModelSelectorModal,
} from '../../components';
import { AnimatedEntry } from '../../components/AnimatedEntry';
import { AnimatedPressable } from '../../components/AnimatedPressable';
import { LivingField } from '../../components/LivingField';
import { useAliveScrollRef } from '../../components/AliveProvider';
import { ListGroup } from '../../components/ListGroup';
import { useFocusTrigger } from '../../hooks/useFocusTrigger';
import Icon from 'react-native-vector-icons/Feather';
import IconMC from 'react-native-vector-icons/MaterialCommunityIcons';
import { useThemedStyles, useTheme } from '../../theme';
import { createStyles } from './styles';
import { useHomeScreen, HomeScreenNavigationProp } from './hooks/useHomeScreen';
import { RecentConversations } from './components/RecentConversations';
import { LoadingOverlay } from './components/LoadingOverlay';
import { DesktopPromoCard } from './components/DesktopPromoCard';
import { FeatureShowcase, featuresToTry } from './components/FeatureShowcase';
import { ModelsSummaryRow } from '../../components/models/ModelsSummaryRow';
import {
  ModelsManagerSheet,
  ModelRowType,
  type ModelRowLabels,
} from '../../components/models/ModelsManagerSheet';
import { useSearchModelLabel } from '../../hooks/useSearchModelLabel';
import { WhisperPickerSheet } from '../../components/models/WhisperPickerSheet';
import { VoiceModelsSheet } from '../../components/models/VoiceModelsSheet';
import { useWhisperStore } from '../../stores/whisperStore';
import { WHISPER_MODELS } from '../../services';
import { transcriptionModelName } from '../../services/whisperModels';
import { useWithRemoteCatalog } from '../../stores/modelCatalogStore';
import { useUiModeStore } from '../../stores/uiModeStore';
import { SLOTS, useSlot } from '../../bootstrap/slotRegistry';
import { useOpenSync } from '../../hooks/useOpenSync';
import { useActiveRemoteModelLabels } from '../../hooks/useActiveRemoteModelLabels';
import { openSupportEmail } from '../../utils/supportEmail';
import { SCROLL_DEPTH_PROPS } from '../../constants/scrollDepth';

type HomeScreenProps = {
  navigation: HomeScreenNavigationProp;
};

function homeModelLabels(input: {
  text?: string;
  image?: string;
  video?: string;
  voice?: string | null;
  transcription?: string | null;
  localVoice?: string | null;
  localTranscription?: string;
  search?: string;
}): ModelRowLabels {
  return {
    text: input.text ?? '—',
    image: input.image ?? '—',
    video: input.video ?? '—',
    voice: input.voice ?? input.localVoice ?? '—',
    speech: input.transcription ?? input.localTranscription ?? '—',
    search: input.search,
  };
}

export const HomeScreen: React.FC<HomeScreenProps> = ({ navigation }) => {
  const focusTrigger = useFocusTrigger();
  const isFocused = useIsFocused();
  const scrollRef = useAliveScrollRef();
  const { colors, isDark } = useTheme();
  const styles = useThemedStyles(createStyles);
  const SyncHomeCard = useSlot(SLOTS.homeSyncCard);
  const HomeNotificationsButton = useSlot(SLOTS.homeNotificationsButton);
  const { isSyncUnlocked, openSync, openSyncNotifications } = useOpenSync();

  const {
    pickerType,
    setPickerType,
    loadingState,
    isEjecting,
    alertState,
    setAlertState,
    downloadedModels,
    activeModelId,
    downloadedImageModels,
    activeImageModelId,
    generatedImages,
    generatedVideos,
    conversationCount,
    activeTextModelId,
    activeTextModelName,
    activeImageModel,
    recentConversations,
    // Remote model state
    remoteTextModels,
    activeRemoteTextModelId,
    activeRemoteImageModelId,
    handleSelectTextModel,
    handleUnloadTextModel,
    handleSelectImageModel,
    handleUnloadImageModel,
    // Remote model handlers
    handleEjectAll,
    startNewChat,
    continueChat,
    handleDeleteConversation,
  } = useHomeScreen(navigation);

  // ── Collapsed Models control ──────────────────────────────────────────────
  const [modelsManagerOpen, setModelsManagerOpen] = React.useState(false);
  // Action queued by the manager (open a picker, or eject) — run only after the
  // manager sheet has fully closed, so we never present a second modal while
  // this one is mid-dismiss (that wedges iOS's modal system). Run from onClosed.
  const pendingAfterCloseRef = React.useRef<(() => void) | null>(null);
  const [whisperOpen, setWhisperOpen] = React.useState(false);
  const [voiceOpen, setVoiceOpen] = React.useState(false);
  const returnToModelsRef = React.useRef(false);
  const whisperModelId = useWhisperStore(s => s.downloadedModelId);
  // Re-render when the remote catalog renames a speech model.
  useWithRemoteCatalog('transcription', WHISPER_MODELS);
  const whisperPresentCount = useWhisperStore(
    s => s.presentModelIds?.length ?? 0,
  );
  const voiceSummary = useUiModeStore(s => s.voiceSummary);
  const remoteLabels = useActiveRemoteModelLabels();

  const videoLabel = useAppStore(s => {
    const model = s.downloadedVideoModels.find(m => m.id === s.activeVideoModelId);
    return model ? videoModelDisplayName(model.id, model.name) : undefined;
  });
  const searchLabel = useSearchModelLabel();
  const modelLabels = homeModelLabels({
    search: searchLabel,
    video: remoteLabels.video ?? videoLabel,
    text: activeTextModelId ? activeTextModelName : undefined,
    image: activeImageModel?.name,
    voice: remoteLabels.voice,
    transcription: remoteLabels.transcription,
    localVoice: voiceSummary,
    localTranscription: whisperModelId ? transcriptionModelName(whisperModelId) : undefined,
  });

  // Downloaded-model counts shown in the Models card (replaces the old stats row).
  const modelCounts: Partial<Record<ModelRowType, number>> = {
    video: useAppStore(s => s.downloadedVideoModels.length),
    text: downloadedModels.length,
    image: downloadedImageModels.length,
    speech: whisperPresentCount,
    voice: voiceSummary ? 1 : 0,
  };

  // The top of Home: what this person has not tried yet, each a tap that starts it.
  const showcase = featuresToTry(
    {
      imagesMade: generatedImages.length,
      videosMade: generatedVideos.length,
      hasVoice: (modelCounts.voice ?? 0) > 0,
      hasSpeech: (modelCounts.speech ?? 0) > 0,
    },
    {
      image: () => (downloadedImageModels.length > 0 ? startNewChat() : presentModelSheet('image')),
      video: () => ((modelCounts.video ?? 0) > 0 ? startNewChat() : presentModelSheet('video')),
      voice: () => presentModelSheet('voice'),
      speech: () => presentModelSheet('speech'),
    },
  );

  // Stash an action and close the manager; the action runs from the manager's
  // onClosed once it has fully dismissed — so opening a picker or the eject
  // confirmation never collides with the manager's own dismissal.
  const closeManagerThen = (action: () => void) => {
    pendingAfterCloseRef.current = action;
    setModelsManagerOpen(false);
  };

  const presentModelSheet = (type: ModelRowType) => {
    if (type === 'text') setPickerType('text');
    else if (type === 'image') setPickerType('image');
    else if (type === 'video') setPickerType('video');
    else if (type === 'speech') setWhisperOpen(true);
    else if (type === 'search') setPickerType('search');
    else setVoiceOpen(true);
  };
  const openModelRow = (type: ModelRowType) => {
    closeManagerThen(() => presentModelSheet(type));
  };

  const runPendingAfterClose = () => {
    const action = pendingAfterCloseRef.current;
    pendingAfterCloseRef.current = null;
    action?.();
  };

  const reopenModelsAfterChildClose = () => {
    if (!returnToModelsRef.current) return;
    returnToModelsRef.current = false;
    setModelsManagerOpen(true);
  };
  const closeChildForModels = (close: () => void) => {
    returnToModelsRef.current = true;
    close();
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View testID="home-screen" style={styles.scrollView}>
        <LivingField active={isFocused} />
        <Animated.ScrollView
          ref={scrollRef}
          {...SCROLL_DEPTH_PROPS}
          style={styles.scrollView}
          contentContainerStyle={styles.content}
        >
          {/* The app's name and mark, its promise, and New chat as the one main action. */}
          <View style={styles.header}>
            <View style={styles.titleRow}>
              {/* The brand mark beside its name, as on desktop's sidebar: the logo was lost in 5bed503e0. */}
              <View style={styles.brand}>
                <Image
                  source={isDark ? require('../../assets/home-logo-dark.png') : require('../../assets/home-logo-light.png')}
                  style={styles.appLogo}
                  resizeMode="contain"
                  accessible={false}
                  testID="home-app-logo"
                />
                <Text style={styles.title} accessibilityRole="header" numberOfLines={1}>Off Grid AI</Text>
              </View>
              <View style={styles.headerActions}>
                {HomeNotificationsButton ? (
                  <HomeNotificationsButton onOpen={openSyncNotifications} />
                ) : null}
                <TouchableOpacity
                  onPress={() => navigation.navigate('ProDetail')}
                  style={styles.crownButton}
                  accessibilityRole="button"
                  accessibilityLabel="Open Off Grid AI Pro"
                >
                  <IconMC name="crown" size={18} color={colors.textSecondary} />
                </TouchableOpacity>
              </View>
            </View>
            {/* Two rows (hand check 2026-11-06: one row cut the name to "Off Grid AI…"): the name with
                its icons above, the promise with the one main action below. */}
            <View style={styles.promiseRow}>
              <Text style={styles.subtitle}>Nothing you type leaves this phone.</Text>
              {activeTextModelId || activeImageModelId || remoteLabels.video || videoLabel ? (
                <Button
                  title="New chat"
                  variant="hero"
                  size="small"
                  icon={<Icon name="plus" size={16} color={colors.onHero} />}
                  onPress={startNewChat}
                  style={styles.newChatButton}
                  testID="new-chat-button"
                />
              ) : null}
            </View>
          </View>

          <FeatureShowcase features={showcase} active={isFocused} />

          {/* Collapsed Models summary — tap to open the manager sheet. Both the
              text (1) and image (13) tour steps anchor here now. */}
          <AnimatedEntry index={0} staggerMs={50} trigger={focusTrigger}>
            <ModelsSummaryRow
              labels={modelLabels}
              counts={modelCounts}
              isLoading={loadingState.isLoading}
              onPress={() => setModelsManagerOpen(true)}
              onPressType={presentModelSheet}
            />
          </AnimatedEntry>

          {/* With no model there is nothing to chat with yet: say how to get one. */}
          {activeTextModelId || activeImageModelId || remoteLabels.video || videoLabel ? null : (
            <Card style={styles.setupCard} testID="setup-card">
              <Text style={styles.setupText}>
                {downloadedModels.length > 0 || remoteTextModels.length > 0
                  ? 'Select a text, image, or video model to start'
                  : 'Choose a model here or on your network.'}
              </Text>
              <View style={styles.setupActions}>
                <Button
                  title="Add Remote Server"
                  variant="outline"
                  size="small"
                  onPress={() => navigation.navigate('RemoteServers')}
                  testID="add-server-button"
                />
                <Button
                  title={
                    downloadedModels.length > 0 || remoteTextModels.length > 0
                      ? 'Select Model'
                      : 'Browse Models'
                  }
                  variant="outline"
                  size="small"
                  onPress={() =>
                    downloadedModels.length > 0 || remoteTextModels.length > 0
                      ? setPickerType('text')
                      : navigation.navigate('ModelsTab', { initialTab: 'text' })
                  }
                  testID="browse-models-button"
                />
              </View>
            </Card>
          )}

          {/* Recent Conversations */}
          {recentConversations.length > 0 && (
            <AnimatedEntry index={2} staggerMs={50} trigger={focusTrigger}>
              <RecentConversations
                conversations={recentConversations}
                totalCount={conversationCount}
                focusTrigger={focusTrigger}
                onContinueChat={continueChat}
                onDeleteConversation={handleDeleteConversation}
                onSeeAll={() => navigation.navigate('ChatsTab')}
              />
            </AnimatedEntry>
          )}

          {/* After your recent work: Clipboard, Sync, Gallery and feedback in one surface with hairlines
              (desktop's one surface), not a stack of boxes. Pro's Sync slot renders bare rows. */}
          <AnimatedEntry index={5} staggerMs={50} trigger={focusTrigger}>
            <ListGroup style={styles.linksGroup}>
              {SyncHomeCard ? (
                <SyncHomeCard
                  isUnlocked={isSyncUnlocked}
                  onOpen={openSync}
                  onOpenClipboard={() =>
                    isSyncUnlocked
                      ? navigation.navigate('Clipboard' as never)
                      : navigation.navigate('ProDetail')
                  }
                />
              ) : null}
              <AnimatedPressable
                style={styles.galleryCard}
                onPress={() => navigation.navigate('Gallery')}
                hapticType="selection"
                testID="home-gallery-card"
                accessibilityRole="button"
                accessibilityLabel={`Gallery, ${generatedImages.length} images, ${generatedVideos.length} videos`}
              >
                <Icon name="grid" size={18} color={colors.textSecondary} />
                <View style={styles.galleryCardInfo}>
                  <Text style={styles.galleryCardTitle}>Gallery</Text>
                  <Text style={styles.galleryCardMeta}>
                    {generatedImages.length} images · {generatedVideos.length}{' '}
                    videos
                  </Text>
                </View>
                <Icon name="chevron-right" size={16} color={colors.textMuted} />
              </AnimatedPressable>
              <View style={styles.supportCard} testID="home-support-card">
                <Icon name="message-square" size={18} color={colors.textSecondary} />
                <View style={styles.galleryCardInfo}>
                  <Text style={styles.supportTitle}>What should we build next?</Text>
                  <Text style={styles.supportDescription}>
                    Tell us what you would like to see in Off Grid AI Mobile.
                  </Text>
                </View>
                <Button
                  title="Write to us"
                  variant="outline"
                  size="small"
                  onPress={() =>
                    openSupportEmail({
                      subject: '[Idea] Off Grid AI Mobile',
                      body: 'Hi,\n\nI would like to see this in Off Grid AI Mobile:\n\n',
                    })
                  }
                  testID="home-support-email"
                />
              </View>
            </ListGroup>
          </AnimatedEntry>

          {/* Off Grid AI Desktop — live announcement; owns its own copy/dismiss state. */}
          <DesktopPromoCard />

          {/* Model Stats row removed — the per-type counts now live in the Models
              card above, and the chat count sits next to "See all". */}
        </Animated.ScrollView>
      </View>

      <ModelSelectorModal
        visible={pickerType !== null}
        initialTab={pickerType ?? 'text'}
        onClose={() => setPickerType(null)}
        onClosed={reopenModelsAfterChildClose}
        onBackToModels={() => closeChildForModels(() => setPickerType(null))}
        onSelectModel={handleSelectTextModel}
        onUnloadModel={handleUnloadTextModel}
        onSelectImageModel={handleSelectImageModel}
        onUnloadImageModel={handleUnloadImageModel}
        isLoading={loadingState.isLoading}
        onSelectionComplete={() => setPickerType(null)}
        onBrowseModels={tab => {
          setPickerType(null);
          navigation.navigate('ModelsTab', { initialTab: tab === 'search' ? 'embedding' : tab });
        }}
        onAddServer={() => navigation.navigate('RemoteServers')}
      />

      {/* Collapsed Models control: manager sheet + per-type pickers */}
      <ModelsManagerSheet
        visible={modelsManagerOpen}
        onClose={() => setModelsManagerOpen(false)}
        onClosed={runPendingAfterClose}
        labels={modelLabels}
        remote={{
          text: !!activeRemoteTextModelId,
          image: !!activeRemoteImageModelId,
          voice: !!remoteLabels.voice,
          speech: !!remoteLabels.transcription,
        }}
        loadingState={loadingState}
        isEjecting={isEjecting}
        hasActiveModel={
          !!(
            activeModelId ||
            activeImageModelId ||
            activeRemoteTextModelId ||
            activeRemoteImageModelId
          )
        }
        onOpenRow={openModelRow}
        onEject={() => closeManagerThen(handleEjectAll)}
      />
      <WhisperPickerSheet
        visible={whisperOpen}
        onClose={() => setWhisperOpen(false)}
        onClosed={reopenModelsAfterChildClose}
        onBackToModels={() => closeChildForModels(() => setWhisperOpen(false))}
      />
      <VoiceModelsSheet
        visible={voiceOpen}
        onClose={() => setVoiceOpen(false)}
        onClosed={reopenModelsAfterChildClose}
        onBackToModels={() => closeChildForModels(() => setVoiceOpen(false))}
      />

      {/* Full-screen model-loading overlay (animated progress + rotating tips). */}
      <LoadingOverlay loadingState={loadingState} />

      {/* Custom Alert Modal */}
      <CustomAlert
        visible={alertState.visible}
        title={alertState.title}
        message={alertState.message}
        buttons={alertState.buttons}
        onClose={() => setAlertState(hideAlert())}
      />
    </SafeAreaView>
  );
};
