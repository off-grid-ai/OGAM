import { useEffect, useState, useRef, useCallback } from 'react';
import { InteractionManager } from 'react-native';
import {
  AlertState,
  initialAlertState,
  showAlert,
  hideAlert,
} from '../../../components';
import {
  useAppStore,
  useChatStore,
  useRemoteServerStore,
} from '../../../stores';
import {
  modelManager,
  hardwareService,
  activeModelService,
  ResourceUsage,
  remoteServerManager,
} from '../../../services';
import { Conversation, RemoteModel } from '../../../types';
import { useModelLoading } from './useModelLoading';
import { useLANDiscovery } from './useLANDiscovery';
import { useRemoteModelHandlers } from './useRemoteModelHandlers';
import { useActiveTextModel } from '../../../hooks/useActiveTextModel';
import { resolveAutoDiscoverMigration } from '../../../utils/remoteAutoDiscovery';
import logger from '../../../utils/logger';
import { mostRecentConversations } from '../../../utils/conversationOrdering';
import { remoteServerModelOptions } from '../../../services/remoteModelSelection';
import { ejectAllModelsForUser } from '../../../services/userModelEjection';
// Shared hook types live in ./types so the sub-hooks can import them without importing this file
// (which imports them back — a cycle). Re-exported here for existing external importers.
import type {
  HomeScreenNavigationProp,
  ModelPickerType,
  LoadingState,
} from './types';

export type { HomeScreenNavigationProp, ModelPickerType, LoadingState };

// Track if we've synced native state to avoid repeated calls
let hasInitializedNativeSync = false;
let lanDiscoveryState: 'idle' | 'scheduled' | 'complete' = 'idle';

function deleteConversationWithAlert(
  conversation: Conversation,
  setAlertState: (s: AlertState) => void,
  deleteConversation: (id: string) => void,
) {
  setAlertState(
    showAlert('Delete Conversation', `Delete "${conversation.title}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          setAlertState(hideAlert());
          deleteConversation(conversation.id);
        },
      },
    ]),
  );
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

  const { conversations, setActiveConversation, deleteConversation } =
    useChatStore();

  // Remote server store for remote models
  const {
    servers: remoteServers,
    discoveredModels: remoteDiscoveredModels,
    activeRemoteTextModelId,
    activeRemoteImageModelId,
    activeRemoteMediaServerIds,
  } = useRemoteServerStore();

  const {
    handleSelectTextModel: _handleSelectTextModel,
    handleUnloadTextModel: _handleUnloadTextModel,
    handleSelectImageModel: _handleSelectImageModel,
    handleUnloadImageModel,
  } = useModelLoading({
    setLoadingState,
    setPickerType,
    setAlertState,
  });

  // Wrap local model handlers to clear any active remote server first
  const handleSelectTextModel = useCallback(
    (model: Parameters<typeof _handleSelectTextModel>[0]) => {
      remoteServerManager.clearActiveRemoteTextModel();
      return _handleSelectTextModel(model);
    },
    [_handleSelectTextModel],
  );

  const handleUnloadTextModel = useCallback(() => {
    remoteServerManager.clearActiveRemoteTextModel();
      return _handleUnloadTextModel();
  }, [_handleUnloadTextModel]);

  const handleSelectImageModel = useCallback(
    (model: Parameters<typeof _handleSelectImageModel>[0]) => {
      remoteServerManager.clearActiveRemoteMediaModel('image');
      return _handleSelectImageModel(model);
    },
    [_handleSelectImageModel],
  );

  const { model: activeTextModel, modelId: activeTextModelId, modelName: activeTextModelName } =
    useActiveTextModel();

  const { runLANDiscovery } = useLANDiscovery({ navigation, setAlertState });

  const {
    handleSelectRemoteTextModel,
    handleUnloadRemoteTextModel,
    handleSelectRemoteImageModel,
    handleUnloadRemoteImageModel,
  } = useRemoteModelHandlers({
    activeModelId,
    setPickerType,
    setLoadingState,
    setAlertState,
  });

  useEffect(() => {
    let lanDiscoveryTimer: ReturnType<typeof setTimeout> | null = null;
    let cancelHydrationListener: (() => void) | null = null;
    let cancelled = false;
    const task = InteractionManager.runAfterInteractions(() => {
      loadData();
      if (!hasInitializedNativeSync) {
        hasInitializedNativeSync = true;
        activeModelService.syncWithNativeState();
      }
      if (lanDiscoveryState === 'idle') {
        lanDiscoveryState = 'scheduled';
        // One-time default for the auto-discover toggle: fresh installs → OFF; grandfather users who
        // already had a gateway → ON. Guard on the remote-server store being hydrated so we read the
        // real (persisted) server list, not the empty initial state. runLANDiscovery self-gates on
        // the resulting setting, so a slow hydration simply skips this launch (correct next launch).
        const migrateAndScheduleDiscovery = (): void => {
          if (cancelled) return;
          const next = resolveAutoDiscoverMigration(
            useAppStore.getState().settings.autoDiscoverRemoteModels,
            useRemoteServerStore.getState().servers.length > 0,
          );
          if (next !== undefined)
            useAppStore
              .getState()
              .updateSettings({ autoDiscoverRemoteModels: next });
          // Delay LAN scan so the home screen is fully rendered and interactive first.
          // Start this delay only after persisted remote settings are available, or the
          // scan can read the empty initial store and skip a valid saved gateway.
          lanDiscoveryTimer = setTimeout(() => {
            lanDiscoveryTimer = null;
            if (cancelled) {
              lanDiscoveryState = 'idle';
              return;
            }
            runLANDiscovery();
            lanDiscoveryState = 'complete';
          }, 3000);
        };
        // `.persist` is a zustand-middleware addition; guard it so this is safe under test mocks
        // that don't include it (treat "no persist API" as already-hydrated).
        const persistApi = (
          useRemoteServerStore as {
          persist?: {
            hasHydrated?: () => boolean;
            onFinishHydration?: (cb: () => void) => (() => void) | void;
          };
          }
        ).persist;
        if (!persistApi?.hasHydrated || persistApi.hasHydrated()) {
          migrateAndScheduleDiscovery();
        } else {
          cancelHydrationListener =
            persistApi.onFinishHydration?.(migrateAndScheduleDiscovery) ?? null;
        }
      }
    });
    isFirstMount.current = false;
    return () => {
      cancelled = true;
      task.cancel();
      cancelHydrationListener?.();
      if (lanDiscoveryTimer !== null) {
        clearTimeout(lanDiscoveryTimer);
      }
      if (lanDiscoveryState === 'scheduled') lanDiscoveryState = 'idle';
    };

    // This is an intentional mount owner. The effect registers and cancels its own delayed work.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    const unsubscribe = activeModelService.subscribe(() => {
      refreshMemoryInfo();
    });
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
    if (!hasLocalModels && !hasRemoteModel) {
      return;
    }

    const doEjectAll = async () => {
      setAlertState(hideAlert());
      setIsEjecting(true);
      setLoadingState({
        isLoading: true,
        type: 'text',
        modelName: 'Ejecting models...',
      });
      // Let the overlay render before blocking the bridge
      await new Promise<void>(resolve =>
        InteractionManager.runAfterInteractions(() => setTimeout(resolve, 350)),
      );
      try {
        // Single owning side-effect — same cancellation + unload path as Chat.
        const { count } = await ejectAllModelsForUser();
        if (count > 0) {
          setAlertState(
            showAlert('Done', `Unloaded ${count} model${count > 1 ? 's' : ''}`),
          );
        }
      } catch (_error) {
        setAlertState(showAlert('Error', 'Failed to unload models'));
      } finally {
        setIsEjecting(false);
        setLoadingState({ isLoading: false, type: null, modelName: null });
      }
    };
    setAlertState(
      showAlert(
      'Eject All Models',
      'Unload all active models to free up memory?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Eject All',
          style: 'destructive',
            onPress: () => {
              doEjectAll();
            },
        },
        ],
      ),
    );
  };

  const startNewChat = () => {
    // Allow image-only users to start a chat; conversation is lazily created in useChatScreen
    if (!activeTextModelId && !activeImageModelId) {
      return;
    }
    navigation.navigate('Chat', {});
  };

  const continueChat = (conversationId: string) => {
    setActiveConversation(conversationId);
    navigation.navigate('Chat', { conversationId });
  };

  const handleDeleteConversation = (conversation: Conversation) =>
    deleteConversationWithAlert(
      conversation,
      setAlertState,
      deleteConversation,
    );

  const remoteImageModels: RemoteModel[] = remoteServerModelOptions(
    remoteServers,
    'image',
  ).map(option => ({
    id: option.id,
    name: option.name,
    serverId: option.serverId,
    capabilities: {
      supportsVision: false,
      supportsToolCalling: false,
      supportsThinking: false,
    },
    details: { serverName: option.serverName },
    lastUpdated: '',
  }));
  const activeRemoteImageServerId = activeRemoteMediaServerIds.image;
  const activeRemoteImageModel =
    activeRemoteImageModelId && activeRemoteImageServerId
      ? remoteImageModels.find(
          model =>
            model.id === activeRemoteImageModelId &&
            model.serverId === activeRemoteImageServerId,
        )
    : null;

  const activeImageModel =
    activeRemoteImageModel ||
    downloadedImageModels.find(m => m.id === activeImageModelId) ||
    null;
  // Ordered, not just the store's first four - otherwise "Recent" can list older chats than
  // the ones just used, and disagrees with the Chats list and desktop.
  const recentConversations = mostRecentConversations(conversations, 4);

  // Get all remote text models — includes vision-language models since they do text generation too
  const remoteTextModels: RemoteModel[] = remoteServers.flatMap(
    server => remoteDiscoveredModels[server.id] || [],
  );

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
    activeTextModelId,
    activeTextModelName,
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
