import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { AlertState, initialAlertState } from '../../components';
import { useAppStore, useChatStore, useProjectStore, useRemoteServerStore, useTTSStore } from '../../stores';
import '../../types/tts';
import logger from '../../utils/logger';
import {
  llmService, generationService, imageGenerationService, activeModelService,
  ImageGenerationState, hardwareService, QueuedMessage,
  contextCompactionService,
} from '../../services';
import { Message, MediaAttachment, Project, DownloadedModel, DebugInfo, RemoteModel } from '../../types';
import { RootStackParamList } from '../../navigation/types';
import { ensureModelLoadedFn, handleModelSelectFn, handleUnloadModelFn, initiateModelLoad, useChatImageModelEffects, useChatModelStateSync } from './useChatModelActions';
import { startGenerationFn, handleSendFn, handleStopFn, handleSelectProjectFn } from './useChatGenerationActions';
import { handleRetryMessageFn, handleEditMessageFn, handleDeleteConversationFn, handleGenerateImageFromMsgFn } from './useChatMessageHandlers';
import { getDisplayMessages, getPlaceholderText, ChatMessageItem, StreamingState } from './types';
import { saveImageToGallery } from './useSaveImage';
import { stripControlTokens, stripMarkdownForSpeech } from '../../utils/messageContent';

export type { AlertState, ChatMessageItem, StreamingState };
export { getDisplayMessages, getPlaceholderText };

function _triggerAudioModeGeneration(conversationId: string, messageId: string, content: string) {
  useChatStore.getState().updateMessageAudio(conversationId, messageId, { isAudioModeMessage: true });
  useTTSStore.getState().speak(stripMarkdownForSpeech(stripControlTokens(content)), messageId);
}

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

  // Stop TTS when navigating away, app backgrounded, or screen locked
  useEffect(() => {
    const unsubBlur = navigation.addListener('blur', () => {
      useTTSStore.getState().stop();
    });
    // beforeRemove fires on back button — more reliable than blur for native-stack
    const unsubRemove = navigation.addListener('beforeRemove', () => {
      useTTSStore.getState().stop();
    });
    const appStateSub = AppState.addEventListener('change', (nextState) => {
      const tts = useTTSStore.getState();
      if (nextState !== 'active') {
        if (tts.isSpeaking && !tts.isPaused) { tts.pause(); }
      } else {
        if (tts.isSpeaking && tts.isPaused) { tts.resume(); }
      }
    });
    return () => { unsubBlur(); unsubRemove(); appStateSub.remove(); };
  }, [navigation]);
  const modelLoadStartTimeRef = useRef<number | null>(null);
  const startGenerationRef = useRef<(id: string, text: string) => Promise<void>>(null as any);
  const addMessageRef = useRef<typeof addMessage>(null as any);

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
  addMessageRef.current = addMessage;

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
  const hasActiveModel = activeModelInfo.modelId !== null;
  const activeModelName = activeModelInfo.modelName;

  const effectiveProjectId = activeConversation ? activeConversation.projectId : pendingProjectId;
  const activeProject = effectiveProjectId ? getProject(effectiveProjectId) : null;
  const activeImageModel = downloadedImageModels.find(m => m.id === activeImageModelId);
  const imageModelLoaded = !!activeImageModel;
  const isGeneratingImage = imageGenState.isGenerating;
  const isStreamingForThisConversation = streamingForConversationId === activeConversationId;

  const genDeps = {
    activeModelId: activeModelInfo.modelId, activeModel, activeModelInfo, hasActiveModel, activeConversationId, activeConversation, activeProject,
    activeImageModel, imageModelLoaded, isStreaming, isGeneratingImage, imageGenState, settings,
    downloadedModels, setAlertState, setIsClassifying, setAppImageGenerationStatus,
    setAppIsGeneratingImage, addMessage, clearStreamingMessage, deleteConversation,
    setActiveConversation, removeImagesByConversationId, generatingForConversationRef, navigation, setShowSettingsPanel,
    ensureModelLoaded: async () => ensureModelLoadedFn(modelDeps),
    createConversation,
    pendingProjectId,
  };

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

  const handleQueuedSend = useCallback(async (item: QueuedMessage) => {
    addMessageRef.current(item.conversationId, { role: 'user', content: item.text, attachments: item.attachments });
    await startGenerationRef.current(item.conversationId, item.messageText);
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

  const displayMessages = getDisplayMessages(activeConversation?.messages || [], { isThinking, streamingMessage, streamingReasoningContent, isStreamingForThisConversation });

  useEffect(() => {
    const prev = lastMessageCountRef.current, curr = displayMessages.length;
    if (curr > prev && prev > 0) setAnimateLastN(curr - prev);
    lastMessageCountRef.current = curr;
  }, [displayMessages.length]);
  useEffect(() => { lastMessageCountRef.current = 0; setAnimateLastN(0); }, [activeConversationId]);
  const prevStreamingRef = useRef(false);
  const ttsStreamRef = useRef<{ nextPos: number; pending: string[]; isPlaying: boolean }>({
    nextPos: 0, pending: [], isPlaying: false,
  });

  // Buffer-based streaming TTS: feed text to Kokoro as soon as enough runway accumulates.
  // No sentence detection — just split at word boundaries when buffer exceeds threshold.
  // Works even at low tok/sec because the threshold is much smaller than a full sentence.
  useEffect(() => {
    if (!isStreamingForThisConversation) return;
    const tts = useTTSStore.getState();
    if (tts.settings.interfaceMode !== 'audio') return;
    if (!tts.kokoroReady && !tts.isModelLoaded) return;
    if (!streamingMessage) return;

    const ref = ttsStreamRef.current;
    const stripped = stripControlTokens(streamingMessage);
    const buffered = stripped.slice(ref.nextPos);

    // Need enough chars for Kokoro to have meaningful speech (~2-3 seconds worth)
    const MIN_CHARS = 50;
    if (buffered.length < MIN_CHARS) return;

    // Split at the last word boundary so we don't cut mid-word
    const lastSpace = buffered.lastIndexOf(' ');
    if (lastSpace <= 0) return;

    const chunk = buffered.slice(0, lastSpace).trim();
    ref.nextPos += lastSpace + 1;
    if (!chunk) return;

    ref.pending.push(stripMarkdownForSpeech(chunk));
    logger.log('[StreamTTS] chunk queued, pending=', ref.pending.length, 'isPlaying=', ref.isPlaying);

    if (!ref.isPlaying) {
      const playNext = () => {
        // If another message took over playback (e.g. user tapped a recording), stop the chain
        const currentId = useTTSStore.getState().currentMessageId;
        if (currentId !== null && currentId !== 'streaming') {
          logger.log('[StreamTTS] chain interrupted, currentId=', currentId);
          ref.pending = [];
          ref.isPlaying = false;
          return;
        }
        const next = ref.pending.shift();
        if (!next) { ref.isPlaying = false; logger.log('[StreamTTS] chain done, no more pending'); return; }
        ref.isPlaying = true;
        logger.log('[StreamTTS] playing next chunk, remaining=', ref.pending.length);
        useTTSStore.getState().speak(next, 'streaming').finally(playNext);
      };
      playNext();
    }
  }, [streamingMessage, isStreamingForThisConversation]);

  useEffect(() => {
    const was = prevStreamingRef.current;
    prevStreamingRef.current = isStreamingForThisConversation;
    if (!was || isStreamingForThisConversation || !activeConversationId) return;
    const { nextPos: alreadySpoken } = ttsStreamRef.current;
    ttsStreamRef.current = { nextPos: 0, pending: [], isPlaying: false };
    const tts = useTTSStore.getState();
    if (tts.settings.interfaceMode !== 'audio') return;
    const conv = useChatStore.getState().conversations.find((c) => c.id === activeConversationId);
    const last = (conv?.messages ?? []).at(-1);
    if (!last || last.role !== 'assistant' || last.isSystemInfo || last.toolCalls?.length || last.audioPath) return;
    // Stamp as audio-mode. Estimate duration from word count (avg 2.5 words/sec)
    const wordCount = last.content.split(/\s+/).filter(Boolean).length;
    const speed = useTTSStore.getState().settings.speed || 1;
    const estDuration = Math.max(1, wordCount / (2.5 * speed));
    logger.log('[StreamTTS] post-stream: messageId=', last.id, 'alreadySpoken=', alreadySpoken, 'wordCount=', wordCount, 'estDuration=', estDuration);
    useChatStore.getState().updateMessageAudio(activeConversationId, last.id, {
      isAudioModeMessage: true,
      audioDurationSeconds: estDuration,
    });
    // Only speak if a TTS engine is available
    if (!tts.kokoroReady && !tts.isModelLoaded) { logger.log('[StreamTTS] post-stream: no TTS engine available'); return; }
    // Strip thinking/control tokens — must match how positions were tracked during streaming
    const cleanContent = stripMarkdownForSpeech(stripControlTokens(last.content));
    const remaining = cleanContent.slice(alreadySpoken).trim();
    logger.log('[StreamTTS] post-stream: remaining chars=', remaining.length, 'isSpeaking=', tts.isSpeaking, 'currentMessageId=', tts.currentMessageId);
    if (remaining) {
      useTTSStore.getState().speak(remaining, last.id);
    } else if (useTTSStore.getState().currentMessageId === 'streaming') {
      // All text was already spoken by streaming chunks — transfer ownership
      // to the real message ID so the AudioMessageBubble's seekbar works.
      logger.log('[StreamTTS] post-stream: transferring ownership from streaming to', last.id);
      useTTSStore.setState({ currentMessageId: last.id });
    }
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
    return (
      settings.nThreads !== loadedSettings.nThreads ||
      settings.nBatch !== loadedSettings.nBatch ||
      settings.contextLength !== loadedSettings.contextLength ||
      settings.enableGpu !== loadedSettings.enableGpu ||
      settings.gpuLayers !== loadedSettings.gpuLayers ||
      settings.flashAttn !== loadedSettings.flashAttn ||
      settings.cacheType !== loadedSettings.cacheType
    );
  })();

  const handleReloadTextModel = useCallback(async () => {
    if (!activeModelInfo.modelId || activeModelInfo.isRemote) return;
    // Must unload first — loadTextModel skips if the same model ID is already loaded,
    // which means setLoadedSettings would never run and the banner would persist.
    if (llmService.isModelLoaded()) {
      await activeModelService.unloadTextModel();
    }
    await initiateModelLoad(modelDeps, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeModelInfo.modelId, activeModelInfo.isRemote, settings]);

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
    activeModelInfo, hasActiveModel, activeRemoteModel, activeModelName,
    activeProject, activeImageModel, imageModelLoaded, isGeneratingImage,
    imageGenerationProgress: imageGenState.progress,
    imageGenerationStatus: imageGenState.status,
    imagePreviewPath: imageGenState.previewPath,
    isStreaming, isThinking, isCompacting, hasPendingSettings, handleReloadTextModel, displayMessages, downloadedModels, projects, settings,
    navigation, hardwareService,
    handleSend: (text: string, attachments?: MediaAttachment[], imageMode?: 'auto' | 'force' | 'disabled') =>
      handleSendFn(genDeps, { text, attachments, imageMode, startGeneration, setDebugInfo }),
    handleStop: () => handleStopFn(genDeps),
    handleModelSelect: (model: DownloadedModel) => handleModelSelectFn(modelDeps, model),
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
