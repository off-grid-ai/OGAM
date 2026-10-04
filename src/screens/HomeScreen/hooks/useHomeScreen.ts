import { useEffect, useMemo, useState, useRef, useCallback } from 'react';
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
import { useDiscoveredRemoteModels } from '../../../hooks/useDiscoveredRemoteModels';
import {
  modelLibrary,
  hardwareService,
  getResourceUsage,
  ResourceUsage,
  subscribeToModelState,
} from '../../../services';
import { Conversation, RemoteModel } from '../../../types';
import { useModelLoading } from './useModelLoading';
import { useLANDiscovery } from './useLANDiscovery';
import { useRemoteModelHandlers } from './useRemoteModelHandlers';
import { useActiveTextModel } from '../../../hooks/useActiveTextModel';
import {
  useActiveLocalModelId,
  useActiveMobileModel,
} from '../../../hooks/useActiveMobileModel';
import {
  modelsFailureMessage,
  remoteServerModelOptions,
  workflowFailureMessage,
  type WorkspaceContentSnapshot,
} from '@offgrid/application';
import logger from '../../../utils/logger';
import { applicationFacade } from '../../../services/applicationFacade';
import { useWorkspaceContentProjection } from '../../../hooks/useApplicationProjection';
import { useGeneratedImageGalleryProjection } from '../../../services/adapters/generated-image-gallery';
import { startHomeStartup } from './homeStartup';
// Shared hook types live in ./types so the sub-hooks can import them without importing this file
// (which imports them back — a cycle). Re-exported here for existing external importers.
import type {
  HomeScreenNavigationProp,
  ModelPickerType,
  LoadingState,
} from './types';
import { portableMessageText } from '../../../utils/portableMessageText';

export type { HomeScreenNavigationProp, ModelPickerType, LoadingState };

function projectHomeConversations(
  workspaceContent: WorkspaceContentSnapshot,
): Conversation[] {
  const messagesByConversation = new Map<string, Conversation['messages']>();
  for (const message of workspaceContent.messages) {
    const local = message.local as
      | Partial<Conversation['messages'][number]>
      | undefined;
    const parsedTimestamp = Date.parse(message.createdAt);
    const projected = {
      ...local,
      id: message.id,
      uuid: message.id,
      role: message.portable.role,
      content: portableMessageText(message.portable.content) ?? '',
      timestamp: Number.isNaN(parsedTimestamp) ? 0 : parsedTimestamp,
    };
    const conversationMessages = messagesByConversation.get(
      message.conversationId,
    );
    if (conversationMessages) conversationMessages.push(projected);
    else messagesByConversation.set(message.conversationId, [projected]);
  }
  return workspaceContent.conversations.map(conversation => ({
    id: conversation.id,
    title: conversation.title,
    modelId: conversation.modelId ?? '',
    messages: messagesByConversation.get(conversation.id) ?? [],
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    ...(conversation.projectId === null
      ? {}
      : { projectId: conversation.projectId }),
    ...(conversation.compactionSummary === undefined
      ? {}
      : { compactionSummary: conversation.compactionSummary }),
    ...(conversation.compactionCutoffMessageId === undefined
      ? {}
      : { compactionCutoffMessageId: conversation.compactionCutoffMessageId }),
  }));
}

function deleteConversationWithAlert(
  conversation: Conversation,
  setAlertState: (state: AlertState) => void,
): void {
  setAlertState(
    showAlert('Delete Conversation', `Delete "${conversation.title}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setAlertState(hideAlert());
          try {
            const outcome =
              await applicationFacade().workflows.deleteConversation(
                conversation.id,
              );
            if (!outcome.ok) {
              setAlertState(
                showAlert(
                  'Conversation Not Deleted',
                  workflowFailureMessage(outcome.failure),
                ),
              );
            }
          } catch (error) {
            setAlertState(
              showAlert(
                'Conversation Not Deleted',
                error instanceof Error ? error.message : String(error),
              ),
            );
          }
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

  // Subscribe only to the four app-store facts Home renders. The setters are actions and are read
  // at call time, so unrelated settings and download writes do not wake this screen.
  const downloadedModels = useAppStore(state => state.downloadedModels);
  const downloadedImageModels = useAppStore(
    state => state.downloadedImageModels,
  );
  const deviceInfo = useAppStore(state => state.deviceInfo);
  const generatedImages = useGeneratedImageGalleryProjection();
  const { setDownloadedModels, setDownloadedImageModels, setDeviceInfo } =
    useAppStore.getState();
  // Selection is read from the shared active route, never from a store mirror.
  const activeModelId = useActiveLocalModelId('text');
  const activeImageModelId = useActiveLocalModelId('image');

  const workspaceContent = useWorkspaceContentProjection();
  const setActiveConversation = useChatStore(
    state => state.setActiveConversation,
  );
  const conversations = useMemo(
    () => projectHomeConversations(workspaceContent),
    [workspaceContent],
  );

  // Remote server store for remote models
  const remoteServers = useRemoteServerStore(state => state.servers);
  const remoteDiscoveredModels = useDiscoveredRemoteModels();

  const {
    handleSelectTextModel: _handleSelectTextModel,
    handleUnloadTextModel: _handleUnloadTextModel,
    handleUnloadImageModel,
  } = useModelLoading({
    setLoadingState,
    setPickerType,
    setAlertState,
  });

  const handleSelectTextModel = _handleSelectTextModel;
  const handleUnloadTextModel = _handleUnloadTextModel;

  const {
    model: activeTextModel,
    modelId: activeTextModelId,
    isRemote: isRemoteTextModel,
  } = useActiveTextModel();
  const activeImageRoute = useActiveMobileModel('image').model;
  const activeRemoteTextModelId = isRemoteTextModel ? activeTextModelId : null;
  const activeRemoteImageModelId =
    activeImageRoute?.source === 'remote' ? activeImageRoute.id : null;

  const { runLANDiscovery } = useLANDiscovery({ navigation, setAlertState });

  const {
    handleSelectRemoteTextModel,
    handleUnloadRemoteTextModel,
    handleSelectRemoteImageModel,
    handleUnloadRemoteImageModel,
  } = useRemoteModelHandlers({
    setPickerType,
    setLoadingState,
    setAlertState,
  });

  useEffect(() => {
    const stop = startHomeStartup({
      loadData,
      runLANDiscovery,
      onStartupFailure: (failure, retry) => {
        setAlertState(
          showAlert('Startup Check Failed', modelsFailureMessage(failure), [
            {
              text: 'Retry',
              onPress: async () => {
                setAlertState(hideAlert());
                await retry();
              },
            },
          ]),
        );
      },
    });
    isFirstMount.current = false;
    return stop;

    // This is an intentional mount owner. The effect registers and cancels its own delayed work.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshMemoryInfo = useCallback(async () => {
    try {
      const info = await getResourceUsage();
      setMemoryInfo(info);
    } catch (_error) {
      logger.warn('[HomeScreen] Failed to get memory info:', _error);
    }
  }, []);

  useEffect(() => {
    refreshMemoryInfo();
    const unsubscribe = subscribeToModelState(() => {
      refreshMemoryInfo();
    });
    return () => unsubscribe();
  }, [refreshMemoryInfo]);

  const loadData = async () => {
    if (!deviceInfo) {
      const info = await hardwareService.getDeviceInfo();
      setDeviceInfo(info);
    }
    await modelLibrary.linkOrphanMmProj();
    const models = await modelLibrary.getDownloadedModels();
    setDownloadedModels(models);
    const imageModels = await modelLibrary.getDownloadedImageModels();
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
        const outcome = await applicationFacade().workflows.ejectModels();
        if (!outcome.ok) {
          setAlertState(
            showAlert('Error', modelsFailureMessage(outcome.failure)),
          );
          return;
        }
        const { count } = outcome.value;
        if (count > 0) {
          setAlertState(
            showAlert('Done', `Unloaded ${count} model${count > 1 ? 's' : ''}`),
          );
        }
      } catch (error) {
        setAlertState(
          showAlert(
            'Error',
            error instanceof Error ? error.message : 'Failed to unload models',
          ),
        );
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
    deleteConversationWithAlert(conversation, setAlertState);

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
  const activeRemoteImageServerId =
    activeImageRoute?.source === 'remote' ? activeImageRoute.serverId : null;
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
  const recentConversations = useMemo(
    () => conversations.slice(0, 4),
    [conversations],
  );

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
    activeImageModel,
    recentConversations,
    // Remote model state
    remoteTextModels,
    remoteImageModels,
    activeRemoteTextModelId,
    activeRemoteImageModelId,
    handleSelectTextModel,
    handleUnloadTextModel,
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
