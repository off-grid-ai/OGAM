import { VideoTab } from './VideoTab';
import React, { useEffect, useState, useMemo } from 'react';
import { Text, ScrollView, TouchableOpacity } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { AppSheet } from '../AppSheet';
import { useTheme, useThemedStyles } from '../../theme';
import { useAppStore, useRemoteServerStore } from '../../stores';
import { useLoadedTextModelPath } from '../../hooks/useLoadedTextModelPath';
import { useActiveModelStatus } from '../../hooks/useActiveModelStatus';
import { loadingTextRowId } from './rowState';
import {
  DownloadedModel,
  ONNXImageModel,
  RemoteModel,
  RemoteServer,
} from '../../types';
import {
  activeModelService,
  remoteServerManager,
  remoteServerModelOptions,
} from '../../services';
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
} from '../../utils/modelSelectorFilters';
import logger from '../../utils/logger';

type TabType = 'text' | 'image' | 'video';

function savedTextModels(
  server: RemoteServer,
  discovered: RemoteModel[],
): RemoteModel[] {
  return remoteServerModelOptions([server], 'text').map(
    option =>
      discovered.find(model => model.id === option.id) ?? {
        id: option.id,
        name: option.name,
        serverId: option.serverId,
        capabilities: {
          supportsVision: false,
          supportsToolCalling: false,
          supportsThinking: false,
        },
        details: { serverName: option.serverName },
        lastUpdated: server.lastHealthCheck ?? server.createdAt,
      },
  );
}

interface ModelSelectorModalProps {
  visible: boolean;
  onClose: () => void;
  onSelectModel: (model: DownloadedModel) => void;
  onSelectImageModel?: (model: ONNXImageModel) => void;
  onUnloadModel: () => void;
  onUnloadImageModel?: () => void;
  isLoading: boolean;
  initialTab?: TabType;
  onAddServer?: () => void;
  onSelectionComplete?: () => void;
  onClosed?: () => void;
  onBackToModels?: () => void;
  onBrowseModels?: (tab: 'text' | 'image' | 'video') => void;
}

export const ModelSelectorModal: React.FC<ModelSelectorModalProps> = ({
  visible,
  onClose,
  onSelectModel,
  onSelectImageModel,
  onUnloadModel,
  onUnloadImageModel,
  isLoading,
  initialTab = 'text',
  onAddServer,
  onSelectionComplete,
  onClosed,
  onBackToModels,
  onBrowseModels,
}) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createAllStyles);
  const {
    downloadedModels,
    downloadedImageModels,
    activeImageModelId,
    activeModelId,
  } = useAppStore();
  // "Currently loaded" comes from the ONE reactive source (ActiveModelService's loaded state, projected to
  // the store) — engine-agnostic and never stale. Callers no longer pass it, so the sheet can't disagree
  // with the overview (which reads activeModelId, the SELECTION). See useLoadedTextModelPath.
  const currentModelPath = useLoadedTextModelPath();
  // Under deferred loading no model is loaded until first send, so `currentModelPath`
  // (the loaded path) is null and the switcher would show "Available Models" with
  // nothing marked active. Fall back to the SELECTED model so the user can see and
  // switch their active model before it's loaded.
  // Resolved by the owning service (activeModelService), so a selected id whose entry was rebuilt
  // under a different id still marks its row instead of leaving the sheet looking empty.
  const selectedModelPath =
    activeModelService.resolveSelectedTextModel()?.filePath ?? null;
  const {
    servers,
    discoveredModels,
    serverHealth,
    activeRemoteTextModelId,
    activeRemoteImageModelId,
    activeRemoteMediaServerIds,
  } = useRemoteServerStore();

  const [activeTab, setActiveTab] = useState<TabType>(initialTab);
  const [isLoadingImage, setIsLoadingImage] = useState(false);
  const [loadingRemoteTextModelKey, setLoadingRemoteTextModelKey] = useState<
    string | null
  >(null);
  const [loadingRemoteImageModelKey, setLoadingRemoteImageModelKey] = useState<
    string | null
  >(null);
  // Which text row shows the spinner: the model the SERVICE is loading, and only while it is loading.
  //
  // This used to be the row the user tapped, cleared by an effect on the parent's isLoading. Tapping a
  // row deliberately does not start a load (selecting only MARKS a model; the load is deferred to the
  // first message), so isLoading never transitioned and the spinner ran forever - a row that claimed
  // to be loading a model nothing was loading (device, 2026-07-31). Deriving it from the owner means
  // the sheet cannot invent a load, and it still spins the right row for a reload of the active model.
  const modelStatus = useActiveModelStatus();
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
      .filter(server => serverHealth[server.id]?.isHealthy !== false)
      .map(server => ({
        serverId: server.id,
        serverName: server.name,
        models: savedTextModels(server, discoveredModels[server.id] ?? []),
      }))
      .filter(group => group.models.length > 0);
  }, [servers, discoveredModels, serverHealth]);

  const remoteImageModels = useMemo(() => {
    return servers
      .filter(server => serverHealth[server.id]?.isHealthy !== false)
      .map(server => ({
        serverId: server.id,
        serverName: server.name,
        models: remoteServerModelOptions([server], 'image').map(option => ({
          id: option.id,
          name: option.name,
          serverId: option.serverId,
          capabilities: {
            supportsVision: false,
            supportsToolCalling: false,
            supportsThinking: false,
          },
          details: { serverName: option.serverName },
          lastUpdated: server.lastHealthCheck ?? server.createdAt,
        })),
      }))
      .filter(group => group.models.length > 0);
  }, [servers, serverHealth]);

  const handleSelectImageModel = (model: ONNXImageModel) => {
    remoteServerManager.clearActiveRemoteMediaModel('image');
    useAppStore.getState().setActiveImageModelId(model.id);
    onSelectImageModel?.(model);
    if (onSelectionComplete) onSelectionComplete();
    else onClose();
  };

  const handleUnloadImageModel = async () => {
    setIsLoadingImage(true);
    try {
      await activeModelService.unloadImageModel();
      remoteServerManager.clearActiveRemoteMediaModel('image');
      onUnloadImageModel?.();
    } catch (error) {
      logger.error('Failed to unload image model:', error);
    } finally {
      setIsLoadingImage(false);
    }
  };

  // Handle selecting a remote text model
  const handleSelectRemoteTextModel = async (
    model: RemoteModel,
    serverId: string,
  ) => {
    setLoadingRemoteTextModelKey(`${serverId}:${model.id}`);
    try {
      // Always go through the owner. It also waits for an in-flight local load,
      // which is not yet visible as a loaded native model.
      await activeModelService.unloadTextModel();
      await remoteServerManager.setActiveRemoteTextModel(serverId, model.id);
      onSelectionComplete?.();
    } catch (error) {
      logger.error(
        '[ModelSelectorModal] Failed to set remote text model:',
        error,
      );
      setAlertState(
        showAlert('Failed to Select Model', (error as Error).message),
      );
    } finally {
      setLoadingRemoteTextModelKey(null);
    }
  };

  // Handle selecting a remote vision model
  const handleSelectRemoteVisionModel = async (
    model: RemoteModel,
    serverId: string,
  ) => {
    setIsLoadingImage(true);
    setLoadingRemoteImageModelKey(`${serverId}:${model.id}`);
    try {
      await remoteServerManager.setActiveRemoteImageModel(serverId, model.id);
      try {
        await activeModelService.unloadImageModel();
      } catch (error) {
        remoteServerManager.clearActiveRemoteMediaModel('image');
        throw error;
      }
      onSelectionComplete?.();
    } catch (error) {
      logger.error(
        '[ModelSelectorModal] Failed to set remote vision model:',
        error,
      );
      setAlertState(
        showAlert('Failed to Select Model', (error as Error).message),
      );
    } finally {
      setIsLoadingImage(false);
      setLoadingRemoteImageModelKey(null);
    }
  };

  // Handle selecting a local model - clear remote selection. The tap records a SELECTION; the row
  // reflects that as selected, and shows a spinner only once the service actually starts loading.
  const handleSelectLocalModel = (model: DownloadedModel) => {
    remoteServerManager.clearActiveRemoteTextModel();
    onSelectModel(model);
  };

  // Handle unload - also clear remote selection
  const handleUnloadModel = () => {
    remoteServerManager.clearActiveRemoteTextModel();
    onUnloadModel();
  };

  const isAnyLoading =
    isLoading || isLoadingImage || loadingRemoteTextModelKey !== null;
  return (
    <AppSheet
      visible={visible}
      onClose={onClose}
      onClosed={onClosed}
      onBackPress={onBackToModels}
      snapPoints={['40%', '75%']}
      title={
        activeTab === 'video'
          ? 'VIDEO MODEL'
          : activeTab === 'image'
            ? 'IMAGE MODEL'
            : 'TEXT MODEL'
      }
    >
      {/* Text-model loading now shows an inline spinner ON the selected row (TextTab → ModelRow),
            not a banner over the list. The image tab keeps its own indicator, so no banner for text. */}

      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.contentContainer}
      >
        {activeTab === 'video' ? (
          <VideoTab
            onSelect={() => {
              onSelectionComplete?.();
              onClose();
            }}
          />
        ) : activeTab === 'text' ? (
          <TextTab
            downloadedModels={filteredDownloadedModels}
            remoteModels={remoteTextModels}
            currentModelPath={currentModelPath}
            selectedModelPath={selectedModelPath}
            currentRemoteModelId={activeRemoteTextModelId}
            isAnyLoading={isAnyLoading}
            loadingModelId={effectiveLoadingTextModelId}
            loadingRemoteModelKey={loadingRemoteTextModelKey}
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
            loadedImageModelId={
              activeModelService.getLoadedModelIds().imageModelId
            }
            activeRemoteImageModelId={activeRemoteImageModelId}
            activeRemoteImageServerId={activeRemoteMediaServerIds.image ?? null}
              isAnyLoading={isAnyLoading}
              isLoadingImage={isLoadingImage}
              loadingRemoteModelKey={loadingRemoteImageModelKey}
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
