import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  Image,
  ActivityIndicator,
} from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AttachStep } from 'react-native-spotlight-tour';
import { ModelSelectorModal } from '../../components';
import { AnimatedEntry } from '../../components/AnimatedEntry';
import { createStyles } from './styles';
import { useTheme } from '../../theme';
import { getSlot, SLOTS } from '../../bootstrap/slotRegistry';

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
      <View style={styles.headerRow}>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <Icon name="arrow-left" size={20} color={colors.text} />
        </TouchableOpacity>
        <View style={styles.headerLeft}>
          <Text style={styles.headerTitle}>New Chat</Text>
        </View>
        <View style={styles.headerActions} />
      </View>
    </View>
    <View style={styles.noModelContainer}>
      {isModelLoading ? (
        // A model was selected and is loading in the background. activeModelId stays
        // null until the native load finishes, so this empty state would otherwise
        // remain with no feedback — the user thinks nothing happened. Show a loading
        // indicator instead of the "Select Model" prompt.
        <>
          <ActivityIndicator size="large" color={colors.primary} testID="no-model-loading-indicator" />
          <Text style={[styles.noModelTitle, styles.noModelLoadingTitle]}>Loading Model</Text>
          <Text style={styles.noModelText}>Getting your model ready. This can take a moment.</Text>
        </>
      ) : (
        <>
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
        </>
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
}> = ({ styles, colors, activeConversation, activeProject, navigation, onOpenModels, setShowSettingsPanel, setShowProjectSelector, isRemote }) => (
  <View style={styles.header}>
    <View style={styles.headerRow}>
      <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
        <Icon name="arrow-left" size={20} color={colors.text} />
      </TouchableOpacity>
      <View style={styles.headerLeft}>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {activeConversation?.title || 'New Chat'}
        </Text>
        <View style={styles.headerSubtitleRow}>
          <TouchableOpacity style={styles.modelSelector} onPress={onOpenModels} testID="model-selector">
            {isRemote && (
              <Icon name="cloud" size={12} color={colors.primary} style={styles.remoteIcon} />
            )}
            <Icon name="layers" size={12} color={colors.textSecondary} style={styles.remoteIcon} />
            <Text style={styles.headerSubtitle} numberOfLines={1} testID="model-loaded-indicator">
              Models
            </Text>
            <Text style={styles.modelSelectorArrow}>▼</Text>
          </TouchableOpacity>
          <Text style={styles.headerSubtitleDivider}>·</Text>
          <TouchableOpacity style={styles.headerProjectRow} onPress={() => setShowProjectSelector(true)}>
            <Icon name="folder" size={11} color={activeProject ? colors.primary : colors.textMuted} />
            <Text style={[styles.headerSubtitle, { color: activeProject ? colors.primary : colors.textMuted }]} numberOfLines={1}>
              {activeProject ? activeProject.name : 'Default'}
            </Text>
          </TouchableOpacity>
          {/* Pro-only: Chat/Voice mode dropdown, on the same line as Models ·
              project, pushed to the right. Empty slot in free builds. */}
          {(() => { const ModeToggle = getSlot(SLOTS.chatInputModeToggle); return ModeToggle ? <View style={styles.modeToggleWrap}><ModeToggle /></View> : null; })()}
        </View>
      </View>
      <View style={styles.headerActions}>
        <AttachStep index={16}>
          <TouchableOpacity style={styles.iconButton} onPress={() => setShowSettingsPanel(true)} testID="chat-settings-icon">
            <Icon name="sliders" size={16} color={colors.textSecondary} />
          </TouchableOpacity>
        </AttachStep>
      </View>
    </View>
  </View>
);

export const EmptyChat: React.FC<{
  styles: StylesType;
  colors: ColorsType;
  activeModel: any;
  activeModelName?: string;
  activeProject: any;
  setShowProjectSelector: (v: boolean) => void;
  isRemote?: boolean;
}> = ({ styles, colors, activeModel, activeModelName, activeProject, setShowProjectSelector, isRemote }) => (
  <View style={styles.emptyChat}>
    <AnimatedEntry index={0} staggerMs={60}>
      <View style={styles.emptyChatIconContainer}>
        <Icon name="message-square" size={32} color={colors.textMuted} />
      </View>
    </AnimatedEntry>
    <AnimatedEntry index={1} staggerMs={60}>
      <Text style={styles.emptyChatTitle}>Start a Conversation</Text>
    </AnimatedEntry>
    <AnimatedEntry index={2} staggerMs={60}>
      <Text style={styles.emptyChatText}>
        Type a message below to begin chatting with {activeModelName || activeModel?.name || 'Unknown'}.
      </Text>
    </AnimatedEntry>
    <AnimatedEntry index={3} staggerMs={60}>
      <TouchableOpacity style={styles.projectHint} onPress={() => setShowProjectSelector(true)}>
        <View style={styles.projectHintIcon}>
          <Text style={styles.projectHintIconText}>
            {activeProject?.name?.charAt(0).toUpperCase() || 'D'}
          </Text>
        </View>
        <Text style={styles.projectHintText}>
          Project: {activeProject?.name || 'Default'} — tap to change
        </Text>
      </TouchableOpacity>
    </AnimatedEntry>
    <AnimatedEntry index={4} staggerMs={60}>
      <Text style={styles.privacyText}>
        {isRemote
          ? 'This conversation uses a remote model. Your messages will be sent to the remote server.'
          : 'This conversation is completely private. All processing happens on your device.'}
      </Text>
    </AnimatedEntry>
  </View>
);

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
                <Icon name="image" size={18} color={colors.primary} />
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
}> = ({ styles, colors, viewerImageUri, onClose, onSave }) => (
  <Modal visible={!!viewerImageUri} transparent animationType="fade" onRequestClose={onClose}>
    <View style={styles.imageViewerContainer}>
      <TouchableOpacity style={styles.imageViewerBackdrop} activeOpacity={1} onPress={onClose} />
      {viewerImageUri && (
        <View style={styles.imageViewerContent}>
          <Image source={{ uri: viewerImageUri }} style={styles.fullscreenImage} resizeMode="contain" />
          <View style={styles.imageViewerActions}>
            <TouchableOpacity style={styles.imageViewerButton} onPress={onSave}>
              <Icon name="download" size={24} color={colors.text} />
              <Text style={styles.imageViewerButtonText}>Save</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.imageViewerButton} onPress={onClose}>
              <Icon name="x" size={24} color={colors.text} />
              <Text style={styles.imageViewerButtonText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  </Modal>
);
