import { useModelResidencyStore } from '../../stores/modelResidencyStore';
import { useRef, useState, useCallback, useMemo } from 'react';
import {
  NavigationProp,
  useNavigation,
  useRoute,
  RouteProp,
} from '@react-navigation/native';
import { AlertState, initialAlertState } from '../../components';
import { useAppStore, useChatStore } from '../../stores';
import { useDiscoveredRemoteModels } from '../../hooks/useDiscoveredRemoteModels';
import { useActiveTextCapabilities } from '../../hooks/useActiveTextCapabilities';
import { useSyncIdentityStore } from '../../stores/syncIdentityStore';
import { useRemoteChatStreamPreviews } from './useRemoteChatStreamPreviews';
import { useHasActiveStreamText } from './useActiveStreamText';
import { useActiveTextModel } from '../../hooks/useActiveTextModel';
import { useActiveMobileModel } from '../../hooks/useActiveMobileModel';
import { useMobileModelInventory } from '../../hooks/useMobileModelInventory';
import {
  useModelsProjection,
  useWorkspaceContentProjection,
} from '../../hooks/useApplicationProjection';
import { hardwareService } from '../../services';
import { useGeneratingConversationId } from '../../hooks/useGenerationSession';
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
  isStreamingActiveConversation,
  useChatAudioLifecycle,
  useChatConversationLifecycle,
  useChatPresentationLifecycle,
  useChatRuntimeSubscriptions,
} from './useChatScreenLifecycle';
import { useChatScreenActions } from './useChatScreenActions';
import type { RuntimeModel } from '@offgrid/application';
import { useGeneratedImageGalleryProjection } from '../../services/adapters/generated-image-gallery/useGeneratedImageGalleryProjection';

export type { AlertState };
export type { ChatMessageItem } from './types';
export { getPlaceholderText } from './types';
export { computePendingSettings } from './pendingSettings';

type ChatScreenRouteProp = RouteProp<RootStackParamList, 'Chat'>;

/**
 * A model can make chat available only when Shared says that its route is ready
 * and the route can serve a chat turn. Embedding and operation-only sidecars are
 * inventory entries, but they are not chat routes.
 */
export function hasUsableChatRoute(models: readonly RuntimeModel[]): boolean {
  return models.some(
    model =>
      model.ready && (model.modality === 'text' || model.modality === 'image'),
  );
}

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
  // Which replies ended early. The shared chat rules already wrote that onto the saved turn when
  // this conversation was recovered, so the screen reads their answer rather than deciding itself.
  const stoppedEarlyMessageIds = new Set(
    workspaceContent.chatTurns
      .filter(
        turn =>
          turn.conversationId === activeConversationId &&
          turn.status === 'interrupted',
      )
      .flatMap(turn => turn.responseMessageIds),
  );
  return {
    id: record.id,
    title: record.title,
    modelId: record.modelId ?? '',
    messages: workspaceContent.messages
      .filter(message => message.conversationId === activeConversationId)
      .map(message => {
        const row = toWorkspaceMessage(message);
        return stoppedEarlyMessageIds.has(message.id)
          ? { ...row, stoppedEarly: true }
          : row;
      }),
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
  // The store owns "the text model is loading", not this component. The live-stream service
  // subscribes to that store, so a paired device learns about the wait by construction instead of
  // sitting on "Preparing reply..." while this phone says "Loading Qwen3.5 2B".
  const isModelLoading = useChatStore(state => state.isModelLoading);
  const setIsModelLoading = useChatStore(state => state.setIsModelLoading);
  const setLoadingModelName = useChatStore(state => state.setLoadingModelName);
  const [loadingModel, setLoadingModelState] = useState<DownloadedModel | null>(
    null,
  );
  const setLoadingModel = useCallback(
    (model: DownloadedModel | null) => {
      setLoadingModelState(model);
      setLoadingModelName(model?.name ?? null);
    },
    [setLoadingModelName],
  );
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
  // Owned by the generationSession service (single owner); observed reactively here.
  const generatingConversationId = useGeneratingConversationId();
  // Stashed when the model selector opens with no text model; replayed on pick.
  const pendingMessageRef = useRef<{
    text: string;
    attachments?: MediaAttachment[];
  } | null>(null);
  const modelLoadStartTimeRef = useRef<number | null>(null);
  const genDepsRef = useRef<GenerationDeps | null>(null);
  useChatAudioLifecycle(navigation);
  const { imageGenState, isCompacting, queueCount, queuedTexts } =
    useChatRuntimeSubscriptions();

  // One selector per fact. Subscribing to the WHOLE app store re-ran this hook (and rebuilt the
  // screen model) on every unrelated app-store write - a download progress tick, an image model
  // list refresh, or another UI/device-state update.
  const downloadedModels = useAppStore(s => s.downloadedModels);
  const loadedSettings = useAppStore(s => s.loadedSettings);
  const downloadedImageModels = useAppStore(s => s.downloadedImageModels);
  // Actions are created once with the store, so each of these is a stable reference and never
  // causes a render on its own. They are kept as separate selectors rather than bundled with the
  // data above so nothing has to shallow-compare a mixed object of functions and live values.
  const setDownloadedImageModels = useAppStore(s => s.setDownloadedImageModels);
  const setAppIsGeneratingImage = useAppStore(s => s.setIsGeneratingImage);
  const setAppImageGenerationStatus = useAppStore(
    s => s.setImageGenerationStatus,
  );
  // Model policy is committed and published by Shared Models. Keep the exact reactive record so
  // reload comparison, generation details, and debug prompt cannot drift from another store copy.
  const settings = useModelsProjection().settings;
  const generatedImages = useGeneratedImageGalleryProjection();
  const textModelEvicted = useModelResidencyStore(s => s.textModelEvicted);

  const discoveredModels = useDiscoveredRemoteModels();

  // Selection only (which conversation is open) - ephemeral UI/navigation state, not durable
  // content. The conversation's durable facts and transcript come only from Workspace Content below.
  const activeConversationId = useChatStore(s => s.activeConversationId);
  const streamingForConversationId = useChatStore(
    s => s.streamingForConversationId,
  );
  const isStreaming = useChatStore(s => s.isStreaming);
  const isThinking = useChatStore(s => s.isThinking);
  // Whether the live reply has text yet - NOT the text. The text is its own projection, read by the
  // one row that draws it (useActiveStreamText), so a ~20/sec token flush never reaches this hook.
  const hasStreamingText = useHasActiveStreamText();
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
  const activeImageSnapshot = useActiveMobileModel('image');
  const availableModels = useMobileModelInventory();

  // activeModel is for LOCAL models only (for file path, memory checks, etc.)
  const activeModel = activeModelInfo.isRemote
    ? undefined
    : (activeModelInfo.model as DownloadedModel | undefined);
  const activeRemoteModel = activeModelInfo.isRemote
    ? (activeModelInfo.model as RemoteModel | null)
    : null;
  const hasTextModel = activeModelInfo.modelId !== null;
  const hasActiveModel = hasTextModel || activeImageSnapshot.model !== null;
  const activeModelName = activeModelInfo.modelName;
  const hasAvailableModels = hasUsableChatRoute(availableModels);

  const effectiveProjectId = activeConversation
    ? activeConversation.projectId
    : pendingProjectId;
  const activeProject = effectiveProjectId
    ? projects.find(project => project.id === effectiveProjectId) ?? null
    : null;
  const activeImageModel =
    activeImageSnapshot.model?.source === 'local'
      ? downloadedImageModels.find(
          model => model.id === activeImageSnapshot.model?.id,
        )
      : activeImageSnapshot.model?.serverId
      ? discoveredModels[activeImageSnapshot.model.serverId]?.find(
          model => model.id === activeImageSnapshot.model?.id,
        )
      : undefined;
  const imageModelLoaded = !!activeImageModel;
  const isGeneratingImage = imageGenState.isGenerating;
  const isStreamingForThisConversation = isStreamingActiveConversation(
    streamingForConversationId,
    activeConversationId,
  );

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
    downloadedModels,
    setAlertState,
    setIsClassifying,
    setAppImageGenerationStatus,
    setAppIsGeneratingImage,
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
        setLoadingModel,
        setIsModelLoading,
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
    setIsModelLoading,
    setLoadingModel,
    setShowModelSelector,
    setAlertState,
    modelLoadStartTimeRef,
  };

  useChatConversationLifecycle({
    routeConversationId: route.params?.conversationId,
    routeProjectId: route.params?.projectId,
    activeConversationId,
    setActiveConversation,
    setPendingProjectId,
  });

  useChatImageModelEffects({
    setDownloadedImageModels,
  });

  const isGeneratingForThisConversation =
    generatingConversationId != null &&
    generatingConversationId === activeConversationId;
  // Replies generating on paired devices. Empty unless Pro's chat-stream service is running.
  const remotePreviews = useRemoteChatStreamPreviews(activeConversationId);
  const localDeviceId = useSyncIdentityStore(s => s.localDeviceId);
  // The domain projection: WHICH rows exist. Memoized on its real inputs so a render caused by
  // something else (a modal opening, the keyboard) hands FlatList the same array back.
  const displayMessages = useMemo(
    () =>
      getDisplayMessages(activeConversation?.messages || [], {
        isThinking,
        // Token-free by design. `hasStreamingText` says the live row belongs in the list; the row
        // itself reads the text, so the list is rebuilt once per turn instead of once per flush.
        streamingMessage: '',
        streamingReasoningContent: '',
        hasStreamingText,
        isStreamingForThisConversation,
        isModelLoading,
        loadingModelName: loadingModel?.name,
        isGeneratingForThisConversation,
        remotePreviews,
        localDeviceId,
      }),
    [
      activeConversation?.messages,
      isThinking,
      hasStreamingText,
      isStreamingForThisConversation,
      isModelLoading,
      loadingModel?.name,
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
    supportsToolCalling,
    activeModel,
    settings,
    loadedSettings,
    pendingMessageRef,
    setDebugInfo,
    setAlertState,
    activeConversationId,
    activeConversation,
    hasActiveModel,
    setPendingProjectId,
    setShowProjectSelector,
    activeImageModel,
    viewerImageUri,
    setViewerImageUri,
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
    imageModelLoaded,
    isGeneratingImage,
    imageGenerationProgress: imageGenState.progress,
    imageGenerationStatus: imageGenState.status,
    imagePreviewPath: imageGenState.previewPath,
    isStreaming,
    isThinking,
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
