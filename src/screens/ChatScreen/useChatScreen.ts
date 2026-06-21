import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { AlertState, initialAlertState } from '../../components';
import { useAppStore, useChatStore, useProjectStore, useRemoteServerStore } from '../../stores';
import { callHook, HOOKS } from '../../bootstrap/hookRegistry';
import logger from '../../utils/logger';
import {
  llmService, generationService, imageGenerationService, activeModelService,
  ImageGenerationState, hardwareService, QueuedMessage,
  contextCompactionService,
} from '../../services';
import { liteRTService } from '../../services/litert';
import { Message, MediaAttachment, Project, DownloadedModel, DebugInfo, RemoteModel, INFERENCE_BACKENDS } from '../../types';
import { RootStackParamList } from '../../navigation/types';
import { ensureModelLoadedFn, ensureTextModelForChatFn, handleModelSelectFn, handleUnloadModelFn, initiateModelLoad, useChatImageModelEffects, useChatModelStateSync } from './useChatModelActions';
import { startGenerationFn, handleSendFn, handleStopFn, handleSelectProjectFn, dispatchGenerationFn } from './useChatGenerationActions';
import { handleRetryMessageFn, handleEditMessageFn, handleDeleteConversationFn, handleGenerateImageFromMsgFn } from './useChatMessageHandlers';
import { getDisplayMessages, getPlaceholderText, ChatMessageItem, StreamingState } from './types';
import { saveImageToGallery } from './useSaveImage';
import {
  isSuspiciousRecoveredImageModel,
  isSuspiciousRecoveredTextModel,
} from '../../utils/modelSelectorFilters';

export type { AlertState, ChatMessageItem, StreamingState };
export { getDisplayMessages, getPlaceholderText };

type ChatScreenRouteProp = RouteProp<RootStackParamList, 'Chat'>;

type ActiveModelInfo = {
  isRemote: boolean;
  model: DownloadedModel | RemoteModel | null;
  modelId: string | null;
  modelName: string;
};

export const useChatScreen = () => {
  const navigation = useNavigation();
  const route = useRoute<ChatScreenRouteProp>();
  const [isModelLoading, setIsModelLoading] = useState(false);
  const [loadingModel, setLoadingModel] = useState<DownloadedModel | null>(null);
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
  const [imageGenState, setImageGenState] = useState<ImageGenerationState>(imageGenerationService.getState());
  const [showToolPicker, setShowToolPicker] = useState(false);
  const [supportsToolCalling, setSupportsToolCalling] = useState(false);
  const [supportsThinking, setSupportsThinking] = useState(false);
  const [isCompacting, setIsCompacting] = useState(false);
  const [pendingProjectId, setPendingProjectId] = useState<string | undefined>(route.params?.projectId);
  const lastMessageCountRef = useRef(0);
  const generatingForConversationRef = useRef<string | null>(null);
  // Stashed when the model selector opens with no text model; replayed on pick.
  const pendingMessageRef = useRef<{ text: string; attachments?: MediaAttachment[] } | null>(null);

  // Preload the last text model in the background on chat open (skip if a
  // generation model is already loaded); shows the "Loading model" bar.
  useEffect(() => {
    const { lastTextModelId, downloadedModels } = useAppStore.getState();
    if (!lastTextModelId) return;
    const { text, image } = activeModelService.getActiveModels();
    if (text.isLoaded || text.isLoading || image.isLoaded) return;
    setLoadingModel(downloadedModels.find(m => m.id === lastTextModelId) ?? null);
    setIsModelLoading(true);
    activeModelService.loadTextModel(lastTextModelId)
      .catch(() => {})
      .finally(() => { setIsModelLoading(false); setLoadingModel(null); });
  }, []);

  // Stop TTS when navigating away, app backgrounded, or screen locked.
  // No-op without the pro audio feature.
  useEffect(() => {
    const unsubBlur = navigation.addListener('blur', () => {
      callHook(HOOKS.audioStop);
    });
    // beforeRemove fires on back button — more reliable than blur for native-stack
    const unsubRemove = navigation.addListener('beforeRemove', () => {
      callHook(HOOKS.audioStop);
    });
    const appStateSub = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active') {
        callHook(HOOKS.audioOnAppBackground);
      } else {
        callHook(HOOKS.audioOnAppForeground);
      }
    });
    return () => { unsubBlur(); unsubRemove(); appStateSub.remove(); };
  }, [navigation]);
  const modelLoadStartTimeRef = useRef<number | null>(null);
  const startGenerationRef = useRef<(id: string, text: string) => Promise<void>>(null as any);
  // Always-current genDeps for the queue drain (avoids a stale-closure capture).
  const genDepsRef = useRef<any>(null);

  const {
    activeModelId, downloadedModels, settings, activeImageModelId,
    downloadedImageModels, setDownloadedImageModels,
    setIsGeneratingImage: setAppIsGeneratingImage,
    setImageGenerationStatus: setAppImageGenerationStatus,
    removeImagesByConversationId, loadedSettings,
  } = useAppStore();

  // Remote model state - use proper selectors for reactivity
  const activeServerId = useRemoteServerStore((s) => s.activeServerId);
  const activeRemoteTextModelId = useRemoteServerStore((s) => s.activeRemoteTextModelId);
  const discoveredModels = useRemoteServerStore((s) => s.discoveredModels);

  const {
    activeConversationId, conversations, createConversation, addMessage,
    updateMessageContent, deleteMessagesAfter, streamingMessage, streamingReasoningContent,
    streamingForConversationId, isStreaming, isThinking, clearStreamingMessage,
    deleteConversation, setActiveConversation, setConversationProject,
  } = useChatStore();

  const { projects, getProject } = useProjectStore();

  const activeConversation = conversations.find(c => c.id === activeConversationId);

  // Compute active model from either local or remote source
  const activeModelInfo = useMemo((): ActiveModelInfo => {
    // Check for remote model first
    if (activeServerId && activeRemoteTextModelId) {
      const serverModels = discoveredModels[activeServerId] || [];
      const remoteModel = serverModels.find(m => m.id === activeRemoteTextModelId);
      if (remoteModel) {
        return {
          isRemote: true,
          model: remoteModel,
          modelId: remoteModel.id,
          modelName: remoteModel.name,
        };
      }
      logger.warn('[ChatScreen] Remote model not found:', activeServerId, activeRemoteTextModelId);
    }
    // Fall back to local model
    const localModel = downloadedModels.find(m => m.id === activeModelId);
    if (localModel) {
      return {
        isRemote: false,
        model: localModel,
        modelId: localModel.id,
        modelName: localModel.name,
      };
    }
    return { isRemote: false, model: null, modelId: null, modelName: 'Unknown' };
  }, [activeServerId, activeRemoteTextModelId, discoveredModels, activeModelId, downloadedModels]);

  // activeModel is for LOCAL models only (for file path, memory checks, etc.)
  const activeModel = activeModelInfo.isRemote ? undefined : (activeModelInfo.model as DownloadedModel | undefined);
  const activeRemoteModel = activeModelInfo.isRemote ? (activeModelInfo.model as RemoteModel | null) : null;
  const hasTextModel = activeModelInfo.modelId !== null;
  const hasActiveModel = hasTextModel || !!activeImageModelId;
  const activeModelName = activeModelInfo.modelName;
  const availableDownloadedTextModels = useMemo(
    () => downloadedModels.filter(model => !isSuspiciousRecoveredTextModel(model)),
    [downloadedModels],
  );
  const availableDownloadedImageModels = useMemo(
    () => downloadedImageModels.filter(model => !isSuspiciousRecoveredImageModel(model)),
    [downloadedImageModels],
  );
  const hasAvailableModels =
    availableDownloadedTextModels.length > 0 ||
    availableDownloadedImageModels.length > 0 ||
    discoveredModels[activeServerId || '']?.length > 0 ||
    Object.values(discoveredModels).some(models => models.length > 0);

  const effectiveProjectId = activeConversation ? activeConversation.projectId : pendingProjectId;
  const activeProject = effectiveProjectId ? getProject(effectiveProjectId) : null;
  const activeImageModel = downloadedImageModels.find(m => m.id === activeImageModelId);
  const imageModelLoaded = !!activeImageModel;
  const isGeneratingImage = imageGenState.isGenerating;
  const isStreamingForThisConversation = streamingForConversationId === activeConversationId;

  const genDeps = {
    activeModelId: activeModelInfo.modelId, activeModel, activeModelInfo, hasActiveModel, hasTextModel, activeConversationId, activeConversation, activeProject,
    activeImageModel, imageModelLoaded, isStreaming, isGeneratingImage, imageGenState, settings,
    downloadedModels, setAlertState, setIsClassifying, setAppImageGenerationStatus,
    setAppIsGeneratingImage, addMessage, clearStreamingMessage, deleteConversation,
    setActiveConversation, removeImagesByConversationId, generatingForConversationRef, navigation, setShowSettingsPanel,
    ensureModelLoaded: async () => ensureModelLoadedFn(modelDeps),
    ensureTextModelForChat: () => ensureTextModelForChatFn({ setShowModelSelector, setLoadingModel, setIsModelLoading }),
    setPendingMessage: (text: string, attachments?: MediaAttachment[]) => { pendingMessageRef.current = { text, attachments }; },
    createConversation,
    pendingProjectId,
  };
  genDepsRef.current = genDeps;

  const modelDeps = {
    activeModel, activeModelId: activeModelInfo.modelId, activeModelInfo, hasActiveModel, activeConversationId, isStreaming, settings,
    clearStreamingMessage, createConversation, addMessage,
    setIsModelLoading, setLoadingModel, setSupportsVision, setShowModelSelector,
    setAlertState, modelLoadStartTimeRef,
  };

  useEffect(() => {
    const unsub1 = imageGenerationService.subscribe(state => setImageGenState(state));
    const unsub2 = contextCompactionService.subscribeCompacting(setIsCompacting);
    return () => { unsub1(); unsub2(); };
  }, []);

  useEffect(() => {
    return generationService.subscribe(state => {
      setQueueCount(state.queuedMessages.length);
      setQueuedTexts(state.queuedMessages.map((m: QueuedMessage) => m.text));
    });
  }, []);

  // Drain queued messages through the same routing layer as a fresh send.
  const handleQueuedSend = useCallback(async (item: QueuedMessage) => {
    await dispatchGenerationFn(genDepsRef.current,
      { text: item.text, attachments: item.attachments, conversationId: item.conversationId }, startGenerationRef.current);
  }, []);

  useEffect(() => {
    generationService.setQueueProcessor(handleQueuedSend);
    return () => generationService.setQueueProcessor(null);
  }, [handleQueuedSend]);

  useEffect(() => {
    const { conversationId } = route.params || {};
    if (conversationId) { setActiveConversation(conversationId); }
    else { setActiveConversation(null); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.params?.conversationId]);

  useEffect(() => {
    setPendingProjectId(route.params?.projectId);
  }, [route.params?.projectId]);

  useEffect(() => {
    if (generatingForConversationRef.current && generatingForConversationRef.current !== activeConversationId) {
      generatingForConversationRef.current = null;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      if (!cancelled && llmService.isModelLoaded()) { llmService.clearKVCache(false).catch(() => { }); }
    }, 0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [activeConversationId]);

  useChatImageModelEffects({ setDownloadedImageModels, settings, activeImageModelId, downloadedModels });
  useChatModelStateSync({ activeModelInfo, activeModelId, activeModel, modelDeps, activeRemoteModel, activeRemoteTextModelId, isModelLoading, setSupportsVision, setSupportsToolCalling, setSupportsThinking });

  const isGeneratingForThisConversation = !!generatingForConversationRef.current && generatingForConversationRef.current === activeConversationId;
  const displayMessages = getDisplayMessages(activeConversation?.messages || [], { isThinking, streamingMessage, streamingReasoningContent, isStreamingForThisConversation, isModelLoading, loadingModelName: loadingModel?.name, isGeneratingForThisConversation });

  useEffect(() => {
    const prev = lastMessageCountRef.current, curr = displayMessages.length;
    if (curr > prev && prev > 0) setAnimateLastN(curr - prev);
    lastMessageCountRef.current = curr;
  }, [displayMessages.length]);
  useEffect(() => { lastMessageCountRef.current = 0; setAnimateLastN(0); }, [activeConversationId]);
  const prevStreamingRef = useRef(false);

  // Stop any in-flight TTS when a new streaming response begins.
  // No-op without the pro audio feature.
  useEffect(() => {
    if (isStreamingForThisConversation) {
      callHook(HOOKS.audioStop);
    }
  }, [isStreamingForThisConversation]);

  // When streaming ends, the pro audio feature speaks the final assistant
  // message (only if voice mode is active + TTS ready). No-op in free builds.
  useEffect(() => {
    const was = prevStreamingRef.current;
    prevStreamingRef.current = isStreamingForThisConversation;
    if (!was || isStreamingForThisConversation || !activeConversationId) return;
    callHook(HOOKS.audioOnStreamingEnd, activeConversationId);
  }, [isStreamingForThisConversation]); // eslint-disable-line react-hooks/exhaustive-deps

  const startGeneration = async (targetConversationId: string, messageText: string) => {
    await startGenerationFn(genDeps, { setDebugInfo, targetConversationId, messageText });
  };
  startGenerationRef.current = startGeneration;
  const enabledTools = supportsToolCalling ? (settings.enabledTools || []) : [];
  const handleToggleTool = (toolId: string) => {
    const cur = settings.enabledTools || [];
    useAppStore.getState().updateSettings({ enabledTools: cur.includes(toolId) ? cur.filter((id: string) => id !== toolId) : [...cur, toolId] });
  };
  // Check if there are pending settings that require model reload
  const hasPendingSettings = (() => {
    if (!loadedSettings) return false;
    // LiteRT reloads when backend or context length changes — both are baked into the engine at load time
    if (activeModel?.engine === 'litert') {
      return settings.liteRTBackend !== loadedSettings.liteRTBackend ||
             settings.liteRTMaxTokens !== loadedSettings.liteRTMaxTokens;
    }
    return (
      settings.nThreads !== loadedSettings.nThreads ||
      settings.nBatch !== loadedSettings.nBatch ||
      settings.contextLength !== loadedSettings.contextLength ||
      settings.enableGpu !== loadedSettings.enableGpu ||
      settings.inferenceBackend !== loadedSettings.inferenceBackend ||
      settings.gpuLayers !== loadedSettings.gpuLayers ||
      settings.flashAttn !== loadedSettings.flashAttn ||
      // Compare effective cache type — OpenCL forces f16 regardless of user setting
      (settings.inferenceBackend === INFERENCE_BACKENDS.OPENCL ? 'f16' : settings.cacheType) !== loadedSettings.cacheType
    );
  })();

  const handleReloadTextModel = useCallback(async () => {
    if (!activeModelInfo.modelId || activeModelInfo.isRemote) return;
    setShowModelSelector(true);
    if (activeModel?.engine === 'litert') {
      // Unload LiteRT engine before reloading with the new backend
      if (liteRTService.isModelLoaded()) {
        await liteRTService.unloadModel().catch(() => { });
      }
    // Must unload first — loadTextModel skips if the same model ID is already loaded,
    // which means setLoadedSettings would never run and the banner would persist.
    } else if (llmService.isModelLoaded()) {
      await activeModelService.unloadTextModel();
    }
    await initiateModelLoad(modelDeps, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeModelInfo.modelId, activeModelInfo.isRemote, settings, activeModel?.engine]);

  const handleSend = (text: string, attachments?: MediaAttachment[], imageMode?: 'auto' | 'force' | 'disabled') =>
    handleSendFn(genDeps, { text, attachments, imageMode, startGeneration, setDebugInfo });

  // After picking a text model, replay the stashed message (no retype needed).
  const handleModelSelect = async (model: DownloadedModel) => {
    await handleModelSelectFn(modelDeps, model);
    const pending = pendingMessageRef.current;
    if (pending) {
      pendingMessageRef.current = null;
      handleSend(pending.text, pending.attachments);
    }
  };

  return {
    isModelLoading, loadingModel, supportsVision,
    showProjectSelector, setShowProjectSelector,
    showDebugPanel, setShowDebugPanel,
    showModelSelector, setShowModelSelector,
    showSettingsPanel, setShowSettingsPanel,
    showToolPicker, setShowToolPicker, supportsToolCalling, supportsThinking,
    debugInfo, alertState, setAlertState,
    showScrollToBottom, setShowScrollToBottom,
    isClassifying, animateLastN, queueCount, queuedTexts,
    viewerImageUri, setViewerImageUri, imageGenState,
    enabledTools, handleToggleTool,
    activeModelId: activeModelInfo.modelId, activeConversationId, activeConversation, activeModel,
    activeModelInfo, hasActiveModel, hasTextModel, activeRemoteModel, activeModelName,
    activeProject, activeImageModel, imageModelLoaded, isGeneratingImage,
    imageGenerationProgress: imageGenState.progress,
    imageGenerationStatus: imageGenState.status,
    imagePreviewPath: imageGenState.previewPath,
    isStreaming, isThinking, isCompacting, isGeneratingForThisConversation, hasPendingSettings, handleReloadTextModel, displayMessages, downloadedModels, hasAvailableModels, projects, settings,
    navigation, hardwareService,
    handleSend,
    handleStop: () => handleStopFn(genDeps),
    handleModelSelect,
    handleUnloadModel: () => handleUnloadModelFn(modelDeps),
    handleDeleteConversation: () =>
      handleDeleteConversationFn(genDeps, { activeConversationId, activeConversation, setAlertState }),
    handleCopyMessage: (_content: string) => { },
    handleRetryMessage: (message: Message) =>
      handleRetryMessageFn(message, genDeps, { activeConversationId, hasActiveModel, activeConversation, deleteMessagesAfter, setDebugInfo }),
    handleEditMessage: (message: Message, newContent: string) =>
      handleEditMessageFn(genDeps, { message, newContent, activeConversationId, hasActiveModel, updateMessageContent, deleteMessagesAfter, setDebugInfo }),
    handleSelectProject: (project: Project | null) => {
      setPendingProjectId(project?.id);
      if (!activeConversationId) {
        setShowProjectSelector(false);
      } else {
        handleSelectProjectFn({ activeConversationId, setConversationProject, setShowProjectSelector }, project);
      }
    },
    handleGenerateImageFromMessage: (prompt: string) =>
      handleGenerateImageFromMsgFn(prompt, genDeps, { activeConversationId, activeImageModel, setAlertState }),
    handleImagePress: (uri: string) => setViewerImageUri(uri),
    handleSaveImage: () => saveImageToGallery(viewerImageUri, setAlertState),
  };
};
