import React, { useEffect, useState, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { AppSheet } from '../AppSheet';
import { useTheme, useThemedStyles } from '../../theme';
import { useAppStore, useRemoteServerStore } from '../../stores';
import { DownloadedModel, ONNXImageModel, RemoteModel } from '../../types';
import { activeModelService, llmService, remoteServerManager } from '../../services';
import { loadModelWithOverride } from '../../services/loadModelWithOverride';
import { CustomAlert, AlertState, initialAlertState, showAlert } from '../CustomAlert';
import { createAllStyles } from './styles';
import { TextTab } from './TextTab';
import { ImageTab } from './ImageTab';
import {
  isSuspiciousRecoveredImageModel,
  isSuspiciousRecoveredTextModel,
} from '../../utils/modelSelectorFilters';
import logger from '../../utils/logger';

type TabType = 'text' | 'image';

interface ModelSelectorModalProps {
  visible: boolean;
  onClose: () => void;
  onSelectModel: (model: DownloadedModel) => void;
  onSelectImageModel?: (model: ONNXImageModel) => void;
  onUnloadModel: () => void;
  onUnloadImageModel?: () => void;
  isLoading: boolean;
  currentModelPath: string | null;
  initialTab?: TabType;
  onAddServer?: () => void;
  onSelectionComplete?: () => void;
  onBrowseModels?: (tab: 'text' | 'image') => void;
}

export const ModelSelectorModal: React.FC<ModelSelectorModalProps> = ({
  visible,
  onClose,
  onSelectModel,
  onSelectImageModel,
  onUnloadModel,
  onUnloadImageModel,
  isLoading,
  currentModelPath,
  initialTab = 'text',
  onAddServer,
  onSelectionComplete,
  onBrowseModels,
}) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createAllStyles);
  const { downloadedModels, downloadedImageModels, activeImageModelId, activeModelId } = useAppStore();
  // Under deferred loading no model is loaded until first send, so `currentModelPath`
  // (the loaded path) is null and the switcher would show "Available Models" with
  // nothing marked active. Fall back to the SELECTED model so the user can see and
  // switch their active model before it's loaded.
  const selectedModelPath = downloadedModels.find(m => m.id === activeModelId)?.filePath ?? null;
  const {
    servers,
    discoveredModels,
    serverHealth,
    activeRemoteTextModelId,
    activeRemoteImageModelId,
    setActiveRemoteImageModelId,
  } = useRemoteServerStore();

  const [activeTab, setActiveTab] = useState<TabType>(initialTab);
  const [isLoadingImage, setIsLoadingImage] = useState(false);
  const [alertState, setAlertState] = useState<AlertState>(initialAlertState);

  const filteredDownloadedModels = useMemo(
    () => downloadedModels.filter(model => !isSuspiciousRecoveredTextModel(model)),
    [downloadedModels],
  );
  const filteredDownloadedImageModels = useMemo(
    () => downloadedImageModels.filter(model => !isSuspiciousRecoveredImageModel(model)),
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
        models: discoveredModels[server.id] || [],
      })).filter(group => group.models.length > 0);
  }, [servers, discoveredModels, serverHealth]);

  // Remote image generation models — Ollama/LM Studio don't serve image gen models.
  // Vision-language models (supportsVision) are text models and belong in the text tab.
  const remoteVisionModels = useMemo(() => [], []);

  const handleSelectImageModel = async (model: ONNXImageModel) => {
    if (activeImageModelId === model.id) return;
    // Shared inline Load-Anyway flow so a memory-blocked image load offers the
    // override here too, instead of a dead-end "Failed to Load".
    await loadModelWithOverride(
      (opts) => activeModelService.loadImageModel(model.id, undefined, opts),
      {
        setAlertState,
        onAttemptStart: () => setIsLoadingImage(true),
        onAttemptEnd: () => setIsLoadingImage(false),
        onSuccess: () => {
          setActiveRemoteImageModelId(null); // clear remote selection when selecting local
          onSelectImageModel?.(model);
          onSelectionComplete?.();
        },
        onError: (error) => logger.error('Failed to load image model:', error),
      },
    );
  };

  const handleUnloadImageModel = async () => {
    setIsLoadingImage(true);
    try {
      await activeModelService.unloadImageModel();
      setActiveRemoteImageModelId(null);
      onUnloadImageModel?.();
    } catch (error) {
      logger.error('Failed to unload image model:', error);
    } finally {
      setIsLoadingImage(false);
    }
  };

  // Handle selecting a remote text model
  const handleSelectRemoteTextModel = async (model: RemoteModel, serverId: string) => {
    try {
      // Unload any active local model first — only one active model at a time
      if (llmService.isModelLoaded()) {
        await activeModelService.unloadTextModel();
      }
      await remoteServerManager.setActiveRemoteTextModel(serverId, model.id);
      onSelectionComplete?.();
    } catch (error) {
      logger.error('[ModelSelectorModal] Failed to set remote text model:', error);
      setAlertState(showAlert('Failed to Select Model', (error as Error).message));
    }
  };

  // Handle selecting a remote vision model
  const handleSelectRemoteVisionModel = async (model: RemoteModel, serverId: string) => {
    try {
      await remoteServerManager.setActiveRemoteImageModel(serverId, model.id);
      onSelectionComplete?.();
    } catch (error) {
      logger.error('[ModelSelectorModal] Failed to set remote vision model:', error);
      setAlertState(showAlert('Failed to Select Model', (error as Error).message));
    }
  };

  // Handle selecting a local model - clear remote selection
  const handleSelectLocalModel = (model: DownloadedModel) => {
    remoteServerManager.clearActiveRemoteModel();
    onSelectModel(model);
  };

  // Handle unload - also clear remote selection
  const handleUnloadModel = () => {
    remoteServerManager.clearActiveRemoteModel();
    onUnloadModel();
  };

  const isAnyLoading = isLoading || isLoadingImage;
  const hasLoadedTextModel = currentModelPath !== null || activeRemoteTextModelId !== null;
  const hasLoadedImageModel = !!activeImageModelId || activeRemoteImageModelId !== null;

  return (
    <AppSheet visible={visible} onClose={onClose} snapPoints={['40%', '75%']} title="Select Model">
        <View style={styles.tabBar}>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'text' && styles.tabActive]}
            onPress={() => setActiveTab('text')}
            disabled={isAnyLoading}
          >
            <Icon name="message-square" size={16} color={activeTab === 'text' ? colors.primary : colors.textMuted} />
            <Text style={[styles.tabText, activeTab === 'text' && styles.tabTextActive]}>Text</Text>
            {hasLoadedTextModel && (
              <View style={styles.tabBadge}>
                <View style={styles.tabBadgeDot} />
              </View>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.tab, activeTab === 'image' && styles.tabActive]}
            onPress={() => setActiveTab('image')}
            disabled={isAnyLoading}
          >
            <Icon name="image" size={16} color={activeTab === 'image' ? colors.info : colors.textMuted} />
            <Text style={[styles.tabText, activeTab === 'image' && styles.tabTextActive, activeTab === 'image' && { color: colors.info }]}>
              Image
            </Text>
            {hasLoadedImageModel && (
              <View style={[styles.tabBadge, { backgroundColor: `${colors.info}30` }]}>
                <View style={[styles.tabBadgeDot, { backgroundColor: colors.info }]} />
              </View>
            )}
          </TouchableOpacity>
        </View>

        {isAnyLoading && (
          <View style={styles.loadingBanner}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={styles.loadingText}>Loading model...</Text>
          </View>
        )}

        <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer}>
          {activeTab === 'text' ? (
            <TextTab
              downloadedModels={filteredDownloadedModels}
              remoteModels={remoteTextModels}
              currentModelPath={currentModelPath}
              selectedModelPath={selectedModelPath}
              currentRemoteModelId={activeRemoteTextModelId}
              isAnyLoading={isAnyLoading}
              onSelectModel={handleSelectLocalModel}
              onSelectRemoteModel={handleSelectRemoteTextModel}
              onUnloadModel={handleUnloadModel}
              onAddServer={() => { onClose(); onAddServer?.(); }}
              onBrowseModels={onBrowseModels ? () => onBrowseModels('text') : undefined}
            />
          ) : (
            <ImageTab
              downloadedImageModels={filteredDownloadedImageModels}
              remoteVisionModels={remoteVisionModels}
              activeImageModelId={activeImageModelId}
              activeRemoteImageModelId={activeRemoteImageModelId}
              isAnyLoading={isAnyLoading}
              isLoadingImage={isLoadingImage}
              onSelectImageModel={handleSelectImageModel}
              onSelectRemoteVisionModel={handleSelectRemoteVisionModel}
              onUnloadImageModel={handleUnloadImageModel}
              onBrowseModels={onBrowseModels ? () => onBrowseModels('image') : undefined}
            />
          )}
        </ScrollView>

      {onBrowseModels && (
        <TouchableOpacity
          style={[localStyles.browseMoreButton, { borderTopColor: colors.border }]}
          onPress={() => onBrowseModels(activeTab)}
        >
          <Text style={[localStyles.browseMoreText, { color: colors.textMuted }]}>Browse more models</Text>
          <Icon name="arrow-right" size={16} color={colors.textMuted} />
        </TouchableOpacity>
      )}
      <CustomAlert {...alertState} onClose={() => setAlertState(initialAlertState)} />
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
