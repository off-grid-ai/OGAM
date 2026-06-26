import React from 'react';
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Card, CustomAlert, hideAlert } from '../../components';
import { AnimatedEntry } from '../../components/AnimatedEntry';
import { AnimatedPressable } from '../../components/AnimatedPressable';
import { OnboardingSheet } from '../../components/onboarding/OnboardingSheet';
import { PulsatingIcon } from '../../components/onboarding/PulsatingIcon';
import { useOnboardingSheet } from '../../components/onboarding/useOnboardingSheet';
import { useFocusTrigger } from '../../hooks/useFocusTrigger';
import { AttachStep } from 'react-native-spotlight-tour';
import Icon from 'react-native-vector-icons/Feather';
import IconMC from 'react-native-vector-icons/MaterialCommunityIcons';
import { useThemedStyles, useTheme } from '../../theme';
import { createStyles } from './styles';
import { useHomeScreen, HomeScreenNavigationProp } from './hooks/useHomeScreen';
import { useHomeScreenSpotlight } from './hooks/useHomeScreenSpotlight';
import { RecentConversations } from './components/RecentConversations';
import { ModelPickerSheet } from './components/ModelPickerSheet';
import { LoadingOverlay } from './components/LoadingOverlay';
import { ModelsSummaryRow } from '../../components/models/ModelsSummaryRow';
import { ModelsManagerSheet, ModelRowType } from '../../components/models/ModelsManagerSheet';
import { WhisperPickerSheet } from '../../components/models/WhisperPickerSheet';
import { VoiceModelsSheet } from '../../components/models/VoiceModelsSheet';
import { useWhisperStore } from '../../stores/whisperStore';
import { WHISPER_MODELS } from '../../services';
import { useUiModeStore } from '../../stores/uiModeStore';

type HomeScreenProps = {
  navigation: HomeScreenNavigationProp;
};

// AttachStep wraps children in a View that otherwise shrinks to content width;
// stretch it so the Models summary row fills the column like the other cards.
const stretchStyle = { alignSelf: 'stretch' as const };

export const HomeScreen: React.FC<HomeScreenProps> = ({ navigation }) => {
  const focusTrigger = useFocusTrigger();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const { sheetVisible, openSheet, closeSheet, showIcon } = useOnboardingSheet();

  const {
    pickerType,
    setPickerType,
    loadingState,
    isEjecting,
    alertState,
    setAlertState,
    memoryInfo,
    downloadedModels,
    activeModelId,
    downloadedImageModels,
    activeImageModelId,
    generatedImages,
    conversations,
    activeTextModel,
    activeImageModel,
    recentConversations,
    // Remote model state
    remoteTextModels,
    remoteImageModels,
    activeRemoteTextModelId,
    activeRemoteImageModelId,
    handleSelectTextModel,
    handleUnloadTextModel,
    handleSelectImageModel,
    handleUnloadImageModel,
    // Remote model handlers
    handleSelectRemoteTextModel,
    handleUnloadRemoteTextModel,
    handleSelectRemoteImageModel,
    handleUnloadRemoteImageModel,
    handleEjectAll,
    startNewChat,
    continueChat,
    handleDeleteConversation,
  } = useHomeScreen(navigation);

  const { handleStepPress } = useHomeScreenSpotlight({
    navigation,
    closeSheet,
    activeImageModelId,
    downloadedImageModelsCount: downloadedImageModels.length,
  });

  // ── Collapsed Models control ──────────────────────────────────────────────
  const [modelsManagerOpen, setModelsManagerOpen] = React.useState(false);
  // Action queued by the manager (open a picker, or eject) — run only after the
  // manager sheet has fully closed, so we never present a second modal while
  // this one is mid-dismiss (that wedges iOS's modal system). Run from onClosed.
  const pendingAfterCloseRef = React.useRef<(() => void) | null>(null);
  const [whisperOpen, setWhisperOpen] = React.useState(false);
  const [voiceOpen, setVoiceOpen] = React.useState(false);
  const whisperModelId = useWhisperStore((s) => s.downloadedModelId);
  const voiceSummary = useUiModeStore((s) => s.voiceSummary);

  const modelLabels: Record<ModelRowType, string> = {
    text: activeTextModel?.name ?? '—',
    image: activeImageModel?.name ?? '—',
    voice: voiceSummary ?? '—',
    speech: WHISPER_MODELS.find((m) => m.id === whisperModelId)?.name ?? '—',
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
        <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <Text style={styles.title}>Off Grid</Text>
              {showIcon && <PulsatingIcon onPress={openSheet} />}
            </View>
            <TouchableOpacity onPress={() => navigation.navigate('ProDetail')} hitSlop={8} style={styles.crownButton}>
              <IconMC name="crown" size={16} color={colors.primary} />
            </TouchableOpacity>
          </View>

          {/* Collapsed Models summary — tap to open the manager sheet. Both the
              text (1) and image (13) tour steps anchor here now. */}
          <AnimatedEntry index={0} staggerMs={50} trigger={focusTrigger}>
            <AttachStep index={1} style={stretchStyle}>
              <AttachStep index={13} style={stretchStyle}>
                <ModelsSummaryRow
                  labels={modelLabels}
                  isLoading={loadingState.isLoading}
                  onPress={() => setModelsManagerOpen(true)}
                />
              </AttachStep>
            </AttachStep>
          </AnimatedEntry>

          {/* New Chat Button */}
          {
            (activeTextModel || activeImageModelId) ? (
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
                    : 'Add a remote server or download a model to start chatting'}
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
                    title={downloadedModels.length > 0 || remoteTextModels.length > 0 ? 'Select Model' : 'Browse Models'}
                    variant="outline"
                    size="small"
                    onPress={() => downloadedModels.length > 0 || remoteTextModels.length > 0 ? setPickerType('text') : navigation.navigate('ModelsTab', { initialTab: 'text' })}
                    testID="browse-models-button"
                  />
                </View>
              </Card>
            )
          }

          {/* Recent Conversations */}
          {
            recentConversations.length > 0 && (
              <AnimatedEntry index={2} staggerMs={50} trigger={focusTrigger}>
                <RecentConversations
                  conversations={recentConversations}
                  focusTrigger={focusTrigger}
                  onContinueChat={continueChat}
                  onDeleteConversation={handleDeleteConversation}
                  onSeeAll={() => navigation.navigate('ChatsTab')}
                />
              </AnimatedEntry>
            )
          }

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
                {generatedImages.length} {generatedImages.length === 1 ? 'image' : 'images'}
              </Text>
            </View>
            <Icon name="chevron-right" size={16} color={colors.textMuted} />
          </AnimatedPressable>

          {/* Model Stats */}
          <AnimatedEntry index={3} staggerMs={50} trigger={focusTrigger}>
            <View style={styles.statsRow}>
              <View style={styles.statItem}>
                <Text style={styles.statValue}>{downloadedModels.length}</Text>
                <Text style={styles.statLabel}>Text models</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statItem}>
                <Text style={styles.statValue}>{downloadedImageModels.length}</Text>
                <Text style={styles.statLabel}>Image models</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statItem}>
                <Text style={styles.statValue}>{conversations.length}</Text>
                <Text style={styles.statLabel}>Chats</Text>
              </View>
            </View>
          </AnimatedEntry>
        </ScrollView >
      </View >

      {/* Model Picker Sheet */}
      < ModelPickerSheet
        pickerType={pickerType}
        loadingState={loadingState}
        downloadedModels={downloadedModels}
        downloadedImageModels={downloadedImageModels}
        activeModelId={activeModelId}
        activeImageModelId={activeImageModelId}
        memoryInfo={memoryInfo}
        remoteTextModels={remoteTextModels}
        remoteImageModels={remoteImageModels}
        activeRemoteTextModelId={activeRemoteTextModelId}
        activeRemoteImageModelId={activeRemoteImageModelId}
        onClose={() => setPickerType(null)}
        onSelectTextModel={handleSelectTextModel}
        onUnloadTextModel={handleUnloadTextModel}
        onSelectImageModel={handleSelectImageModel}
        onUnloadImageModel={handleUnloadImageModel}
        onSelectRemoteTextModel={handleSelectRemoteTextModel}
        onUnloadRemoteTextModel={handleUnloadRemoteTextModel}
        onSelectRemoteImageModel={handleSelectRemoteImageModel}
        onUnloadRemoteImageModel={handleUnloadRemoteImageModel}
        onBrowseModels={(tab) => {
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
        loadingState={loadingState}
        isEjecting={isEjecting}
        hasActiveModel={!!(activeModelId || activeImageModelId || activeRemoteTextModelId || activeRemoteImageModelId)}
        onOpenRow={openModelRow}
        onEject={() => closeManagerThen(handleEjectAll)}
      />
      <WhisperPickerSheet visible={whisperOpen} onClose={() => setWhisperOpen(false)} />
      <VoiceModelsSheet visible={voiceOpen} onClose={() => setVoiceOpen(false)} />

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

      <OnboardingSheet
        visible={sheetVisible}
        onClose={closeSheet}
        onStepPress={handleStepPress}
      />
    </SafeAreaView >
  );
};
