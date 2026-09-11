import { useRef, useState, useMemo } from 'react';
import {
  NavigationProp,
  useNavigation,
  useRoute,
  RouteProp,
} from '@react-navigation/native';
import { AlertState, initialAlertState } from '../../components';
import { useAppStore, useChatStore } from '../../stores';
import { useActiveTextCapabilities } from '../../hooks/useActiveTextCapabilities';
import { useSyncIdentityStore } from '../../stores/syncIdentityStore';
import { useRemoteChatStreamPreviews } from './useRemoteChatStreamPreviews';
import { useActiveTextModel } from '../../hooks/useActiveTextModel';
import { useActiveImageModel } from '../../hooks/useActiveImageModel';
import {
  useChatModelAccess,
  useModelsProjection,
  useWorkspaceContentProjection,
} from '../../hooks/useApplicationProjection';
import { hardwareService } from '../../services';
import {
  MediaAttachment,
  DownloadedModel,
  DebugInfo,
  RemoteModel,
  Conversation,
} from '../../types';
import { RootStackParamList } from '../../navigation/types';
import {
  ensureModelLoadedFn,
  forceLoadModelFn,
  ensureTextModelForChatFn,
  useChatImageModelEffects,
} from './useChatModelActions';
import type { GenerationDeps } from './useChatGenerationActions';
import { getDisplayMessages, toWorkspaceMessage } from './types';
import { needsVisionRepair } from '../../utils/visionRepair';
import {
  useChatAudioLifecycle,
  useChatConversationLifecycle,
  useChatPresentationLifecycle,
  useChatRuntimeSubscriptions,
} from './useChatScreenLifecycle';
import { useChatScreenActions } from './useChatScreenActions';
import { useGeneratedImageGalleryProjection } from '../../services/adapters/generated-image-gallery/useGeneratedImageGalleryProjection';

export type { AlertState };
export type { ChatMessageItem } from './types';
export { getPlaceholderText } from './types';
export { computePendingSettings } from './pendingSettings';

type ChatScreenRouteProp = RouteProp<RootStackParamList, 'Chat'>;

/**
 * The active conversation's durable facts and transcript, read only from the reactive Workspace
 * Content projection - never from a legacy Zustand mirror.
 *
 * A conversation Workspace Content created (Sync, or another Shared-owned surface) has no Zustand
 * mirror, so a legacy lookup would stay undefined for it - silently dropping its project/model
 * facts and its transcript. Reading through the canonical projection is the only path that renders
 * such a conversation correctly.
 */
function projectActiveConversation(
  workspaceContent: ReturnType<typeof useWorkspaceContentProjection>,
  activeConversationId: string | null,
): Conversation | undefined {
  if (!activeConversationId || workspaceContent.status !== 'ready')
    return undefined;
  const record = workspaceContent.conversations.find(
    c => c.id === activeConversationId,
  );
  if (!record) return undefined;
  return {
    id: record.id,
    title: record.title,
    modelId: record.modelId ?? '',
    messages: workspaceContent.messages
      .filter(message => message.conversationId === activeConversationId)
      .map(toWorkspaceMessage),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    ...(record.projectId === null ? {} : { projectId: record.projectId }),
    ...(record.compactionSummary === undefined
      ? {}
      : { compactionSummary: record.compactionSummary }),
    ...(record.compactionCutoffMessageId === undefined
      ? {}
      : { compactionCutoffMessageId: record.compactionCutoffMessageId }),
  };
}

export const useChatScreen = () => {
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const route = useRoute<ChatScreenRouteProp>();
  const [showProjectSelector, setShowProjectSelector] = useState(false);
  const [showDebugPanel, setShowDebugPanel] = useState(false);
  const [showModelSelector, setShowModelSelector] = useState(false);
  const [showSettingsPanel, setShowSettingsPanel] = useState(false);
  const [debugInfo, setDebugInfo] = useState<DebugInfo | null>(null);
  const [alertState, setAlertState] = useState<AlertState>(initialAlertState);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [isClassifying, setIsClassifying] = useState(false);
  const [viewerImageUri, setViewerImageUri] = useState<string | null>(null);
  // Capabilities are read from the shared route projection, never copied into state.
  const {
    vision: supportsVision,
    tools: supportsToolCalling,
    thinking: supportsThinking,
  } = useActiveTextCapabilities();
  const [pendingProjectId, setPendingProjectId] = useState<string | undefined>(
    route.params?.projectId,
  );
  // Stashed when the model selector opens with no text model; replayed on pick.
  const pendingMessageRef = useRef<{
    text: string;
    attachments?: MediaAttachment[];
  } | null>(null);
  const modelLoadStartTimeRef = useRef<number | null>(null);
  const genDepsRef = useRef<GenerationDeps | null>(null);
  useChatAudioLifecycle(navigation);
  const {
    imageGenState,
    isCompacting,
    queueCount,
    queuedTexts,
    generatingConversationIds,
  } = useChatRuntimeSubscriptions();

  // One selector per fact. Subscribing to the WHOLE app store re-ran this hook (and rebuilt the
  // screen model) on every unrelated app-store write - a download progress tick, an image model
  // list refresh, or another UI/device-state update.
  const downloadedModels = useAppStore(s => s.downloadedModels);
  const loadedSettings = useAppStore(s => s.loadedSettings);
  // Actions are created once with the store, so each of these is a stable reference and never
  // causes a render on its own. They are kept as separate selectors rather than bundled with the
  // data above so nothing has to shallow-compare a mixed object of functions and live values.
  const setDownloadedImageModels = useAppStore(s => s.setDownloadedImageModels);
  // Model policy is committed and published by Shared Models. Keep the exact reactive record so
  // reload comparison, generation details, and debug prompt cannot drift from another store copy.
  const settings = useModelsProjection().settings;
  const generatedImages = useGeneratedImageGalleryProjection();

  // Selection only (which conversation is open) - ephemeral UI/navigation state, not durable
  // content. The conversation's durable facts and transcript come only from Workspace Content below.
  const activeConversationId = useChatStore(s => s.activeConversationId);
  const streamingForConversationId = useChatStore(
    s => s.streamingForConversationId,
  );
  const streamingMessage = useChatStore(s => s.streamingMessage);
  const streamingReasoningContent = useChatStore(
    s => s.streamingReasoningContent,
  );
  const streamingMessageUuid = useChatStore(s => s.streamingMessageUuid);
  const clearStreamingMessage = useChatStore(s => s.clearStreamingMessage);
  const setActiveConversation = useChatStore(s => s.setActiveConversation);

  const workspaceContent = useWorkspaceContentProjection();
  const projects =
    workspaceContent.status === 'ready' ? workspaceContent.projects : [];
  const activeConversation = useMemo(
    () => projectActiveConversation(workspaceContent, activeConversationId),
    [workspaceContent, activeConversationId],
  );

  // Which text model is active, from the ONE hook that answers it (remote preferred over local, local
  // resolved by the shared model state). This screen used to re-derive it with its own copy of the rule,
  // which is how it ended up refusing to send to a model the engine had loaded.
  const activeModelInfo = useActiveTextModel();
  const activeImageModelInfo = useActiveImageModel();
  const chatModelAccess = useChatModelAccess();

  // activeModel is for LOCAL models only (for file path, memory checks, etc.)
  const activeModel = activeModelInfo.isRemote
    ? undefined
    : (activeModelInfo.model as DownloadedModel | undefined);
  const activeRemoteModel = activeModelInfo.isRemote
    ? (activeModelInfo.model as RemoteModel | null)
    : null;
  const hasTextModel = chatModelAccess.hasText;
  const hasImageModel = chatModelAccess.hasImage;
  const hasActiveModel = chatModelAccess.hasSelected;
  const activeModelName = activeModelInfo.modelName;
  const hasAvailableModels = chatModelAccess.hasAvailable;
  const isModelLoading =
    activeModelInfo.loading || activeImageModelInfo.loading;
  const loadingModelName = activeModelInfo.loading
    ? activeModelInfo.modelName
    : activeImageModelInfo.loading
    ? activeImageModelInfo.modelName
    : undefined;
  const textModelEvicted =
    activeModelInfo.selected &&
    !activeModelInfo.isRemote &&
    !activeModelInfo.ready &&
    !activeModelInfo.loading;

  const effectiveProjectId = activeConversation
    ? activeConversation.projectId
    : pendingProjectId;
  const activeProject = effectiveProjectId
    ? projects.find(project => project.id === effectiveProjectId) ?? null
    : null;
  const activeImageModel = activeImageModelInfo.model ?? undefined;
  const isGeneratingImage = imageGenState.isGenerating;
  // Shared ChatSessionQueue is the only lifecycle owner. The mobile store below is only the
  // throttled presentation buffer for partial text and reasoning events.
  const isStreaming = generatingConversationIds.length > 0;
  const isGeneratingForThisConversation =
    activeConversationId != null &&
    generatingConversationIds.includes(activeConversationId);
  const isStreamingForThisConversation =
    isGeneratingForThisConversation &&
    streamingForConversationId === activeConversationId;

  const genDeps = {
    activeModelId: activeModelInfo.modelId,
    activeModel,
    activeModelInfo,
    conversationModelId: chatModelAccess.conversationModelId,
    hasTextModel,
    supportsToolCalling,
    activeConversationId,
    activeConversation,
    activeProject,
    activeImageModel,
    imageModelLoaded: hasImageModel,
    isStreaming,
    isGeneratingImage,
    imageGenState,
    downloadedModels,
    setAlertState,
    setIsClassifying,
    clearStreamingMessage,
    setActiveConversation,
    generatedImageIds: generatedImages
      .filter(image => image.conversationId === activeConversationId)
      .map(image => image.id),
    navigation,
    setShowSettingsPanel,
    ensureModelLoaded: () => ensureModelLoadedFn(modelDeps),
    forceLoadModel: () => forceLoadModelFn(modelDeps),
    ensureTextModelForChat: () =>
      ensureTextModelForChatFn({
        setShowModelSelector,
      }),
    setPendingMessage: (text: string, attachments?: MediaAttachment[]) => {
      pendingMessageRef.current = { text, attachments };
    },
    pendingProjectId,
  };
  genDepsRef.current = genDeps;

  const modelDeps = {
    activeModel,
    activeModelId: activeModelInfo.modelId,
    activeModelInfo,
    hasActiveModel,
    activeConversationId,
    activeConversation,
    isStreaming,
    settings,
    clearStreamingMessage,
    setShowModelSelector,
    setAlertState,
    modelLoadStartTimeRef,
  };

  useChatConversationLifecycle({
    routeConversationId: route.params?.conversationId,
    routeProjectId: route.params?.projectId,
    setActiveConversation,
    setPendingProjectId,
  });

  useChatImageModelEffects({
    setDownloadedImageModels,
  });

  // Replies generating on paired devices. Empty unless Pro's chat-stream service is running.
  const remotePreviews = useRemoteChatStreamPreviews(activeConversationId);
  const localDeviceId = useSyncIdentityStore(s => s.localDeviceId);
  // The domain projection: WHICH rows exist. Memoized on its real inputs so a render caused by
  // something else (a modal opening, the keyboard) hands FlatList the same array back.
  const displayMessages = useMemo(
    () =>
      getDisplayMessages(activeConversation?.messages || [], {
        streamingMessage,
        streamingReasoningContent,
        streamingMessageUuid,
        isStreamingForThisConversation,
        isModelLoading,
        loadingModelName,
        isGeneratingForThisConversation,
        remotePreviews,
        localDeviceId,
      }),
    [
      activeConversation?.messages,
      streamingMessage,
      streamingReasoningContent,
      streamingMessageUuid,
      isStreamingForThisConversation,
      isModelLoading,
      loadingModelName,
      isGeneratingForThisConversation,
      remotePreviews,
      localDeviceId,
    ],
  );

  const animateLastN = useChatPresentationLifecycle(
    activeConversationId,
    displayMessages.length,
    isStreamingForThisConversation,
  );

  const chatActions = useChatScreenActions({
    generationDeps: genDeps,
    modelDeps,
    activeModelInfo,
    activeModel,
    settings,
    loadedSettings,
    pendingMessageRef,
    setDebugInfo,
    setAlertState,
    activeConversationId,
    activeConversation,
    setPendingProjectId,
    setShowProjectSelector,
    activeImageModel,
    viewerImageUri,
    setViewerImageUri,
  });

  return {
    isModelLoading,
    loadingModelName,
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
    ...chatActions,
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
    imageModelLoaded: hasImageModel,
    imageModelReady: activeImageModelInfo.ready,
    modelError: activeModelInfo.error ?? activeImageModelInfo.error,
    isGeneratingImage,
    imageGenerationProgress: imageGenState.progress,
    imageGenerationStatus: imageGenState.status,
    imagePreviewPath: imageGenState.previewPath,
    isStreaming,
    isCompacting,
    isGeneratingForThisConversation,
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
  };
};
