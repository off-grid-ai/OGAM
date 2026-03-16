import { Dispatch, MutableRefObject, SetStateAction } from 'react';
let _msgIdSeq = 0;
const nextMsgId = () => `${Date.now()}-${(++_msgIdSeq).toString(36)}`;
import {
  AlertState,
  showAlert,
  hideAlert,
} from '../../components';
import { APP_CONFIG } from '../../constants';
import {
  llmService,
  intentClassifier,
  generationService,
  imageGenerationService,
  onnxImageGeneratorService,
  ImageGenerationState,
  buildToolSystemPromptHint,
  contextCompactionService,
  ragService,
  retrievalService,
} from '../../services';
import { embeddingService } from '../../services/rag/embedding';
import { useChatStore, useProjectStore, useRemoteServerStore } from '../../stores';
import { Message, MediaAttachment, Project, DownloadedModel, RemoteModel, ModelLoadingStrategy, CacheType } from '../../types';
import logger from '../../utils/logger';
import { shouldUseToolsForMessage } from './toolUsage';
type SetState<T> = Dispatch<SetStateAction<T>>;
const FALLBACK_RECENT_MESSAGE_COUNT = 2;

export type GenerationDeps = {
  activeModelId: string | null;
  activeModel: DownloadedModel | null | undefined;
  activeModelInfo?: { isRemote: boolean; model: DownloadedModel | RemoteModel | null; modelId: string | null; modelName: string };
  hasActiveModel?: boolean;
  activeConversationId: string | null | undefined;
  activeConversation: any;
  activeProject: any;
  activeImageModel: any;
  imageModelLoaded: boolean;
  isStreaming: boolean;
  isGeneratingImage: boolean;
  imageGenState: ImageGenerationState;
  settings: {
    showGenerationDetails: boolean;
    imageGenerationMode: string;
    autoDetectMethod: string;
    classifierModelId?: string | null;
    modelLoadingStrategy: ModelLoadingStrategy;
    systemPrompt?: string;
    imageSteps?: number;
    imageGuidanceScale?: number;
    enabledTools?: string[];
    cacheType?: CacheType;
  };
  downloadedModels: DownloadedModel[];
  setAlertState: SetState<AlertState>;
  setIsClassifying: SetState<boolean>;
  setAppImageGenerationStatus: (v: string | null) => void;
  setAppIsGeneratingImage: (v: boolean) => void;
  addMessage: (convId: string, msg: any) => void;
  clearStreamingMessage: () => void;
  deleteConversation: (convId: string) => void;
  setActiveConversation: (convId: string | null) => void;
  removeImagesByConversationId: (convId: string) => string[];
  generatingForConversationRef: MutableRefObject<string | null>;
  navigation: any;
  setShowSettingsPanel?: SetState<boolean>;
  ensureModelLoaded: () => Promise<void>;
};
function applyCompactionPrefix(conversation: any, systemPrompt: string, messages: Message[]): { prefix: Message[]; filtered: Message[] } {
  const prefix: Message[] = [{ id: 'system', role: 'system', content: systemPrompt, timestamp: 0 }];
  let filtered = messages;
  if (conversation?.compactionSummary && conversation?.compactionCutoffMessageId) {
    prefix.push({ id: 'compaction-summary', role: 'assistant', content: `[Previous conversation summary]\n${conversation.compactionSummary}`, timestamp: 0 });
    const cutoffIdx = messages.findIndex(m => m.id === conversation.compactionCutoffMessageId);
    if (cutoffIdx !== -1) filtered = messages.slice(cutoffIdx + 1);
  }
  return { prefix, filtered };
}

function appendAttachmentText(text: string, attachments?: MediaAttachment[]): string {
  if (!attachments) return text;
  return attachments.filter(a => a.type === 'document' && a.textContent)
    .reduce((acc, doc) => `${acc}\n\n---\n📄 **Attached Document: ${doc.fileName || 'document'}**\n\`\`\`\n${doc.textContent}\n\`\`\`\n---`, text);
}

function buildMessagesForContext(conversationId: string, messageText: string, systemPrompt: string): Message[] {
  const conversation = useChatStore.getState().conversations.find(c => c.id === conversationId);
  const allMessages = (conversation?.messages || []).filter(m => !m.isSystemInfo);
  const { prefix, filtered } = applyCompactionPrefix(conversation, systemPrompt, allMessages);
  const lastMsg = filtered.at(-1);
  if (!lastMsg) return [...prefix];
  const userMessageForContext: Message = lastMsg.role === 'user' ? { ...lastMsg, content: messageText } : lastMsg;
  return [...prefix, ...filtered.slice(0, -1), userMessageForContext];
}
export async function shouldRouteToImageGenerationFn(
  deps: Pick<GenerationDeps, 'isGeneratingImage' | 'settings' | 'imageModelLoaded' | 'downloadedModels' | 'setIsClassifying' | 'setAppImageGenerationStatus' | 'setAppIsGeneratingImage'>,
  text: string,
  forceImageMode?: boolean,
): Promise<boolean> {
  if (deps.isGeneratingImage) return false;
  if (deps.settings.imageGenerationMode === 'manual') return forceImageMode === true;
  if (forceImageMode) return true;
  if (!deps.imageModelLoaded) return false;
  try {
    const useLLM = deps.settings.autoDetectMethod === 'llm';
    const classifierModel = deps.settings.classifierModelId
      ? deps.downloadedModels.find(m => m.id === deps.settings.classifierModelId)
      : null;
    if (useLLM) deps.setIsClassifying(true);
    const intent = await intentClassifier.classifyIntent(text, {
      useLLM,
      classifierModel,
      currentModelPath: llmService.getLoadedModelPath(),
      onStatusChange: useLLM ? deps.setAppImageGenerationStatus : undefined,
      modelLoadingStrategy: deps.settings.modelLoadingStrategy,
    });
    deps.setIsClassifying(false);
    if (intent !== 'image' && useLLM) {
      deps.setAppImageGenerationStatus(null);
      deps.setAppIsGeneratingImage(false);
    }
    return intent === 'image';
  } catch (error) {
    logger.warn('[ChatScreen] Intent classification failed:', error);
    deps.setIsClassifying(false);
    deps.setAppImageGenerationStatus(null);
    deps.setAppIsGeneratingImage(false);
    return false;
  }
}
export type ImageGenCall = {
  prompt: string;
  conversationId: string;
  skipUserMessage?: boolean;
};
export async function handleImageGenerationFn(
  deps: Pick<GenerationDeps, 'activeImageModel' | 'settings' | 'imageGenState' | 'setAlertState' | 'addMessage'>,
  call: ImageGenCall,
): Promise<void> {
  const { prompt, conversationId, skipUserMessage = false } = call;
  if (!deps.activeImageModel) {
    deps.setAlertState(showAlert('Error', 'No image model loaded.'));
    return;
  }
  if (!skipUserMessage) {
    deps.addMessage(conversationId, { role: 'user', content: prompt });
  }
  const result = await imageGenerationService.generateImage({
    prompt,
    conversationId,
    steps: deps.settings.imageSteps || 8,
    guidanceScale: deps.settings.imageGuidanceScale || 2,
    previewInterval: 2,
  });
  if (!result && deps.imageGenState.error && !deps.imageGenState.error.includes('cancelled')) {
    deps.setAlertState(showAlert('Error', `Image generation failed: ${deps.imageGenState.error}`));
  }
}
export type StartGenerationCall = { setDebugInfo: SetState<any>; targetConversationId: string; messageText: string };
async function ensureModelReady(deps: GenerationDeps): Promise<boolean> {
  // Remote models don't need local loading
  if (deps.activeModelInfo?.isRemote) return true;
  // Local models need to be loaded
  const loadedPath = llmService.getLoadedModelPath();
  if (loadedPath && loadedPath === deps.activeModel!.filePath) return true;
  await deps.ensureModelLoaded();
  return llmService.isModelLoaded() && llmService.getLoadedModelPath() === deps.activeModel!.filePath;
}
async function prepareContext(setDebugInfo: SetState<any>, systemPrompt: string, messages: Message[]): Promise<void> {
  try {
    const contextDebug = await llmService.getContextDebugInfo(messages);
    setDebugInfo({ systemPrompt, ...contextDebug });
    logger.log(`[ChatGen] Context prepared: ${contextDebug.contextUsagePercent}% used, ${contextDebug.truncatedCount} truncated`);
    if (contextDebug.truncatedCount > 0 || contextDebug.contextUsagePercent > 70) {
      await llmService.clearKVCache(false).catch(() => { });
    }
  } catch (e) { logger.log('Debug info error:', e); }
}
/** Run generation; if context is full, compact old messages and retry once. */
async function generateWithCompactionRetry(
  opts: { id: string; prompt: string; messages: Message[] },
  enabledTools: string[],
  projectId?: string,
): Promise<void> {
  const gen = (msgs: Message[]) => enabledTools.length > 0
    ? generationService.generateWithTools(opts.id, msgs, { enabledToolIds: enabledTools, projectId })
    : generationService.generateResponse(opts.id, msgs);
  try { await gen(opts.messages); } catch (error: any) {
    if (!contextCompactionService.isContextFullError(error)) throw error;
    logger.log('[ChatGen] Context full — compacting');
    await llmService.stopGeneration().catch(() => { });
    const conversation = useChatStore.getState().conversations.find(c => c.id === opts.id);
    const previousSummary = conversation?.compactionSummary;
    const compacted = await contextCompactionService.compact({ conversationId: opts.id, systemPrompt: opts.prompt, allMessages: opts.messages, previousSummary }).catch(async () => {
      logger.log(`[ChatGen] Compaction failed — falling back to last ${FALLBACK_RECENT_MESSAGE_COUNT} messages`);
      await llmService.clearKVCache(true).catch(() => { });
      const recent = opts.messages.filter(m => m.role !== 'system').slice(-FALLBACK_RECENT_MESSAGE_COUNT);
      return [{ id: 'system', role: 'system', content: opts.prompt, timestamp: 0 } as Message, ...recent];
    });
    await gen(compacted);
  }
}
async function injectRagContext(projectId: string | undefined, query: string, prompt: string): Promise<string> {
  if (!projectId) return prompt;
  try {
    const docs = await ragService.getDocumentsByProject(projectId);
    const enabledDocs = docs.filter((d: import('../../services/rag').RagDocument) => d.enabled);
    if (enabledDocs.length === 0) return prompt;
    // Warm up embedding model in background (non-blocking)
    if (!embeddingService.isLoaded()) {
      embeddingService.load().catch(err => logger.error('[RAG] Embedding warmup failed', err));
    }
    const docList = enabledDocs.map((d: import('../../services/rag').RagDocument) => `- ${d.name}`).join('\n');
    let kbPrompt = `\n\nYou have a knowledge base with these documents:\n${docList}`;
    kbPrompt += '\nUse the search_knowledge_base tool to look up specific information from these documents.';

    const r = await ragService.searchProject(projectId, query);
    if (r.chunks.length > 0) {
      kbPrompt += `\n\n${retrievalService.formatForPrompt(r)}`;
    }
    return prompt + kbPrompt;
  } catch (err) {
    logger.error('[RAG] Context injection failed', err);
  }
  return prompt;
}
function resolveToolsAndPrompt(deps: GenerationDeps, conversation: any): { enabledTools: string[]; rawPrompt: string } {
  const project = conversation?.projectId ? useProjectStore.getState().getProject(conversation.projectId) : null;
  const { activeServerId, activeRemoteTextModelId } = useRemoteServerStore.getState();
  const localToolCalling = llmService.supportsToolCalling();
  const isRemoteActive = !!(activeServerId && activeRemoteTextModelId);
  const canUseTools = localToolCalling || isRemoteActive;
  let enabledTools = canUseTools ? (deps.settings.enabledTools || []) : [];
  if (conversation?.projectId && canUseTools && !enabledTools.includes('search_knowledge_base')) {
    enabledTools = [...enabledTools, 'search_knowledge_base'];
  }
  const rawPrompt = project?.systemPrompt || deps.settings.systemPrompt || APP_CONFIG.defaultSystemPrompt;
  return { enabledTools, rawPrompt };
}

export async function startGenerationFn(deps: GenerationDeps, call: StartGenerationCall): Promise<void> {
  const { setDebugInfo, targetConversationId, messageText } = call;
  if (!deps.hasActiveModel) return;
  deps.generatingForConversationRef.current = targetConversationId;
  // For remote models, skip local model loading
  if (!deps.activeModelInfo?.isRemote && deps.activeModel) {
    if (!(await ensureModelReady(deps))) {
      deps.setAlertState(showAlert('Error', 'Failed to load model. Please try again.'));
      deps.generatingForConversationRef.current = null;
      return;
    }
  }
  const conversation = useChatStore.getState().conversations.find(c => c.id === targetConversationId);
  const { enabledTools, rawPrompt } = resolveToolsAndPrompt(deps, conversation);
  const basePrompt = await injectRagContext(conversation?.projectId, messageText, rawPrompt);
  // Remote models use native tool_choice: 'auto' — skip heuristic gate and always pass enabled tools
  const isRemote = !!useRemoteServerStore.getState().activeRemoteTextModelId;
  const heuristicMatch = shouldUseToolsForMessage(messageText, enabledTools);
  const activeTools = (isRemote || heuristicMatch) ? enabledTools : [];
  const systemPrompt = (!isRemote && activeTools.length > 0) ? `${basePrompt}${buildToolSystemPromptHint(activeTools)}` : basePrompt;
  logger.log(`[ChatGen][DEBUG] isRemote=${isRemote}, tools=[${activeTools.join(', ')}], path=${activeTools.length > 0 ? 'withTools' : 'generate'}`);
  const messagesForContext = buildMessagesForContext(targetConversationId, messageText, systemPrompt);
  await prepareContext(setDebugInfo, systemPrompt, messagesForContext);
  try {
    await generateWithCompactionRetry({ id: targetConversationId, prompt: systemPrompt, messages: messagesForContext }, activeTools, conversation?.projectId);
  } catch (error: any) {
    const msg = error?.message || error?.toString?.() || 'Failed to generate response';
    logger.error('[ChatGen] Generation failed:', msg, error);
    deps.setAlertState(showAlert('Generation Error', msg));
    deps.generatingForConversationRef.current = null;
    return;
  }
  deps.generatingForConversationRef.current = null;
}
export type SendCall = { text: string; attachments?: MediaAttachment[]; imageMode?: 'auto' | 'force' | 'disabled'; startGeneration: (convId: string, text: string) => Promise<void>; setDebugInfo: SetState<any> };
export async function handleSendFn(deps: GenerationDeps, call: SendCall): Promise<void> {
  const { text, attachments, imageMode, startGeneration } = call;
  if (!deps.activeConversationId || !deps.hasActiveModel) {
    deps.setAlertState(showAlert('No Model Selected', 'Please select a model first.'));
    return;
  }
  const targetConversationId = deps.activeConversationId;
  let messageText = appendAttachmentText(text, attachments);
  const shouldGenerateImage = imageMode !== 'disabled' && await shouldRouteToImageGenerationFn(deps, messageText, imageMode === 'force');
  if (shouldGenerateImage && deps.activeImageModel) {
    await handleImageGenerationFn(deps, { prompt: text, conversationId: targetConversationId });
    return;
  }
  if (shouldGenerateImage && !deps.activeImageModel) messageText = `[User wanted an image but no image model is loaded] ${messageText}`;
  if (generationService.getState().isGenerating) {
    generationService.enqueueMessage({ id: nextMsgId(), conversationId: targetConversationId, text, attachments, messageText });
    return;
  }
  deps.addMessage(targetConversationId, { role: 'user', content: text, attachments });
  await startGeneration(targetConversationId, messageText);
}
export async function handleStopFn(deps: Pick<GenerationDeps, 'isGeneratingImage' | 'generatingForConversationRef'>): Promise<void> {
  deps.generatingForConversationRef.current = null;
  try { await generationService.stopGeneration().catch(() => { }); }
  catch (e) { logger.error('Error stopping generation:', e); }
  if (deps.isGeneratingImage) imageGenerationService.cancelGeneration().catch(() => { });
}
export async function executeDeleteConversationFn(
  deps: Pick<GenerationDeps, 'activeConversationId' | 'isStreaming' | 'clearStreamingMessage' | 'removeImagesByConversationId' | 'deleteConversation' | 'setActiveConversation' | 'navigation' | 'setAlertState'>,
): Promise<void> {
  if (!deps.activeConversationId) return;
  deps.setAlertState(hideAlert());
  if (deps.isStreaming) { await llmService.stopGeneration(); deps.clearStreamingMessage(); }
  const imageIds = deps.removeImagesByConversationId(deps.activeConversationId);
  for (const id of imageIds) await onnxImageGeneratorService.deleteGeneratedImage(id);
  contextCompactionService.clearSummary(deps.activeConversationId);
  deps.deleteConversation(deps.activeConversationId);
  deps.setActiveConversation(null);
  deps.navigation.goBack();
}
export type RegenerateCall = { setDebugInfo: SetState<any>; userMessage: Message };
export async function regenerateResponseFn(deps: GenerationDeps, call: RegenerateCall): Promise<void> {
  const { userMessage } = call;
  if (!deps.activeConversationId || !deps.hasActiveModel) return;
  const targetConversationId = deps.activeConversationId;
  const messageText = appendAttachmentText(userMessage.content, userMessage.attachments);
  const shouldGenerateImage = await shouldRouteToImageGenerationFn(deps, messageText);
  if (shouldGenerateImage && deps.activeImageModel) {
    await handleImageGenerationFn(deps, { prompt: userMessage.content, conversationId: targetConversationId, skipUserMessage: true });
    return;
  }
  if (!deps.activeModelInfo?.isRemote && !llmService.isModelLoaded()) return;
  deps.generatingForConversationRef.current = targetConversationId;
  const conversation = useChatStore.getState().conversations.find(c => c.id === targetConversationId);
  const messages = (conversation?.messages || []).filter((m: Message) => !m.isSystemInfo);
  const messagesUpToUser = messages.slice(0, messages.findIndex((m: Message) => m.id === userMessage.id) + 1)
    .map(m => m.id === userMessage.id ? { ...m, content: messageText } : m);
  const { enabledTools, rawPrompt } = resolveToolsAndPrompt(deps, conversation);
  const isRemote = !!useRemoteServerStore.getState().activeRemoteTextModelId;
  const activeTools = (isRemote || shouldUseToolsForMessage(messageText, enabledTools)) ? enabledTools : [];
  const basePrompt = await injectRagContext(conversation?.projectId, messageText, rawPrompt);
  const systemPrompt = (!isRemote && activeTools.length > 0) ? `${basePrompt}${buildToolSystemPromptHint(activeTools)}` : basePrompt;
  const { prefix, filtered } = applyCompactionPrefix(conversation, systemPrompt, messagesUpToUser);
  try {
    await generateWithCompactionRetry({ id: targetConversationId, prompt: systemPrompt, messages: [...prefix, ...filtered] }, activeTools, conversation?.projectId);
  } catch (error: any) {
    deps.setAlertState(showAlert('Generation Error', error.message || 'Failed to generate response'));
  }
  deps.generatingForConversationRef.current = null;
}
export type SelectProjectDeps = { activeConversationId: string | null | undefined; setConversationProject: (convId: string, projectId: string | null) => void; setShowProjectSelector: SetState<boolean> };
export function handleSelectProjectFn(deps: SelectProjectDeps, project: Project | null): void {
  if (deps.activeConversationId) deps.setConversationProject(deps.activeConversationId, project?.id || null);
  deps.setShowProjectSelector(false);
}
