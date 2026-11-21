import React from 'react';
import {
  View,
  Text,
  Modal,
  Image,
} from 'react-native';
import { TouchableOpacity } from '../../components/Touchable';
import { LoadingDots } from '../../components/LoadingDots';
import Icon from 'react-native-vector-icons/Feather';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { ModelSelectorModal } from '../../components';
import { HeaderStatusFill } from '../../components/ScreenHeader';
import { AnimatedEntry } from '../../components/AnimatedEntry';
import { createStyles } from './styles';
import { SPACING } from '../../constants';
import { useTheme } from '../../theme';
import { getSlot, SLOTS } from '../../bootstrap/slotRegistry';
import type { ArrivingChatModel } from '../../services/arrivingChatModel';
import { chatTitle, NEW_CHAT_TITLE } from '../../utils/chatTitle';

type StylesType = ReturnType<typeof createStyles>;
type ColorsType = ReturnType<typeof useTheme>['colors'];

export const NoModelScreen: React.FC<{
  styles: StylesType;
  colors: ColorsType;
  navigation: any;
  hasAvailableModels: boolean;
  showModelSelector: boolean;
  setShowModelSelector: (v: boolean) => void;
  onSelectModel: (model: any) => void;
  onUnloadModel: () => void;
  isModelLoading: boolean;
}> = ({ styles, colors, navigation, hasAvailableModels, showModelSelector, setShowModelSelector, onSelectModel, onUnloadModel, isModelLoading }) => (
  <SafeAreaView style={styles.container} edges={['top']}>
    <View style={styles.header}>
      <HeaderStatusFill />
      <View style={styles.headerRow}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Icon name="arrow-left" size={20} color={colors.text} />
        </TouchableOpacity>
        <View style={styles.headerLeft}>
          <Text style={styles.headerTitle}>New chat</Text>
        </View>
        <View style={styles.headerActions} />
      </View>
    </View>
    <View style={styles.noModelContainer}>
      <View style={styles.noModelIconContainer}>
        <Icon name="cpu" size={32} color={colors.textMuted} />
      </View>
      <Text style={styles.noModelTitle}>No Model Selected</Text>
      <Text style={styles.noModelText}>
        {hasAvailableModels
          ? 'Select a text or image model to get started.'
          : 'Download a text or image model from the Models tab to get started.'}
      </Text>
      {hasAvailableModels && (
        <TouchableOpacity style={styles.selectModelButton} onPress={() => setShowModelSelector(true)}>
          <Text style={styles.selectModelButtonText}>Select Model</Text>
        </TouchableOpacity>
      )}
    </View>
    <ModelSelectorModal
      visible={showModelSelector}
      onClose={() => setShowModelSelector(false)}
      onSelectModel={onSelectModel}
      onUnloadModel={onUnloadModel}
      isLoading={isModelLoading}
    />
  </SafeAreaView>
);

/** What a new person can ask straight away: everyday, answered well by a small on-device model. */
export const STARTER_PROMPTS = [
  'Plan a relaxed weekend near the mountains',
  'Explain how compound interest works',
  'Write a short, kind thank-you note',
] as const;

/** What an empty chat suggests: questions, pictures (image mode on) or clips (video mode on). */
export type StarterMode = 'chat' | 'image' | 'video';

export const starterMode = (mode: string): StarterMode =>
  mode === 'force' ? 'image' : mode === 'video' ? 'video' : 'chat';

const STARTERS: Record<StarterMode, { title: string; hint?: string; icon: string; prompts: readonly string[] }> = {
  chat: { title: "What's on your mind?", icon: 'message-square', prompts: STARTER_PROMPTS },
  image: {
    title: 'What should it draw?',
    hint: 'Describe a picture, or tap one to try. Pick a style below.',
    icon: 'image',
    prompts: ['A lighthouse at dusk, waves below', 'A cozy reading nook on a rainy day', 'A red fox in a snowy forest'],
  },
  video: {
    title: 'What should it film?',
    hint: 'Describe a scene, or tap one to try. Ask for a film for a longer story.',
    icon: 'film',
    prompts: ['A fox walking through fresh snow', 'Rain on a neon street at night', 'Waves on a quiet beach at sunrise'],
  },
};

export const ChatHeader: React.FC<{
  styles: StylesType;
  colors: ColorsType;
  activeConversation: any;
  activeProject: any;
  navigation: any;
  onOpenModels: () => void;
  setShowSettingsPanel: (v: boolean) => void;
  setShowProjectSelector: (v: boolean) => void;
  isRemote?: boolean;
  /** Documents attached in this chat; the Documents button shows only when there are some. */
  documentCount?: number;
  onOpenDocuments?: () => void;
  /** The model that answers in this chat. The selector names it, so you always see what you talk to;
   *  it still opens the manager for every kind of model. */
  modelName?: string;
}> = ({ styles, colors, activeConversation, activeProject, navigation, onOpenModels, setShowSettingsPanel, setShowProjectSelector, isRemote, documentCount, onOpenDocuments, modelName }) => (
  <View style={styles.header}>
    <HeaderStatusFill />
    <View style={styles.headerRow}>
      <TouchableOpacity
        style={styles.backButton}
        onPress={() => navigation.goBack()}
        accessibilityRole="button"
        accessibilityLabel="Back"
      >
        <Icon name="arrow-left" size={20} color={colors.text} />
      </TouchableOpacity>
      <View style={styles.headerLeft}>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {chatTitle(activeConversation?.title || NEW_CHAT_TITLE)}
        </Text>
        <View style={styles.headerSubtitleRow}>
          <TouchableOpacity
            style={styles.modelSelector}
            onPress={onOpenModels}
            testID="model-selector"
            accessibilityRole="button"
            accessibilityLabel={`Model: ${modelName || 'none'}${isRemote ? ', on a remote server' : ''}. Change model`}
          >
            {isRemote && (
              <Icon name="cloud" size={12} color={colors.primary} style={styles.remoteIcon} />
            )}
            <Icon name="layers" size={12} color={colors.textSecondary} style={styles.remoteIcon} />
            <Text style={styles.headerSubtitle} numberOfLines={1} testID="model-loaded-indicator">
              {modelName || 'Models'}
            </Text>
            <Text style={styles.modelSelectorArrow}>▼</Text>
          </TouchableOpacity>
          <Text style={styles.headerSubtitleDivider}>·</Text>
          <TouchableOpacity
            style={[styles.headerProjectRow, styles.headerProjectTarget]}
            onPress={() => setShowProjectSelector(true)}
            accessibilityRole="button"
            accessibilityLabel={`Project: ${activeProject ? activeProject.name : 'Default'}. Change project`}
          >
            <Icon name="folder" size={11} color={colors.textMuted} />
            <Text style={[styles.headerSubtitle, { color: colors.textMuted }]} numberOfLines={1}>
              {activeProject ? activeProject.name : 'Default'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
      <View style={styles.headerActions}>
        {/* Pro-only Voice mode sits beside the conversation filters. Empty in free builds. */}
        {(() => { const ModeToggle = getSlot(SLOTS.chatInputModeToggle); return ModeToggle ? <ModeToggle /> : null; })()}
        {!!documentCount && onOpenDocuments && (
          <TouchableOpacity
            style={styles.iconButton}
            onPress={onOpenDocuments}
            testID="chat-documents-icon"
            accessibilityRole="button"
            accessibilityLabel={`Documents in this chat: ${documentCount}`}
          >
            <Icon name="file-text" size={16} color={colors.textSecondary} />
          </TouchableOpacity>
        )}
        <TouchableOpacity style={styles.iconButton} onPress={() => setShowSettingsPanel(true)} testID="chat-settings-icon" accessibilityRole="button" accessibilityLabel="Chat settings" hitSlop={7}>
          <Icon name="sliders" size={16} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>
    </View>
  </View>
);

/** What an empty chat says while its first model downloads. */
function arrivingHint(model: ArrivingChatModel): string {
  return model.failed
    ? `${model.name} stopped downloading.`
    : `${model.name} is downloading: ${Math.round(model.progress * 100)}%. Ask now. It answers when it is ready.`;
}

export const EmptyChat: React.FC<{
  styles: StylesType;
  colors: ColorsType;
  activeModel: any;
  activeModelName?: string;
  activeProject: any;
  setShowProjectSelector: (v: boolean) => void;
  isRemote?: boolean;
  /** Sends a starter prompt through the same path as the composer. */
  onStarter?: (prompt: string) => void;
  /** What the composer is making; its starters match. */
  mode?: StarterMode;
  /** The first chat model while it downloads: the person can ask now. */
  arriving?: ArrivingChatModel | null;
  /** Starts the first chat model's stopped download again. */
  onRetryArriving?: () => void;
}> = ({ styles, colors, activeModel, activeModelName, activeProject, setShowProjectSelector, isRemote, onStarter, mode = 'chat', arriving, onRetryArriving }) => {
  const starters = STARTERS[mode];
  return (
  <View style={styles.emptyChat} testID={`empty-chat-${mode}`}>
    <AnimatedEntry index={0} staggerMs={60}>
      <View style={styles.emptyChatIconContainer}>
        <Icon name={starters.icon} size={32} color={colors.textMuted} />
      </View>
    </AnimatedEntry>
    <AnimatedEntry index={1} staggerMs={60}>
      <Text style={styles.emptyChatTitle}>{starters.title}</Text>
    </AnimatedEntry>
    <AnimatedEntry index={2} staggerMs={60}>
      <Text style={styles.emptyChatText} testID="empty-chat-hint">
        {/* With no model chosen yet, no name: never "Unknown". */}
        {starters.hint ?? (arriving && mode === 'chat'
          ? arrivingHint(arriving)
          : activeModelName || activeModel?.name
            ? `Ask anything. ${activeModelName || activeModel?.name} answers.`
            : 'Ask anything.')}
      </Text>
    </AnimatedEntry>
    {arriving?.failed && onRetryArriving && (
      <TouchableOpacity
        style={[styles.starterChip, styles.starterChipLast]}
        onPress={onRetryArriving}
        accessibilityRole="button"
        accessibilityLabel={`Retry downloading ${arriving.name}`}
        testID="empty-chat-retry-download"
      >
        <Text style={styles.starterText}>Retry download</Text>
      </TouchableOpacity>
    )}
    {onStarter && (
      <AnimatedEntry index={3} staggerMs={60}>
        {/* A new person sees what they can ask: one tap sends it. */}
        <View style={styles.starterList} testID="chat-starters">
          {starters.prompts.map((prompt, index) => (
            <TouchableOpacity
              key={prompt}
              style={[styles.starterChip, index === starters.prompts.length - 1 && styles.starterChipLast]}
              onPress={() => onStarter(prompt)}
              accessibilityRole="button"
              accessibilityLabel={prompt}
            >
              <Text style={styles.starterText}>{prompt}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </AnimatedEntry>
    )}
    <AnimatedEntry index={4} staggerMs={60}>
      <TouchableOpacity style={styles.projectHint} onPress={() => setShowProjectSelector(true)}>
        <Icon name="folder" size={13} color={colors.textMuted} />
        <Text style={styles.projectHintText}>
          Project: {activeProject?.name || 'Default'} · Change
        </Text>
      </TouchableOpacity>
    </AnimatedEntry>
    <AnimatedEntry index={5} staggerMs={60}>
      <Text style={styles.privacyText}>
        {isRemote
          ? 'This chat runs on a remote server, not on this phone.'
          : 'Your chats and files never leave your device.'}
      </Text>
    </AnimatedEntry>
  </View>
  );
};

export const ImageProgressIndicator: React.FC<{
  styles: StylesType;
  colors: ColorsType;
  imagePreviewPath: string | null | undefined;
  imageGenerationStatus: string | null | undefined;
  imageGenerationProgress: { step: number; totalSteps: number } | null | undefined;
  onStop: () => void;
}> = ({ styles, colors, imagePreviewPath, imageGenerationStatus, imageGenerationProgress, onStop }) => (
  <View style={styles.imageProgressContainer}>
    <View style={styles.imageProgressCard}>
      <View style={styles.imageProgressRow}>
        {imagePreviewPath && (
          <Image source={{ uri: imagePreviewPath }} style={styles.imagePreview} resizeMode="cover" />
        )}
        <View style={styles.imageProgressContent}>
          <View style={styles.imageProgressHeader}>
            {/* The placeholder image glyph is only meaningful BEFORE the live preview renders.
                Once the preview thumbnail is up (Refining Image), drop it — it just overlapped
                the real image (device 2026-07-16). */}
            {!imagePreviewPath && (
              <View style={styles.imageProgressIconContainer} testID="image-progress-placeholder-icon">
                {imageGenerationProgress ? (
                  <Icon name="image" size={18} color={colors.primary} />
                ) : (
                  <LoadingDots testID="image-generation-working-indicator" />
                )}
              </View>
            )}
            <View style={styles.imageProgressInfo}>
              <Text style={styles.imageProgressTitle}>
                {imagePreviewPath ? 'Refining Image' : 'Generating Image'}
              </Text>
              {imageGenerationStatus && (
                <Text style={styles.imageProgressStatus}>{imageGenerationStatus}</Text>
              )}
            </View>
            {imageGenerationProgress && (
              <Text style={styles.imageProgressSteps}>
                {imageGenerationProgress.step}/{imageGenerationProgress.totalSteps}
              </Text>
            )}
            <TouchableOpacity style={styles.imageStopButton} onPress={onStop}>
              <Icon name="x" size={16} color={colors.error} />
            </TouchableOpacity>
          </View>
          {imageGenerationProgress && (
            <View style={styles.imageProgressBarContainer}>
              <View style={styles.imageProgressBar}>
                <View
                  style={[
                    styles.imageProgressFill,
                    { width: `${(imageGenerationProgress.step / imageGenerationProgress.totalSteps) * 100}%` },
                  ]}
                />
              </View>
            </View>
          )}
        </View>
      </View>
    </View>
  </View>
);

export const ImageViewerModal: React.FC<{
  styles: StylesType;
  colors: ColorsType;
  viewerImageUri: string | null;
  onClose: () => void;
  onSave: () => void;
  /** Shares the picture with the Off Grid AI mark through the system share sheet. */
  onShare?: () => void;
  /** Video is Pro: "Animate this photo" fills this slot. */
  AnimateAction?: React.ComponentType<any>;
  conversationId?: string | null;
}> = ({ styles, colors, viewerImageUri, onClose, onSave, onShare, AnimateAction, conversationId }) => {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={!!viewerImageUri} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.imageViewerContainer}>
        <TouchableOpacity style={styles.imageViewerBackdrop} activeOpacity={1} onPress={onClose} />
        {viewerImageUri && (
          <View style={styles.imageViewerContent}>
            <Image source={{ uri: viewerImageUri }} style={styles.fullscreenImage} resizeMode="contain" />
            <TouchableOpacity
              style={[styles.imageViewerClose, { top: insets.top + SPACING.md }]}
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close"
              testID="image-viewer-close"
            >
              <Icon name="x" size={24} color={colors.text} />
            </TouchableOpacity>
            <View style={[styles.imageViewerActions, { bottom: insets.bottom + SPACING.xl }]}>
              {AnimateAction && (
                <AnimateAction
                  imagePath={viewerImageUri}
                  conversationId={conversationId}
                  onStarted={onClose}
                  buttonStyle={styles.imageViewerButton}
                  textStyle={styles.imageViewerButtonText}
                  iconColor={colors.text}
                />
              )}
              {onShare && (
                <TouchableOpacity
                  style={styles.imageViewerButton}
                  onPress={onShare}
                  accessibilityRole="button"
                  accessibilityLabel="Share"
                  testID="image-viewer-share"
                >
                  <Icon name="share" size={24} color={colors.text} />
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={styles.imageViewerButton}
                onPress={onSave}
                accessibilityRole="button"
                accessibilityLabel="Save"
                testID="image-viewer-save"
              >
                <Icon name="download" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>
    </Modal>
  );
};
