import React, { useEffect, useState, useMemo } from 'react';
import { Text, ScrollView, TouchableOpacity } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { AppSheet } from '../AppSheet';
import { useTheme, useThemedStyles } from '../../theme';
import { useAppStore, useRemoteServerStore } from '../../stores';
import { serverDiscoveredModels } from '../../stores/remoteServerProjection';
import { useActiveLocalModelId } from '../../hooks/useActiveMobileModel';
import { useLoadedTextModelPath } from '../../hooks/useLoadedTextModelPath';
import { useActiveModelStatus } from '../../hooks/useActiveModelStatus';
import { useActiveMobileModel } from '../../hooks/useActiveMobileModel';
import { loadingTextRowId } from './rowState';
import { usePendingModelCommand } from '../../hooks/usePendingModelCommand';
import {
  DownloadedModel,
  ONNXImageModel,
  RemoteModel,
  RemoteServer,
} from '../../types';
import { resolveSelectedTextModel } from '../../services';
import { remoteServerModelOptions } from '@offgrid/application';
import {
  selectModelRoute,
  unloadAndClearModel,
} from '../../services/modelServices/modelFacadeCommands';
import {
  CustomAlert,
  AlertState,
  initialAlertState,
  showAlert,
} from '../CustomAlert';
import { createAllStyles } from './styles';
import { TextTab } from './TextTab';
import { ImageTab } from './ImageTab';
import {
  isSuspiciousRecoveredImageModel,
  isSuspiciousRecoveredTextModel,
  isUnsupportedJetsamImageModel,
} from '@offgrid/application';
import logger from '../../utils/logger';

type TabType = 'text' | 'image';

const remoteModelId = (model: { source: string; id: string } | null) =>
  model?.source === 'remote' ? model.id : null;

const remoteServerId = (model: { source: string; serverId?: string } | null) =>
  model?.source === 'remote' ? model.serverId ?? null : null;

function evidenceBasedRemoteCapabilities(
  evidence?: Partial<RemoteModel['capabilities']>,
): RemoteModel['capabilities'] {
  // RemoteModel predates Shared's evidence-based capability contract and still
  // declares these fields as required. An empty projection preserves "unknown"
  // at runtime instead of inventing negative capability evidence.
  return { ...evidence } as RemoteModel['capabilities'];
}

/** A server's text rows are the store's derived read of its catalog. */
const savedTextModels = serverDiscoveredModels;

function savedImageModels(server: RemoteServer): RemoteModel[] {
  return remoteServerModelOptions([server], 'image').map(option => ({
    id: option.id,
    name: option.name,
    serverId: option.serverId,
    capabilities: evidenceBasedRemoteCapabilities(option.capabilities),
    details: { serverName: option.serverName },
    lastUpdated: server.createdAt,
  }));
}

function selectLocalImageModelOnDemand(
  model: ONNXImageModel,
): Promise<void> {
  return selectModelRoute({
    source: 'local',
    hostId: model.backend ?? 'image-runtime',
    modality: 'image',
    modelId: model.id,
  });
}

interface ModelSelectorModalProps {
  visible: boolean;
  onClose: () => void;
  onSelectModel: (model: DownloadedModel) => void;
  onUnloadModel: () => void;
  onUnloadImageModel?: () => void;
  isLoading: boolean;
  initialTab?: TabType;
  onAddServer?: () => void;
  onSelectionComplete?: () => void;
  onBrowseModels?: (tab: 'text' | 'image') => void;
}

export const ModelSelectorModal: React.FC<ModelSelectorModalProps> = ({
  visible,
  onClose,
  onSelectModel,
  onUnloadModel,
  onUnloadImageModel,
  isLoading,
  initialTab = 'text',
  onAddServer,
  onSelectionComplete,
  onBrowseModels,
}) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createAllStyles);
  const downloadedModels = useAppStore(s => s.downloadedModels);
  const downloadedImageModels = useAppStore(s => s.downloadedImageModels);
  const activeImageModelId = useActiveLocalModelId('image');
  const activeModelId = useActiveLocalModelId('text');
  // "Currently loaded" comes from the ONE reactive source (ActiveModelService's loaded state, projected to
  // the store) — engine-agnostic and never stale. Callers no longer pass it, so the sheet can't disagree
  // with the overview (which reads activeModelId, the SELECTION). See useLoadedTextModelPath.
  const currentModelPath = useLoadedTextModelPath();
  // Under deferred loading no model is loaded until first send, so `currentModelPath`
  // (the loaded path) is null and the switcher would show "Available Models" with
  // nothing marked active. Fall back to the SELECTED model so the user can see and
  // switch their active model before it's loaded.
  // Resolved by the shared state projection, so a selected id whose entry was rebuilt
  // under a different id still marks its row instead of leaving the sheet looking empty.
  const selectedModelPath =
    resolveSelectedTextModel()?.filePath ?? null;
  const servers = useRemoteServerStore(s => s.servers);
  const serverHealth = useRemoteServerStore(s => s.serverHealth);
  const activeTextRoute = useActiveMobileModel('text').model;
  const activeImageRoute = useActiveMobileModel('image').model;
  const activeRemoteTextModelId = remoteModelId(activeTextRoute);
  const activeRemoteImageModelId = remoteModelId(activeImageRoute);
  const [activeTab, setActiveTab] = useState<TabType>(initialTab);
  const [isLoadingImage, setIsLoadingImage] = useState(false);
  // Which text row shows the spinner: the model the SERVICE is loading, and only while it is loading.
  //
  // This used to be the row the user tapped, cleared by an effect on the parent's isLoading. Tapping a
  // row deliberately does not start a load (selecting only MARKS a model; the load is deferred to the
  // first message), so isLoading never transitioned and the spinner ran forever - a row that claimed
  // to be loading a model nothing was loading (device, 2026-07-31). Deriving it from the owner means
  // the sheet cannot invent a load, and it still spins the right row for a reload of the active model.
  const modelStatus = useActiveModelStatus();
  // A remote handoff is a round trip to the server. The owner says which route it is switching to.
  const pendingText = usePendingModelCommand('text');
  const pendingImage = usePendingModelCommand('image');
  const pendingRemoteTextModelId =
    pendingText?.source === 'remote' ? pendingText.modelId : null;
  const pendingRemoteImageModelId =
    pendingImage?.source === 'remote' ? pendingImage.modelId : null;
  const effectiveLoadingTextModelId = loadingTextRowId(
    modelStatus,
    isLoading,
    activeModelId,
  );
  const [alertState, setAlertState] = useState<AlertState>(initialAlertState);

  const filteredDownloadedModels = useMemo(
    () =>
      downloadedModels.filter(model => !isSuspiciousRecoveredTextModel(model)),
    [downloadedModels],
  );
  const filteredDownloadedImageModels = useMemo(
    () =>
      downloadedImageModels.filter(
        model =>
          !isSuspiciousRecoveredImageModel(model) &&
          !isUnsupportedJetsamImageModel(model),
      ),
    [downloadedImageModels],
  );

  useEffect(() => {
    if (visible) setActiveTab(initialTab);
  }, [visible, initialTab]);

  // Group remote models by server for TextTab — exclude servers known to be offline
  const remoteTextModels = useMemo(() => {
    return servers
      .filter(server => serverHealth[server.id]?.status !== 'unhealthy')
      .map(server => ({
        serverId: server.id,
        serverName: server.name,
        models: savedTextModels(server),
      }))
      .filter(group => group.models.length > 0);
  }, [servers, serverHealth]);

  const remoteImageModels = useMemo(() => {
    return servers
      .filter(server => serverHealth[server.id]?.status !== 'unhealthy')
      .map(server => ({
        serverId: server.id,
        serverName: server.name,
        models: savedImageModels(server),
      }))
      .filter(group => group.models.length > 0);
  }, [servers, serverHealth]);

  const handleSelectImageModel = async (model: ONNXImageModel) => {
    if (activeImageModelId === model.id) return;
    try {
      // Selection records intent only. The first image operation owns admission
      // and loading through Shared, just as the text route does.
      await selectLocalImageModelOnDemand(model);
      onSelectionComplete?.();
    } catch (error) {
      logger.error('[ModelSelectorModal] Failed to select image model:', error);
      setAlertState(
        showAlert('Failed to Select Model', (error as Error).message),
      );
    }
  };

  const handleUnloadImageModel = async () => {
    setIsLoadingImage(true);
    try {
      await unloadAndClearModel('image');
      onUnloadImageModel?.();
    } catch (error) {
      logger.error('Failed to unload image model:', error);
    } finally {
      setIsLoadingImage(false);
    }
  };

  const handleSelectRemoteTextModel = async (
    model: RemoteModel,
    serverId: string,
  ) => {
    try {
      // Always go through the owner. It also waits for an in-flight local load,
      // which is not yet visible as a loaded native model.
      await selectModelRoute({
        source: 'remote',
        hostId: serverId,
        modality: 'text',
        modelId: model.id,
      });
      onSelectionComplete?.();
    } catch (error) {
      logger.error(
        '[ModelSelectorModal] Failed to set remote text model:',
        error,
      );
      setAlertState(
        showAlert('Failed to Select Model', (error as Error).message),
      );
    }
  };

  // Handle selecting a remote vision model
  const handleSelectRemoteVisionModel = async (
    model: RemoteModel,
    serverId: string,
  ) => {
    try {
      await selectModelRoute({
        source: 'remote',
        hostId: serverId,
        modality: 'image',
        modelId: model.id,
      });
      onSelectionComplete?.();
    } catch (error) {
      logger.error(
        '[ModelSelectorModal] Failed to set remote vision model:',
        error,
      );
      setAlertState(
        showAlert('Failed to Select Model', (error as Error).message),
      );
    }
  };

  // Handle selecting a local model - clear remote selection. The tap records a SELECTION; the row
  // reflects that as selected, and shows a spinner only once the service actually starts loading.
  const handleSelectLocalModel = (model: DownloadedModel) => {
    onSelectModel(model);
  };

  // Handle unload - also clear remote selection
  const handleUnloadModel = () => {
    onUnloadModel();
  };

  const isAnyLoading = isLoading || isLoadingImage || pendingText !== null || pendingImage !== null;

  return (
    <AppSheet
      visible={visible}
      onClose={onClose}
      snapPoints={['40%', '75%']}
      title={activeTab === 'image' ? 'IMAGE MODEL' : 'TEXT MODEL'}
    >

        {/* Text-model loading now shows an inline spinner ON the selected row (TextTab → ModelRow),
            not a banner over the list. The image tab keeps its own indicator, so no banner for text. */}

      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.contentContainer}
      >
          {activeTab === 'text' ? (
            <TextTab
              downloadedModels={filteredDownloadedModels}
              remoteModels={remoteTextModels}
              currentModelPath={currentModelPath}
              selectedModelPath={selectedModelPath}
              currentRemoteModelId={activeRemoteTextModelId}
              isAnyLoading={isAnyLoading}
              loadingModelId={effectiveLoadingTextModelId}
              loadingRemoteModelId={pendingRemoteTextModelId}
              onSelectModel={handleSelectLocalModel}
              onSelectRemoteModel={handleSelectRemoteTextModel}
              onUnloadModel={handleUnloadModel}
            onAddServer={() => {
              onClose();
              onAddServer?.();
            }}
            onBrowseModels={
              onBrowseModels ? () => onBrowseModels('text') : undefined
            }
            />
          ) : (
            <ImageTab
              downloadedImageModels={filteredDownloadedImageModels}
            remoteVisionModels={remoteImageModels}
              activeImageModelId={activeImageModelId}
              activeRemoteImageModelId={activeRemoteImageModelId}
            activeRemoteImageServerId={remoteServerId(activeImageRoute)}
              isAnyLoading={isAnyLoading}
              isLoadingImage={isLoadingImage}
              loadingModelId={null}
              loadingRemoteModelId={pendingRemoteImageModelId}
              onSelectImageModel={handleSelectImageModel}
              onSelectRemoteVisionModel={handleSelectRemoteVisionModel}
              onUnloadImageModel={handleUnloadImageModel}
            onBrowseModels={
              onBrowseModels ? () => onBrowseModels('image') : undefined
            }
            />
          )}
        </ScrollView>

      {onBrowseModels && (
        <TouchableOpacity
          style={[
            localStyles.browseMoreButton,
            { borderTopColor: colors.border },
          ]}
          onPress={() => onBrowseModels(activeTab)}
        >
          <Text
            style={[localStyles.browseMoreText, { color: colors.textMuted }]}
          >
            Browse more models
          </Text>
          <Icon name="arrow-right" size={16} color={colors.textMuted} />
        </TouchableOpacity>
      )}
      <CustomAlert
        {...alertState}
        onClose={() => setAlertState(initialAlertState)}
      />
    </AppSheet>
  );
};

const localStyles = {
  browseMoreButton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    padding: 16,
    borderTopWidth: 1,
    gap: 8,
  },
  browseMoreText: {
    fontSize: 14,
    fontWeight: '400' as const,
  },
};
