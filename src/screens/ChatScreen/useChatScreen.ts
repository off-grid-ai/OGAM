import { useRef, useState } from 'react';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { AlertState, initialAlertState } from '../../components';
import {
  useAppStore,
  useChatStore,
  useProjectStore,
  useRemoteServerStore,
} from '../../stores';
import {
  imageGenerationService,
  ImageGenerationState,
  hardwareService,
} from '../../services';
import { useGeneratingConversationId } from '../../hooks/useGenerationSession';
import { MediaAttachment, DownloadedModel, DebugInfo } from '../../types';
import { RootStackParamList } from '../../navigation/types';
import {
  ensureModelLoadedFn,
  ensureTextModelForChatFn,
  handleUnloadModelFn,
} from './useChatModelActions';
import {
  useChatImageModelEffects,
  useChatModelStateSync,
} from './useChatModelEffects';
import { handleStopFn } from './useChatGenerationActions';
import { getDisplayMessages } from './types';
import { needsVisionRepair } from '../../utils/visionRepair';
import { useChatActiveModels } from './useChatActiveModels';
import { useChatScreenEffects } from './useChatScreenEffects';
import { useChatScreenActions } from './useChatScreenActions';

export type { AlertState };
export type { ChatMessageItem } from './types';
export { getPlaceholderText } from './types';
export { computePendingSettings } from './chatScreenSettings';

type ChatScreenRouteProp = RouteProp<RootStackParamList, 'Chat'>;

export const useChatScreen = () => {
  const navigation = useNavigation();
  const route = useRoute<ChatScreenRouteProp>();
  const [isModelLoading, setIsModelLoading] = useState(false);
  const [loadingModel, setLoadingModel] = useState<DownloadedModel | null>(
    null,
  );
  const [supportsVision, setSupportsVision] = useState(false);
  const [showProjectSelector, setShowProjectSelector] = useState(false);
  const [showDebugPanel, setShowDebugPanel] = useState(false);
  const [showModelSelector, setShowModelSelector] = useState(false);
  const [showSettingsPanel, setShowSettingsPanel] = useState(false);
  const [debugInfo, setDebugInfo] = useState<DebugInfo | null>(null);
  const [alertState, setAlertState] = useState<AlertState>(initialAlertState);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [isClassifying, setIsClassifying] = useState(false);
  const [animateLastN, setAnimateLastN] = useState(0);
  const [queueCount, setQueueCount] = useState(0);
  const [queuedTexts, setQueuedTexts] = useState<string[]>([]);
  const [viewerImageUri, setViewerImageUri] = useState<string | null>(null);
  const [imageGenState, setImageGenState] = useState<ImageGenerationState>(
    imageGenerationService.getState(),
  );
  const [supportsToolCalling, setSupportsToolCalling] = useState(false);
  const [supportsThinking, setSupportsThinking] = useState(false);
  const [isCompacting, setIsCompacting] = useState(false);
  const [pendingProjectId, setPendingProjectId] = useState<string | undefined>(
    route.params?.projectId,
  );
  const lastMessageCountRef = useRef(0);
  // Owned by the generationSession service (single owner); observed reactively here.
  const generatingConversationId = useGeneratingConversationId();
  // Stashed when the model selector opens with no text model; replayed on pick.
  const pendingMessageRef = useRef<{
    text: string;
    attachments?: MediaAttachment[];
  } | null>(null);

  const modelLoadStartTimeRef = useRef<number | null>(null);
  const startGenerationRef = useRef<
    (id: string, text: string) => Promise<void>
  >(null as any);
  // Always-current genDeps for the queue drain (avoids a stale-closure capture).
  const genDepsRef = useRef<any>(null);

  const {
    activeModelId,
    downloadedModels,
    settings,
    activeImageModelId,
    downloadedImageModels,
    setDownloadedImageModels,
    setIsGeneratingImage: setAppIsGeneratingImage,
    setImageGenerationStatus: setAppImageGenerationStatus,
    removeImagesByConversationId,
    loadedSettings,
    textModelEvicted,
  } = useAppStore();

  // Remote model state - use proper selectors for reactivity
  const activeServerId = useRemoteServerStore(s => s.activeServerId);
  const activeRemoteTextModelId = useRemoteServerStore(
    s => s.activeRemoteTextModelId,
  );
  const discoveredModels = useRemoteServerStore(s => s.discoveredModels);

  const {
    activeConversationId,
    conversations,
    createConversation,
    addMessage,
    updateMessageContent,
    deleteMessagesAfter,
    streamingMessage,
    streamingReasoningContent,
    streamingForConversationId,
    isStreaming,
    isThinking,
    clearStreamingMessage,
    deleteConversation,
    setActiveConversation,
    setConversationProject,
  } = useChatStore();

  const { projects, getProject } = useProjectStore();

  const activeConversation = conversations.find(
    c => c.id === activeConversationId,
  );

  const {
    activeModelInfo,
    activeModel,
    activeRemoteModel,
    hasTextModel,
    hasActiveModel,
    activeModelName,
    activeImageModel,
    imageModelLoaded,
    hasAvailableModels,
  } = useChatActiveModels({
    activeServerId,
    activeRemoteTextModelId,
    discoveredModels,
    activeModelId,
    downloadedModels,
    activeImageModelId,
    downloadedImageModels,
  });

  const effectiveProjectId = activeConversation
    ? activeConversation.projectId
    : pendingProjectId;
  const activeProject = effectiveProjectId
    ? getProject(effectiveProjectId)
    : null;
  const isGeneratingImage = imageGenState.isGenerating;
  const isStreamingForThisConversation =
    streamingForConversationId === activeConversationId;

  const genDeps = {
    activeModelId: activeModelInfo.modelId,
    activeModel,
    activeModelInfo,
    hasActiveModel,
    hasTextModel,
    supportsToolCalling,
    activeConversationId,
    activeConversation,
    activeProject,
    activeImageModel,
    imageModelLoaded,
    isStreaming,
    isGeneratingImage,
    imageGenState,
    settings,
    downloadedModels,
    setAlertState,
    setIsClassifying,
    setAppImageGenerationStatus,
    setAppIsGeneratingImage,
    addMessage,
    clearStreamingMessage,
    deleteConversation,
    setActiveConversation,
    removeImagesByConversationId,
    navigation,
    setShowSettingsPanel,
    ensureModelLoaded: async (
      onLoadedResume?: () => void,
      noticeConversationId?: string | null,
    ) => ensureModelLoadedFn(modelDeps, onLoadedResume, noticeConversationId),
    ensureTextModelForChat: () =>
      ensureTextModelForChatFn({
        setShowModelSelector,
        setLoadingModel,
        setIsModelLoading,
      }),
    setPendingMessage: (text: string, attachments?: MediaAttachment[]) => {
      pendingMessageRef.current = { text, attachments };
    },
    createConversation,
    pendingProjectId,
  };
  genDepsRef.current = genDeps;

  const modelDeps = {
    activeModel,
    activeModelId: activeModelInfo.modelId,
    activeModelInfo,
    hasActiveModel,
    activeConversationId,
    isStreaming,
    settings,
    clearStreamingMessage,
    createConversation,
    addMessage,
    setIsModelLoading,
    setLoadingModel,
    setSupportsVision,
    setShowModelSelector,
    setAlertState,
    modelLoadStartTimeRef,
  };

  useChatImageModelEffects({ setDownloadedImageModels });
  useChatModelStateSync({
    activeModelInfo,
    activeModelId,
    activeModel,
    modelDeps,
    activeRemoteModel,
    activeRemoteTextModelId,
    isModelLoading,
    setSupportsVision,
    setSupportsToolCalling,
    setSupportsThinking,
  });

  const isGeneratingForThisConversation =
    generatingConversationId != null &&
    generatingConversationId === activeConversationId;
  const displayMessages = getDisplayMessages(
    activeConversation?.messages || [],
    {
      isThinking,
      streamingMessage,
      streamingReasoningContent,
      isStreamingForThisConversation,
      isModelLoading,
      loadingModelName: loadingModel?.name,
      isGeneratingForThisConversation,
    },
  );

  const prevStreamingRef = useRef(false);
  useChatScreenEffects({
    navigation,
    routeConversationId: route.params?.conversationId,
    routeProjectId: route.params?.projectId,
    activeConversationId,
    setActiveConversation,
    setPendingProjectId,
    setImageGenState,
    setIsCompacting,
    setQueueCount,
    setQueuedTexts,
    genDepsRef,
    startGenerationRef,
    displayMessageCount: displayMessages.length,
    lastMessageCountRef,
    setAnimateLastN,
    isStreamingForThisConversation,
    prevStreamingRef,
  });

  const actions = useChatScreenActions({
    genDeps,
    modelDeps,
    genDepsRef,
    startGenerationRef,
    pendingMessageRef,
    activeModelInfo,
    activeModel,
    activeConversationId,
    activeConversation,
    activeImageModel,
    hasActiveModel,
    supportsToolCalling,
    settings,
    loadedSettings,
    viewerImageUri,
    setViewerImageUri,
    setShowModelSelector,
    setShowProjectSelector,
    setPendingProjectId,
    setDebugInfo,
    setAlertState,
    deleteMessagesAfter,
    updateMessageContent,
    setConversationProject,
  });

  return {
    isModelLoading,
    loadingModel,
    supportsVision,
    showProjectSelector,
    setShowProjectSelector,
    showDebugPanel,
    setShowDebugPanel,
    showModelSelector,
    setShowModelSelector,
    showSettingsPanel,
    setShowSettingsPanel,
    supportsToolCalling,
    supportsThinking,
    debugInfo,
    alertState,
    setAlertState,
    showScrollToBottom,
    setShowScrollToBottom,
    isClassifying,
    animateLastN,
    queueCount,
    queuedTexts,
    viewerImageUri,
    setViewerImageUri,
    imageGenState,
    enabledTools: actions.enabledTools,
    handleToggleTool: actions.handleToggleTool,
    activeModelId: activeModelInfo.modelId,
    activeConversationId,
    activeConversation,
    activeModel,
    activeModelInfo,
    hasActiveModel,
    hasTextModel,
    activeRemoteModel,
    activeModelName,
    activeProject,
    activeImageModel,
    imageModelLoaded,
    isGeneratingImage,
    imageGenerationProgress: imageGenState.progress,
    imageGenerationStatus: imageGenState.status,
    imagePreviewPath: imageGenState.previewPath,
    isStreaming,
    isThinking,
    isCompacting,
    isGeneratingForThisConversation,
    hasPendingSettings: actions.hasPendingSettings,
    handleReloadTextModel: actions.handleReloadTextModel,
    textModelEvicted,
    displayMessages,
    downloadedModels,
    hasAvailableModels,
    projects,
    settings,
    // The chat knows the active model IS a vision model but is missing its projector — surface repair, not a crash.
    visionNeedsRepair:
      !activeModelInfo.isRemote && needsVisionRepair(activeModel),
    navigation,
    hardwareService,
    handleSend: actions.handleSend,
    handleStop: () => handleStopFn(genDeps),
    handleModelSelect: actions.handleModelSelect,
    handleUnloadModel: () => handleUnloadModelFn(modelDeps),
    handleDeleteConversation: actions.handleDeleteConversation,
    handleCopyMessage: (_content: string) => {},
    handleRetryMessage: actions.handleRetryMessage,
    handleEditMessage: actions.handleEditMessage,
    handleSelectProject: actions.handleSelectProject,
    handleGenerateImageFromMessage: actions.handleGenerateImageFromMessage,
    handleImagePress: actions.handleImagePress,
    handleSaveImage: actions.handleSaveImage,
  };
};
