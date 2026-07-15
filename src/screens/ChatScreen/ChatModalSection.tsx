import React from 'react';
import {
  ModelSelectorModal, GenerationSettingsModal,
  ProjectSelectorSheet, DebugSheet,
} from '../../components';
import { createStyles } from './styles';
import { useTheme } from '../../theme';
import { ImageViewerModal } from './ChatScreenComponents';

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
  modelSelectorTab?: 'text' | 'image';
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
  isRemote?: boolean;
};

export const ChatModalSection: React.FC<ChatModalSectionProps> = ({
  styles, colors,
  showProjectSelector, setShowProjectSelector,
  showDebugPanel, setShowDebugPanel,
  showModelSelector, setShowModelSelector, modelSelectorTab = 'text',
  showSettingsPanel, setShowSettingsPanel,
  debugInfo, activeProject, activeConversation, settings, projects,
  handleSelectProject, handleModelSelect, handleUnloadModel, handleDeleteConversation,
  isModelLoading, imageCount, activeConversationId, navigation,
  viewerImageUri, setViewerImageUri, handleSaveImage,
  isRemote,
}) => (
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
      onSelectModel={handleModelSelect}
      onUnloadModel={handleUnloadModel}
      isLoading={isModelLoading}
      onAddServer={() => navigation.navigate('RemoteServers')}
    />
    <GenerationSettingsModal
      visible={showSettingsPanel}
      onClose={() => setShowSettingsPanel(false)}
      onOpenProject={() => setShowProjectSelector(true)}
      onOpenGallery={imageCount > 0 ? () => navigation.navigate('Gallery', { conversationId: activeConversationId }) : undefined}
      onDeleteConversation={activeConversation ? handleDeleteConversation : undefined}
      conversationImageCount={imageCount}
      activeProjectName={activeProject?.name || null}
      isRemote={isRemote}
    />
    <ImageViewerModal
      styles={styles} colors={colors}
      viewerImageUri={viewerImageUri}
      onClose={() => setViewerImageUri(null)}
      onSave={handleSaveImage}
    />
  </>
);
