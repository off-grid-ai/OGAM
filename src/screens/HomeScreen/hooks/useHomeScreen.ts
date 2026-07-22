import { useEffect, useState, useRef, useCallback } from 'react';
import { InteractionManager } from 'react-native';
import { AlertState, initialAlertState, showAlert, hideAlert } from '../../../components';
import { useAppStore, useChatStore, useRemoteServerStore } from '../../../stores';
import { modelManager, hardwareService, activeModelService, ResourceUsage, remoteServerManager } from '../../../services';
import { Conversation, RemoteModel } from '../../../types';
import { useModelLoading } from './useModelLoading';
import { useLANDiscovery } from './useLANDiscovery';
import { useRemoteModelHandlers } from './useRemoteModelHandlers';
import { useActiveTextModel } from '../../../hooks/useActiveTextModel';
import logger from '../../../utils/logger';
// Shared hook types live in ./types so the sub-hooks can import them without importing this file
// (which imports them back — a cycle). Re-exported here for existing external importers.
import type { HomeScreenNavigationProp, ModelPickerType, LoadingState } from './types';

export type { HomeScreenNavigationProp, ModelPickerType, LoadingState };

// Track if we've synced native state to avoid repeated calls
let hasInitializedNativeSync = false;
let hasRunLANDiscovery = false;

function deleteConversationWithAlert(
  conversation: Conversation,
  setAlertState: (s: AlertState) => void,
  deleteConversation: (id: string) => void,
) {
  setAlertState(showAlert(
    'Delete Conversation',
    `Delete "${conversation.title}"?`,
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          setAlertState(hideAlert());
          deleteConversation(conversation.id);
        },
      },
    ]
  ));
}

export const useHomeScreen = (navigation: HomeScreenNavigationProp) => {
  const [pickerType, setPickerType] = useState<ModelPickerType>(null);
  const [loadingState, setLoadingState] = useState<LoadingState>({
    isLoading: false,
    type: null,
    modelName: null,
  });
  const [isEjecting, setIsEjecting] = useState(false);
  const [alertState, setAlertState] = useState<AlertState>(initialAlertState);
  const [memoryInfo, setMemoryInfo] = useState<ResourceUsage | null>(null);
  const isFirstMount = useRef(true);

  const {
    downloadedModels,
    setDownloadedModels,
    activeModelId,
    setActiveModelId: _setActiveModelId,
    downloadedImageModels,
    setDownloadedImageModels,
    activeImageModelId,
    setActiveImageModelId: _setActiveImageModelId,
    deviceInfo,
    setDeviceInfo,
    generatedImages,
  } = useAppStore();

  const { conversations, setActiveConversation, deleteConversation } = useChatStore();

  // Remote server store for remote models
  const {
    servers: remoteServers,
    discoveredModels: remoteDiscoveredModels,
    activeRemoteTextModelId,
    activeRemoteImageModelId,
    activeServerId,
  } = useRemoteServerStore();

  const {
    handleSelectTextModel: _handleSelectTextModel,
    handleUnloadTextModel: _handleUnloadTextModel,
    handleSelectImageModel,
    handleUnloadImageModel,
  } = useModelLoading({
    setLoadingState,
    setPickerType,
    setAlertState,
  });

  // Wrap local model handlers to clear any active remote server first
  const handleSelectTextModel = useCallback(
    (model: Parameters<typeof _handleSelectTextModel>[0]) => {
      remoteServerManager.clearActiveRemoteModel();
      return _handleSelectTextModel(model);
    },
    [_handleSelectTextModel],
  );

  const handleUnloadTextModel = useCallback(
    () => {
      remoteServerManager.clearActiveRemoteModel();
      return _handleUnloadTextModel();
    },
    [_handleUnloadTextModel],
  );

  const { model: activeTextModel, modelId: activeTextModelId } = useActiveTextModel();

  const { runLANDiscovery } = useLANDiscovery({ navigation, setAlertState });

  const {
    handleSelectRemoteTextModel,
    handleUnloadRemoteTextModel,
    handleSelectRemoteImageModel,
    handleUnloadRemoteImageModel,
  } = useRemoteModelHandlers({ setPickerType, setLoadingState, setAlertState });

  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(() => {
      loadData();
      if (!hasInitializedNativeSync) {
        hasInitializedNativeSync = true;
        activeModelService.syncWithNativeState();
      }
      if (!hasRunLANDiscovery) {
        hasRunLANDiscovery = true;
        // Delay LAN scan so the home screen is fully rendered and interactive first
        setTimeout(runLANDiscovery, 3000);
      }
    });
    isFirstMount.current = false;
    return () => task.cancel();

  }, []);

  const refreshMemoryInfo = useCallback(async () => {
    try {
      const info = await activeModelService.getResourceUsage();
      setMemoryInfo(info);
    } catch (_error) {
      logger.warn('[HomeScreen] Failed to get memory info:', _error);
    }
  }, []);

  useEffect(() => {
    refreshMemoryInfo();
    const unsubscribe = activeModelService.subscribe(() => { refreshMemoryInfo(); });
    return () => unsubscribe();
  }, [refreshMemoryInfo]);

  const loadData = async () => {
    if (!deviceInfo) {
      const info = await hardwareService.getDeviceInfo();
      setDeviceInfo(info);
    }
    await modelManager.linkOrphanMmProj();
    const models = await modelManager.getDownloadedModels();
    setDownloadedModels(models);
    const imageModels = await modelManager.getDownloadedImageModels();
    setDownloadedImageModels(imageModels);
  };

  const handleEjectAll = () => {
    const hasLocalModels = activeModelId || activeImageModelId;
    const hasRemoteModel = activeRemoteTextModelId || activeRemoteImageModelId;
    if (!hasLocalModels && !hasRemoteModel) { return; }

    const doEjectAll = async () => {
      setAlertState(hideAlert());
      setIsEjecting(true);
      setLoadingState({ isLoading: true, type: 'text', modelName: 'Ejecting models...' });
      // Let the overlay render before blocking the bridge
      await new Promise<void>(resolve =>
        InteractionManager.runAfterInteractions(() => setTimeout(resolve, 350))
      );
      try {
        // Single owning side-effect — same path the Chat screen dispatches.
        const { count } = await activeModelService.ejectAll();
        if (count > 0) {
          setAlertState(showAlert('Done', `Unloaded ${count} model${count > 1 ? 's' : ''}`));
        }
      } catch (_error) {
        setAlertState(showAlert('Error', 'Failed to unload models'));
      } finally {
        setIsEjecting(false);
        setLoadingState({ isLoading: false, type: null, modelName: null });
      }
    };
    setAlertState(showAlert(
      'Eject All Models',
      'Unload all active models to free up memory?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Eject All',
          style: 'destructive',
          onPress: () => { doEjectAll(); },
        },
      ]
    ));
  };

  const startNewChat = () => {
    // Allow image-only users to start a chat; conversation is lazily created in useChatScreen
    if (!activeTextModelId && !activeImageModelId) { return; }
    navigation.navigate('Chat', {});
  };

  const continueChat = (conversationId: string) => {
    setActiveConversation(conversationId);
    navigation.navigate('Chat', { conversationId });
  };

  const handleDeleteConversation = (conversation: Conversation) =>
    deleteConversationWithAlert(conversation, setAlertState, deleteConversation);

  const activeRemoteImageModel = activeRemoteImageModelId && activeServerId
    ? (remoteDiscoveredModels[activeServerId] || []).find((m) => m.id === activeRemoteImageModelId)
    : null;

  const activeImageModel = activeRemoteImageModel || downloadedImageModels.find((m) => m.id === activeImageModelId) || null;
  const recentConversations = conversations.slice(0, 4);

  // Get all remote text models — includes vision-language models since they do text generation too
  const remoteTextModels: RemoteModel[] = remoteServers.flatMap(server =>
    remoteDiscoveredModels[server.id] || []
  );

  // Remote image generation models — Ollama/LM Studio don't serve image gen models,
  // so this is intentionally empty. Vision-language models belong in remoteTextModels.
  const remoteImageModels: RemoteModel[] = [];

  return {
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
  };
};
