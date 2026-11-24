import React, { useState } from 'react';
import {
  ModelSelectorModal,
  GenerationSettingsModal,
  ProjectSelectorSheet,
  DebugSheet,
} from '../../components';
import { createStyles } from './styles';
import { useTheme } from '../../theme';
import { ImageViewerModal } from './ChatScreenComponents';
import { useAppStore } from '../../stores/appStore';
import { useSlot, SLOTS } from '../../bootstrap/slotRegistry';
import { ReportMediaSheet } from '../../components/ReportMediaSheet';
import { resolveDocumentPath } from '../../utils/resolveDocumentPath';

type StylesType = ReturnType<typeof createStyles>;
type ColorsType = ReturnType<typeof useTheme>['colors'];

type ChatModalSectionProps = {
  styles: StylesType;
  colors: ColorsType;
  showProjectSelector: boolean;
  setShowProjectSelector: (v: boolean) => void;
  showDebugPanel: boolean;
  setShowDebugPanel: (v: boolean) => void;
  showModelSelector: boolean;
  setShowModelSelector: (v: boolean) => void;
  onModelSelectorClosed?: () => void;
  onBackToModels?: () => void;
  modelSelectorTab?: 'text' | 'image' | 'video' | 'search';
  showSettingsPanel: boolean;
  setShowSettingsPanel: (v: boolean) => void;
  debugInfo: any;
  activeProject: any;
  activeConversation: any;
  settings: any;
  projects: any[];
  handleSelectProject: (p: any) => void;
  handleModelSelect: (m: any) => void;
  handleUnloadModel: () => void;
  handleDeleteConversation: () => void;
  isModelLoading: boolean;
  imageCount: number;
  activeConversationId: string | null | undefined;
  navigation: any;
  viewerImageUri: string | null;
  setViewerImageUri: (v: string | null) => void;
  handleSaveImage: () => void;
  handleShareImage?: () => void;
  isRemote?: boolean;
};

export const ChatModalSection: React.FC<ChatModalSectionProps> = ({
  styles,
  colors,
  showProjectSelector,
  setShowProjectSelector,
  showDebugPanel,
  setShowDebugPanel,
  showModelSelector,
  setShowModelSelector,
  modelSelectorTab = 'text',
  onModelSelectorClosed,
  onBackToModels,
  showSettingsPanel,
  setShowSettingsPanel,
  debugInfo,
  activeProject,
  activeConversation,
  settings,
  projects,
  handleSelectProject,
  handleModelSelect,
  handleUnloadModel,
  handleDeleteConversation,
  isModelLoading,
  imageCount,
  activeConversationId,
  navigation,
  viewerImageUri,
  setViewerImageUri,
  handleSaveImage,
  handleShareImage,
  isRemote,
}) => {
  const AnimateAction = useSlot(SLOTS.imageAnimateAction);
  const videoCount = useAppStore(state => state.generatedVideos.filter(video => video.conversationId === activeConversationId).length);
  const mediaCount = imageCount + videoCount;
  // Only a generated picture can be reported: the open one, matched to its Gallery record for the prompt.
  const viewerGenerated = useAppStore(state => (viewerImageUri
    ? state.generatedImages.find(image => viewerImageUri.replace(/^file:\/\//, '') === resolveDocumentPath(image.imagePath).replace(/^file:\/\//, ''))
    : undefined));
  const [reported, setReported] = useState<{ prompt: string; modelId: string } | null>(null);
  return (
  <>
    <ProjectSelectorSheet
      visible={showProjectSelector}
      onClose={() => setShowProjectSelector(false)}
      projects={projects}
      activeProject={activeProject || null}
      onSelectProject={handleSelectProject}
    />
    <DebugSheet
      visible={showDebugPanel}
      onClose={() => setShowDebugPanel(false)}
      debugInfo={debugInfo}
      activeProject={activeProject || null}
      settings={settings}
      activeConversation={activeConversation || null}
    />
    <ModelSelectorModal
      visible={showModelSelector}
      initialTab={modelSelectorTab}
      onClose={() => setShowModelSelector(false)}
      onClosed={onModelSelectorClosed}
      onBackToModels={onBackToModels}
      onSelectModel={handleModelSelect}
      onUnloadModel={handleUnloadModel}
      isLoading={isModelLoading}
      onAddServer={() => navigation.navigate('RemoteServers')}
      onBrowseModels={tab => {
        // The picker's empty tabs and its footer lead to Models, on the tab that was open.
        setShowModelSelector(false);
        navigation.navigate('Main', { screen: 'ModelsTab', params: { initialTab: tab === 'search' ? 'text' : tab } });
      }}
    />
    <GenerationSettingsModal
      visible={showSettingsPanel}
      onClose={() => setShowSettingsPanel(false)}
      onOpenProject={() => setShowProjectSelector(true)}
      onOpenModelSettings={() => navigation.navigate('ModelSettings')}
      onOpenGallery={mediaCount > 0 ? () => navigation.navigate('Gallery', { conversationId: activeConversationId }) : undefined}
      onDeleteConversation={activeConversation ? handleDeleteConversation : undefined}
      conversationImageCount={mediaCount}
      activeProjectName={activeProject?.name || null}
      isRemote={isRemote}
    />
    <ImageViewerModal
      styles={styles} colors={colors}
      viewerImageUri={viewerImageUri}
      onClose={() => setViewerImageUri(null)}
      onSave={handleSaveImage}
      onShare={handleShareImage}
      onReport={viewerGenerated ? () => {
        // The viewer closes first: a sheet does not show over its modal.
        setReported({ prompt: viewerGenerated.prompt, modelId: viewerGenerated.modelId });
        setViewerImageUri(null);
      } : undefined}
      AnimateAction={AnimateAction}
      conversationId={activeConversationId}
    />
    <ReportMediaSheet
      visible={reported !== null}
      onClose={() => setReported(null)}
      kind="image"
      prompt={reported?.prompt ?? ''}
      modelId={reported?.modelId ?? ''}
    />
  </>
  );
};
