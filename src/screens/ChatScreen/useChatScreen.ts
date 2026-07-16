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
import { effectiveCacheType } from '../../services/llmHelpers';
import { generationSession } from '../../services/generationSession';
import { useGeneratingConversationId } from '../../hooks/useGenerationSession';
import { Message, MediaAttachment, Project, DownloadedModel, DebugInfo, RemoteModel } from '../../types';
import { RootStackParamList } from '../../navigation/types';
import { ensureModelLoadedFn, ensureTextModelForChatFn, handleModelSelectFn, handleUnloadModelFn, initiateModelLoad, useChatImageModelEffects, useChatModelStateSync } from './useChatModelActions';
import { startGenerationFn, handleSendFn, handleStopFn, handleSelectProjectFn, dispatchGenerationFn } from './useChatGenerationActions';
import { handleRetryMessageFn, handleEditMessageFn, handleDeleteConversationFn, handleGenerateImageFromMsgFn } from './useChatMessageHandlers';
import { getDisplayMessages } from './types';
import { saveImageToGallery } from './useSaveImage';
import { needsVisionRepair } from '../../utils/visionRepair';
import {
  isSuspiciousRecoveredImageModel,
  isSuspiciousRecoveredTextModel,
} from '../../utils/modelSelectorFilters';

export type { AlertState };
export type { ChatMessageItem } from './types';
export { getPlaceholderText } from './types';

type ChatScreenRouteProp = RouteProp<RootStackParamList, 'Chat'>;

type ActiveModelInfo = {
  isRemote: boolean;
  model: DownloadedModel | RemoteModel | null;
  modelId: string | null;
  modelName: string;
};

/**
 * Whether live settings differ from what the loaded model was loaded with — drives the
 * "settings changed, tap to reload" banner. A field only counts as changed when the
 * snapshot actually CAPTURED it: comparing a live value against an `undefined` snapshot
 * field is a false positive, not a change. This happens across engines — the llama loader
 * snapshots only the llama fields (so liteRTBackend/liteRTMaxTokens are undefined), and
 * loadedSettings is persisted, so a relaunch or a llama→LiteRT switch would otherwise pop
 * the banner with nothing changed.
 */
export function computePendingSettings(
  engine: string | undefined,
  settings: Record<string, unknown>,
  loadedSettings: Record<string, unknown> | null | undefined,
): boolean {
  if (!loadedSettings) return false;
  // Pending only if BOTH sides are defined AND differ.
  const changed = (live: unknown, loaded: unknown) => loaded !== undefined && live !== loaded;
  if (engine === 'litert') {
    // Compare the EFFECTIVE token budget (unset = native default 4096) so an
    // undefined→explicit change still flags a reload (mirror of the false-positive fix).
    const liveTokens = (settings.liteRTMaxTokens as number | undefined) ?? 4096;
    const loadedTokens = (loadedSettings.liteRTMaxTokens as number | undefined) ?? 4096;
    return changed(settings.liteRTBackend, loadedSettings.liteRTBackend) ||
           (loadedSettings.liteRTBackend !== undefined && liveTokens !== loadedTokens);
  }
  // Compare the EFFECTIVE cache on BOTH sides (OpenCL + HTP coerce to f16). Comparing the
  // effective live value against the RAW stored value falsely flagged "settings changed"
  // right after every accelerated load (live f16 vs stored q8_0). Symmetric via the single
  // llmHelpers source — also robust to snapshots persisted before this fix.
  const effCache = effectiveCacheType(settings.inferenceBackend as string | undefined, settings.cacheType as string | undefined);
  const loadedEffCache = effectiveCacheType(loadedSettings.inferenceBackend as string | undefined, loadedSettings.cacheType as string | undefined);
  return (
    changed(settings.nThreads, loadedSettings.nThreads) ||
    changed(settings.nBatch, loadedSettings.nBatch) ||
    changed(settings.contextLength, loadedSettings.contextLength) ||
    changed(settings.enableGpu, loadedSettings.enableGpu) ||
    changed(settings.inferenceBackend, loadedSettings.inferenceBackend) ||
    changed(settings.gpuLayers, loadedSettings.gpuLayers) ||
    changed(settings.flashAttn, loadedSettings.flashAttn) ||
    (loadedSettings.cacheType !== undefined && effCache !== loadedEffCache)
  );
}

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
  const [supportsToolCalling, setSupportsToolCalling] = useState(false);
  const [supportsThinking, setSupportsThinking] = useState(false);
  const [isCompacting, setIsCompacting] = useState(false);
  const [pendingProjectId, setPendingProjectId] = useState<string | undefined>(route.params?.projectId);
  const lastMessageCountRef = useRef(0);
  // Owned by the generationSession service (single owner); observed reactively here.
  const generatingConversationId = useGeneratingConversationId();
  // Stashed when the model selector opens with no text model; replayed on pick.
  const pendingMessageRef = useRef<{ text: string; attachments?: MediaAttachment[] } | null>(null);

  // The text model is intentionally NOT loaded on chat open. It loads lazily on
  // send, when the generation path recognizes a local text model is needed
  // (ensureModelReady → ensureModelLoaded, which shows the "Loading model" bar).
  // Remote models never trigger a local load. Keeps both app launch and chat open
  // snappy — nothing heavy runs until the user actually sends a message.

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
    removeImagesByConversationId, loadedSettings, textModelEvicted,
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
    activeModelId: activeModelInfo.modelId, activeModel, activeModelInfo, hasActiveModel, hasTextModel, supportsToolCalling, activeConversationId, activeConversation, activeProject,
    activeImageModel, imageModelLoaded, isStreaming, isGeneratingImage, imageGenState, settings,
    downloadedModels, setAlertState, setIsClassifying, setAppImageGenerationStatus,
    setAppIsGeneratingImage, addMessage, clearStreamingMessage, deleteConversation,
    setActiveConversation, removeImagesByConversationId, navigation, setShowSettingsPanel,
    ensureModelLoaded: async (onLoadedResume?: () => void) => ensureModelLoadedFn(modelDeps, onLoadedResume),
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
    // Pass the queued send's forced modality (imageMode) so a message the user forced to image mode
    // is dispatched as image, not re-decided at 'auto' by resolveTurnKind (#510).
    await dispatchGenerationFn(genDepsRef.current,
      { text: item.text, attachments: item.attachments, conversationId: item.conversationId, imageMode: item.imageMode }, startGenerationRef.current);
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
    // Switched away from the conversation that was generating → end its session.
    if (generationSession.getConversationId() && !generationSession.isGeneratingFor(activeConversationId)) {
      generationSession.end('conversation-switch');
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      if (!cancelled && llmService.isModelLoaded()) { llmService.clearKVCache(false).catch(() => { }); }
    }, 0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [activeConversationId]);

  useChatImageModelEffects({ setDownloadedImageModels, settings, activeImageModelId, downloadedModels });
  useChatModelStateSync({ activeModelInfo, activeModelId, activeModel, modelDeps, activeRemoteModel, activeRemoteTextModelId, isModelLoading, setSupportsVision, setSupportsToolCalling, setSupportsThinking });

  const isGeneratingForThisConversation = generatingConversationId != null && generatingConversationId === activeConversationId;
  const displayMessages = getDisplayMessages(activeConversation?.messages || [], { isThinking, streamingMessage, streamingReasoningContent, isStreamingForThisConversation, isModelLoading, loadingModelName: loadingModel?.name, isGeneratingForThisConversation });

  useEffect(() => {
    const prev = lastMessageCountRef.current, curr = displayMessages.length;
    if (curr > prev && prev > 0) setAnimateLastN(curr - prev);
    lastMessageCountRef.current = curr;
  }, [displayMessages.length]);
  useEffect(() => { lastMessageCountRef.current = 0; setAnimateLastN(0); }, [activeConversationId]);
  const prevStreamingRef = useRef(false);

  // NOTE: stopping stale TTS on a new turn is done in handleSendFn (and retry/
  // voice/navigation), NOT here. A previous effect fired audio.stop whenever
  // `isStreamingForThisConversation` became true — but that flag bounces
  // false→true on every tool-call round within a single turn, so it re-fired
  // audio.stop mid-answer and aborted the current answer's streaming-TTS queue
  // (the "streams, then stops speaking once the answer is prepared" bug).

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
  // Whether settings changed since the model was loaded (drives the reload banner).
  const hasPendingSettings = computePendingSettings(activeModel?.engine, settings, loadedSettings);

  const handleReloadTextModel = useCallback(async () => {
    if (!activeModelInfo.modelId || activeModelInfo.isRemote) return;
    setShowModelSelector(true);
    // Unload with keepSelection=true so a failed reload never clears activeModelId
    // (the default unload cleared it, so an OOM stranded the chat: stuck banner +
    // wedged send). The unload still nulls loadedTextModelId, so loadTextModel
    // won't fast-path-skip. The memory gate — including the "Load Anyway" override
    // — is owned by initiateModelLoad, so reload matches normal load exactly (no
    // duplicated/stricter check in the view).
    // activeModelService.unloadTextModel now unloads whichever engine is active (LiteRT or llama)
    // and no-ops when nothing is loaded — so no engine branch here.
    await activeModelService.unloadTextModel(true);
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
    supportsToolCalling, supportsThinking,
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
    isStreaming, isThinking, isCompacting, isGeneratingForThisConversation, hasPendingSettings, handleReloadTextModel, textModelEvicted, displayMessages, downloadedModels, hasAvailableModels, projects, settings,
    // The chat knows the active model IS a vision model but is missing its projector — surface repair, not a crash.
    visionNeedsRepair: !activeModelInfo.isRemote && needsVisionRepair(activeModel),
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
      handleEditMessageFn(genDeps, { message, newContent, activeConversationId, hasActiveModel, activeConversation, updateMessageContent, deleteMessagesAfter, setDebugInfo }),
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
    handleSaveImage: () => {
      // Close the fullscreen viewer FIRST. The "Image Saved" confirmation is an AppSheet
      // (a modal); iOS cannot present it on top of the still-open viewer <Modal> — two
      // simultaneous modals wedge the UI and the chat input stops responding while nav
      // still works (device 2026-07-15). Dismiss the viewer, then save + alert on the next
      // tick once it has faded out. Harmless on Android (no nested-modal conflict there).
      const uri = viewerImageUri;
      setViewerImageUri(null);
      // Let the viewer <Modal> (animationType="fade", ~300ms) finish dismissing before the "Saved"
      // AppSheet presents, so the two modals never overlap on iOS. Named + given headroom over the
      // fade duration so the coupling is explicit (Gitar).
      const VIEWER_FADE_OUT_MS = 350;
      setTimeout(() => { saveImageToGallery(uri, setAlertState).catch(() => {}); }, VIEWER_FADE_OUT_MS);
    },
  };
};
