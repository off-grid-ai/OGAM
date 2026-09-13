import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  Button,
  Card,
  CustomAlert,
  hideAlert,
  ModelSelectorModal,
} from '../../components';
import { AnimatedEntry } from '../../components/AnimatedEntry';
import { AnimatedPressable } from '../../components/AnimatedPressable';
import { useFocusTrigger } from '../../hooks/useFocusTrigger';
import Icon from 'react-native-vector-icons/Feather';
import IconMC from 'react-native-vector-icons/MaterialCommunityIcons';
import { useThemedStyles, useTheme } from '../../theme';
import { createStyles } from './styles';
import { useHomeScreen, HomeScreenNavigationProp } from './hooks/useHomeScreen';
import { RecentConversations } from './components/RecentConversations';
import { LoadingOverlay } from './components/LoadingOverlay';
import { DesktopPromoCard } from './components/DesktopPromoCard';
import { ModelsSummaryRow } from '../../components/models/ModelsSummaryRow';
import {
  ModelsManagerSheet,
  ModelRowType,
} from '../../components/models/ModelsManagerSheet';
import { WhisperPickerSheet } from '../../components/models/WhisperPickerSheet';
import { VoiceModelsSheet } from '../../components/models/VoiceModelsSheet';
import { useWhisperStore } from '../../stores/whisperStore';
import { WHISPER_MODELS } from '../../services';
import { useUiModeStore } from '../../stores/uiModeStore';
import { SLOTS, useSlot } from '../../bootstrap/slotRegistry';
import { useOpenSync } from '../../hooks/useOpenSync';
import { useActiveRemoteModelLabels } from '../../hooks/useActiveRemoteModelLabels';
import { openSupportEmail } from '../../utils/supportEmail';

type HomeScreenProps = {
  navigation: HomeScreenNavigationProp;
};

function homeModelLabels(input: {
  text?: string;
  image?: string;
  voice?: string | null;
  transcription?: string | null;
  localVoice?: string | null;
  localTranscription?: string;
}): Record<ModelRowType, string> {
  return {
    text: input.text ?? '—',
    image: input.image ?? '—',
    voice: input.voice ?? input.localVoice ?? '—',
    speech: input.transcription ?? input.localTranscription ?? '—',
  };
}

export const HomeScreen: React.FC<HomeScreenProps> = ({ navigation }) => {
  const focusTrigger = useFocusTrigger();
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
    conversations,
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
  const whisperModelId = useWhisperStore(s => s.downloadedModelId);
  const whisperPresentCount = useWhisperStore(
    s => s.presentModelIds?.length ?? 0,
  );
  const voiceSummary = useUiModeStore(s => s.voiceSummary);
  const remoteLabels = useActiveRemoteModelLabels();

  const modelLabels = homeModelLabels({
    text: activeTextModelId ? activeTextModelName : undefined,
    image: activeImageModel?.name,
    voice: remoteLabels.voice,
    transcription: remoteLabels.transcription,
    localVoice: voiceSummary,
    localTranscription: WHISPER_MODELS.find(m => m.id === whisperModelId)?.name,
  });

  // Downloaded-model counts shown in the Models card (replaces the old stats row).
  const modelCounts: Partial<Record<ModelRowType, number>> = {
    text: downloadedModels.length,
    image: downloadedImageModels.length,
    speech: whisperPresentCount,
    voice: voiceSummary ? 1 : 0,
  };

  // Stash an action and close the manager; the action runs from the manager's
  // onClosed once it has fully dismissed — so opening a picker or the eject
  // confirmation never collides with the manager's own dismissal.
  const closeManagerThen = (action: () => void) => {
    pendingAfterCloseRef.current = action;
    setModelsManagerOpen(false);
  };

  const openModelRow = (type: ModelRowType) => {
    closeManagerThen(() => {
      if (type === 'text') setPickerType('text');
      else if (type === 'image') setPickerType('image');
      else if (type === 'speech') setWhisperOpen(true);
      else setVoiceOpen(true);
    });
  };

  const runPendingAfterClose = () => {
    const action = pendingAfterCloseRef.current;
    pendingAfterCloseRef.current = null;
    action?.();
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View testID="home-screen" style={styles.scrollView}>
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.content}
        >
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <Image
                source={
                  isDark
                    ? require('../../assets/home-logo-dark.png')
                    : require('../../assets/home-logo-light.png')
                }
                style={styles.appLogo}
                resizeMode="contain"
                accessible={false}
                testID="home-app-logo"
              />
              <Text style={styles.title}>Off Grid AI</Text>
            </View>
            <View style={styles.headerActions}>
              {HomeNotificationsButton ? (
                <HomeNotificationsButton onOpen={openSyncNotifications} />
              ) : null}
              <TouchableOpacity
                onPress={() => navigation.navigate('ProDetail')}
                hitSlop={8}
                style={styles.crownButton}
                accessibilityRole="button"
                accessibilityLabel="Open Off Grid AI Pro"
              >
                <IconMC name="crown" size={16} color={colors.primary} />
              </TouchableOpacity>
            </View>
          </View>

          {/* Collapsed Models summary — tap to open the manager sheet. Both the
              text (1) and image (13) tour steps anchor here now. */}
          <AnimatedEntry index={0} staggerMs={50} trigger={focusTrigger}>
            <ModelsSummaryRow
              labels={modelLabels}
              counts={modelCounts}
              isLoading={loadingState.isLoading}
              onPress={() => setModelsManagerOpen(true)}
            />
          </AnimatedEntry>

          {/* New Chat Button */}
          {activeTextModelId || activeImageModelId ? (
            <Button
              title="New Chat"
              onPress={startNewChat}
              style={styles.newChatButton}
              testID="new-chat-button"
            />
          ) : (
            <Card style={styles.setupCard} testID="setup-card">
              <Text style={styles.setupText}>
                {downloadedModels.length > 0 || remoteTextModels.length > 0
                  ? 'Select a text or image model to start'
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

          {SyncHomeCard ? (
            <AnimatedEntry index={2} staggerMs={50} trigger={focusTrigger}>
              <SyncHomeCard
                isUnlocked={isSyncUnlocked}
                onOpen={openSync}
                onOpenClipboard={() =>
                  isSyncUnlocked
                    ? navigation.navigate('Clipboard' as never)
                    : navigation.navigate('ProDetail')
                }
              />
            </AnimatedEntry>
          ) : null}

          {/* Recent Conversations */}
          {recentConversations.length > 0 && (
            <AnimatedEntry index={3} staggerMs={50} trigger={focusTrigger}>
              <RecentConversations
                conversations={recentConversations}
                totalCount={conversations.length}
                focusTrigger={focusTrigger}
                onContinueChat={continueChat}
                onDeleteConversation={handleDeleteConversation}
                onSeeAll={() => navigation.navigate('ChatsTab')}
              />
            </AnimatedEntry>
          )}

          {/* Image Gallery */}
          <AnimatedPressable
            style={styles.galleryCard}
            onPress={() => navigation.navigate('Gallery')}
            hapticType="selection"
          >
            <Icon name="grid" size={18} color={colors.primary} />
            <View style={styles.galleryCardInfo}>
              <Text style={styles.galleryCardTitle}>Image Gallery</Text>
              <Text style={styles.galleryCardMeta}>
                {generatedImages.length}{' '}
                {generatedImages.length === 1 ? 'image' : 'images'}
              </Text>
            </View>
            <Icon name="chevron-right" size={16} color={colors.textMuted} />
          </AnimatedPressable>

          {/* Off Grid AI Desktop — live announcement; owns its own copy/dismiss state. */}
          <DesktopPromoCard />

          <AnimatedEntry index={5} staggerMs={50} trigger={focusTrigger}>
            <Card style={styles.supportCard} testID="home-support-card">
              <View style={styles.supportHeader}>
                <Icon name="message-square" size={18} color={colors.primary} />
                <Text style={styles.supportTitle}>
                  What should we build next?
                </Text>
              </View>
              <Text style={styles.supportDescription}>
                Tell us what you would like to see in Off Grid AI Mobile.
              </Text>
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
            </Card>
          </AnimatedEntry>

          {/* Model Stats row removed — the per-type counts now live in the Models
              card above, and the chat count sits next to "See all". */}
        </ScrollView>
      </View>

      <ModelSelectorModal
        visible={pickerType !== null}
        initialTab={pickerType ?? 'text'}
        onClose={() => setPickerType(null)}
        onSelectModel={handleSelectTextModel}
        onUnloadModel={handleUnloadTextModel}
        onSelectImageModel={handleSelectImageModel}
        onUnloadImageModel={handleUnloadImageModel}
        isLoading={loadingState.isLoading}
        onSelectionComplete={() => setPickerType(null)}
        onBrowseModels={tab => {
          setPickerType(null);
          navigation.navigate('ModelsTab', { initialTab: tab });
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
      />
      <VoiceModelsSheet
        visible={voiceOpen}
        onClose={() => setVoiceOpen(false)}
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
