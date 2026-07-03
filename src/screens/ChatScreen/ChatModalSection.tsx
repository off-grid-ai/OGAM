import React from 'react';
import {
  GenerationSettingsModal,
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
  showSettingsPanel: boolean;
  setShowSettingsPanel: (v: boolean) => void;
  debugInfo: any;
  activeProject: any;
  activeConversation: any;
  settings: any;
  projects: any[];
  handleSelectProject: (p: any) => void;
  handleDeleteConversation: () => void;
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
  showSettingsPanel, setShowSettingsPanel,
  debugInfo, activeProject, activeConversation, settings, projects,
  handleSelectProject, handleDeleteConversation,
  imageCount, activeConversationId, navigation,
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
