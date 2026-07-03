/* eslint-disable max-lines -- cohesive generation-action orchestrator (send/regenerate/dispatch/route share the same GenerationDeps + session state); splitting it would scatter tightly-coupled turn logic. */
import { Dispatch, SetStateAction } from 'react';
import { AlertState, showAlert, hideAlert } from '../../components';
import { generationSession } from '../../services/generationSession';
import { APP_CONFIG } from '../../constants';
import {
  llmService, intentClassifier, generationService, imageGenerationService,
  onnxImageGeneratorService, ImageGenerationState, buildToolSystemPromptHint,
  contextCompactionService, ragService, retrievalService,
} from '../../services';
import { getToolExtensions } from '../../services/tools/extensions';
import { liteRTService } from '../../services/litert';
import { ensureDefaultClassifier } from '../../services/classifierProvisioning';
import { abortPreload } from '../../services/modelPreloader';
import { modelResidencyManager } from '../../services/modelResidency';
import { embeddingService } from '../../services/rag/embedding';
import { useChatStore, useProjectStore, useRemoteServerStore } from '../../stores';
import { callHook, HOOKS } from '../../bootstrap/hookRegistry';
import { Message, MediaAttachment, Project, DownloadedModel, RemoteModel, CacheType } from '../../types';
import logger from '../../utils/logger';
import { ModelReadyOutcome, ensureReadyOrAlert } from './modelReadiness';
type SetState<T> = Dispatch<SetStateAction<T>>;
const FALLBACK_RECENT_MESSAGE_COUNT = 2;

export type GenerationDeps = {
  activeModelId: string | null;
  activeModel: DownloadedModel | null | undefined;
  activeModelInfo?: { isRemote: boolean; model: DownloadedModel | RemoteModel | null; modelId: string | null; modelName: string };
  hasActiveModel?: boolean;
  hasTextModel?: boolean;
  /** Same tool gate the UI shows; when false the Tools badge reads "N/A" and the picker is locked, so generation must not inject tools either. */
  supportsToolCalling?: boolean;
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
    systemPrompt?: string;
    imageSteps?: number;
    imageGuidanceScale?: number;
    enabledTools?: string[];
    cacheType?: CacheType;
    thinkingEnabled?: boolean;
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
  navigation: any;
  setShowSettingsPanel?: SetState<boolean>;
  ensureModelLoaded: () => Promise<ModelReadyOutcome>;
  /** Loads the last-selected text model for a chat request that has none; opens
   *  the model selector and returns false when no text model was ever chosen. */
  ensureTextModelForChat: () => Promise<boolean>;
  /** Stash a message to replay after the user picks a text model. */
  setPendingMessage?: (text: string, attachments?: MediaAttachment[]) => void;
  createConversation: (modelId: string, title?: string, projectId?: string) => string;
  pendingProjectId?: string;
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
  const userMessageForContext = (lastMsg?.role === 'user' ? { ...lastMsg, content: messageText } : lastMsg) as Message;
  return [...prefix, ...filtered.slice(0, -1), userMessageForContext];
}
export async function shouldRouteToImageGenerationFn(
  deps: Pick<GenerationDeps, 'isGeneratingImage' | 'settings' | 'activeImageModel' | 'downloadedModels' | 'setIsClassifying' | 'setAppImageGenerationStatus' | 'setAppIsGeneratingImage' | 'hasTextModel'>,
  text: string,
  forceImageMode?: boolean,
): Promise<boolean> {
  // [ROUTE-SM] permanent trace: every branch of the image-vs-text decision is logged
  // so "why didn't 'draw a dog' make an image?" is answerable from the logs (esp. the
  // voice path), never a guess.
  logger.log(`[ROUTE-SM] route? text="${text.slice(0, 60)}" force=${forceImageMode ?? false} mode=${deps.settings.imageGenerationMode} hasImageModel=${!!deps.activeImageModel} hasTextModel=${deps.hasTextModel} autoDetect=${deps.settings.autoDetectMethod}`);
  if (deps.isGeneratingImage) { logger.log('[ROUTE-SM] → false: already generating an image'); return false; }
  if (deps.settings.imageGenerationMode === 'manual') { logger.log(`[ROUTE-SM] → ${forceImageMode === true}: manual mode (only on force)`); return forceImageMode === true; }
  if (forceImageMode) { logger.log('[ROUTE-SM] → true: forced'); return true; }
  // Auto mode with no image model selected: there is nothing to route an image to
  // (dispatch requires activeImageModel), so skip the classifier entirely. Running it
  // here only adds latency on the send hot path and leaves a stale "Analyzing…" status.
  if (!deps.activeImageModel) { logger.log('[ROUTE-SM] → false: no image model selected'); return false; }
  // Route on whether an image model is SELECTED (downloaded), not whether it's
  // currently resident — the pipeline loads it on demand. (Checked + logged above.)
  // No text model (image-only): SMOL classifier decides text vs image, else heuristics; chat returns false.
  if (deps.hasTextModel === false) {
    const classifierModel = deps.settings.classifierModelId
      ? deps.downloadedModels.find(m => m.id === deps.settings.classifierModelId)
      : null;
    if (!classifierModel) {
      // No classifier yet: provision SmolLM2 in the background for next time,
      // and use fast heuristics for this turn.
      ensureDefaultClassifier().catch(() => {});
      const intent = await intentClassifier.classifyIntent(text, { useLLM: false });
      logger.log(`[ROUTE-SM] → ${intent === 'image'}: no-text-model heuristic intent=${intent}`);
      return intent === 'image';
    }
    deps.setIsClassifying(true);
    try {
      const intent = await intentClassifier.classifyIntent(text, {
        useLLM: true,
        classifierModel,
        currentModelPath: llmService.getLoadedModelPath(),
      });
      logger.log(`[ROUTE-SM] → ${intent === 'image'}: no-text-model SMOL classifier intent=${intent}`);
      return intent === 'image';
    } finally {
      deps.setIsClassifying(false);
    }
  }
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
    });
    deps.setIsClassifying(false);
    logger.log(`[ROUTE-SM] → ${intent === 'image'}: classifier intent=${intent} (useLLM=${useLLM})`);
    if (intent !== 'image' && useLLM) {
      deps.setAppImageGenerationStatus(null);
      deps.setAppIsGeneratingImage(false);
    }
    return intent === 'image';
  } catch {
    deps.setIsClassifying(false);
    deps.setAppImageGenerationStatus(null);
    deps.setAppIsGeneratingImage(false);
    logger.log('[ROUTE-SM] → false: classifier threw');
    return false;
  }
}
export type ImageGenCall = {
  prompt: string;
  conversationId: string;
  skipUserMessage?: boolean;
  attachments?: MediaAttachment[]; // kept on the user message (e.g. a voice note)
};
export async function handleImageGenerationFn(
  deps: Pick<GenerationDeps, 'activeImageModel' | 'settings' | 'imageGenState' | 'setAlertState' | 'addMessage'>,
  call: ImageGenCall,
): Promise<void> {
  const { prompt, conversationId, skipUserMessage = false, attachments } = call;
  if (!deps.activeImageModel) { deps.setAlertState(showAlert('Error', 'No image model loaded.')); return; }
  // Keep attachments (e.g. a voice note) so the user message renders as a voice note.
  if (!skipUserMessage) { deps.addMessage(conversationId, { role: 'user', content: prompt, attachments }); }
  const result = await imageGenerationService.generateImage({
    prompt, conversationId,
    steps: deps.settings.imageSteps || 8,
    guidanceScale: deps.settings.imageGuidanceScale || 2,
    previewInterval: 2,
  });
  if (!result && deps.imageGenState.error && !deps.imageGenState.error.includes('cancelled')) {
    deps.setAlertState(showAlert('Error', `Image generation failed: ${deps.imageGenState.error}`));
  }
  // Image gen finishes outside generationService — release any queued messages.
  generationService.drainQueue();
}
export type StartGenerationCall = { setDebugInfo: SetState<any>; targetConversationId: string; messageText: string };
async function prepareContext(setDebugInfo: SetState<any>, systemPrompt: string, messages: Message[]): Promise<void> {
  try {
    const contextDebug = await llmService.getContextDebugInfo(messages);
    setDebugInfo({ systemPrompt, ...contextDebug });
    if (contextDebug.truncatedCount > 0 || contextDebug.contextUsagePercent > 70) {
      await llmService.clearKVCache(false).catch(() => { });
    }
  } catch { /* ignore */ }
}
/** Run generation; if context is full, compact old messages and retry once. */
async function generateWithCompactionRetry(
  opts: { id: string; prompt: string; messages: Message[] },
  enabledTools: string[],
  projectId?: string,
): Promise<void> {
  const extCount = getToolExtensions().reduce((n, e) => n + e.enabledToolCount(), 0);
  const gen = (msgs: Message[]) => (enabledTools.length > 0 || extCount > 0)
    ? generationService.generateWithTools(opts.id, msgs, { enabledToolIds: enabledTools, projectId })
    : generationService.generateResponse(opts.id, msgs);
  try { await gen(opts.messages); } catch (error: any) {
    if (!contextCompactionService.isContextFullError(error)) throw error;
    await llmService.stopGeneration().catch(() => { });
    const conversation = useChatStore.getState().conversations.find(c => c.id === opts.id);
    const previousSummary = conversation?.compactionSummary;
    const compacted = await contextCompactionService.compact({ conversationId: opts.id, systemPrompt: opts.prompt, allMessages: opts.messages, previousSummary }).catch(async () => {
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
/** Gemma 4 E2B/E4B need <|think|> prepended to activate thinking mode — both llama.cpp and LiteRT. */
const applyGemma4ThinkToken = (prompt: string, isRemote: boolean, opts?: { isLiteRT?: boolean; thinkingEnabled?: boolean }): string => {
  const { isLiteRT = false, thinkingEnabled = false } = opts ?? {};
  const liteRTWantsThink = !isRemote && isLiteRT && thinkingEnabled;
  const llamaWantsThink = !isRemote && llmService.isGemma4Model() && llmService.isThinkingEnabled();
  return (liteRTWantsThink || llamaWantsThink) ? `<|think|>\n${prompt}` : prompt;
};
function resolveToolsAndPrompt(deps: GenerationDeps, conversation: any, _messageText: string): { enabledTools: string[]; rawPrompt: string; isLiteRT: boolean } {
  const project = conversation?.projectId ? useProjectStore.getState().getProject(conversation.projectId) : null;
  const { activeServerId, activeRemoteTextModelId } = useRemoteServerStore.getState();
  const isLiteRT = deps.activeModel?.engine === 'litert' && liteRTService.isModelLoaded();
  // Honour the UI gate: "N/A" (supportsToolCalling === false) means the picker is unreachable, so don't inject tools the user can't disable.
  const canUseTools = deps.supportsToolCalling !== false && (llmService.supportsToolCalling() || !!(activeServerId && activeRemoteTextModelId) || isLiteRT);

  let enabledTools = canUseTools ? (deps.settings.enabledTools || []) : [];

  // Auto-add search_knowledge_base for project chats even if not in user's enabled list
  if (conversation?.projectId && !enabledTools.includes('search_knowledge_base')) {
    enabledTools = [...enabledTools, 'search_knowledge_base'];
  }

  const rawPrompt = project?.systemPrompt || deps.settings.systemPrompt || APP_CONFIG.defaultSystemPrompt;
  return { enabledTools, rawPrompt, isLiteRT };
}
export async function startGenerationFn(deps: GenerationDeps, call: StartGenerationCall): Promise<void> {
  const { setDebugInfo, targetConversationId, messageText } = call;
  if (!deps.hasActiveModel) return;
  // Pure text executor — image-vs-text routing happens upstream in dispatchGenerationFn.
  generationSession.begin(targetConversationId);
  // For remote models, skip local model loading
  if (!deps.activeModelInfo?.isRemote && deps.activeModel &&
      !(await ensureReadyOrAlert(deps, 'startGeneration', () => { startGenerationFn(deps, call); }))) {
    generationSession.end('not-ready');
    return;
  }
  const conversation = useChatStore.getState().conversations.find(c => c.id === targetConversationId);
  const { enabledTools, rawPrompt, isLiteRT } = resolveToolsAndPrompt(deps, conversation, messageText);
  let basePrompt = await injectRagContext(conversation?.projectId, messageText, rawPrompt);

  // In voice/audio mode the pro audio feature augments the prompt for spoken
  // output. No-op (returns undefined) in free builds.
  basePrompt = callHook<string>(HOOKS.audioAugmentPrompt, basePrompt) ?? basePrompt;

  const isRemote = !!useRemoteServerStore.getState().activeRemoteTextModelId;
  const activeTools = enabledTools;
  // LiteRT passes tools natively via ConversationConfig — text hint would double-inject.
  // llama.cpp uses text hint only when it lacks native Jinja tool calling support.
  const useTextHint = !isRemote && !isLiteRT && activeTools.length > 0 && !llmService.supportsToolCalling();

  // MCP/extension hints are injected once, centrally, by augmentSystemPromptForTools
  // in the tool loop (covers every engine + tool path). Do NOT add them here too, or
  // the hint lands in the system prompt twice. Only the built-in-tools text hint is
  // added here, and only when the model lacks native Jinja tool calling.
  const systemPrompt = applyGemma4ThinkToken(
    useTextHint
      ? `${basePrompt}${buildToolSystemPromptHint(activeTools)}`
      : basePrompt,
    isRemote,
    { isLiteRT, thinkingEnabled: deps.settings.thinkingEnabled },
  );
  const messagesForContext = buildMessagesForContext(targetConversationId, messageText, systemPrompt);
  await prepareContext(setDebugInfo, systemPrompt, messagesForContext);
  try {
    await generateWithCompactionRetry({ id: targetConversationId, prompt: systemPrompt, messages: messagesForContext }, activeTools, conversation?.projectId);
  } catch (error: any) {
    const msg = error?.message || error?.toString?.() || 'Failed to generate response';
    logger.error('[ChatGen] Generation failed:', msg, error);
    const isContextOverflow = msg.includes('too long') || msg.includes('Exceeding the maximum number of tokens') || msg.includes('Input token ids');
    if (isContextOverflow) {
      deps.setAlertState({
        ...showAlert(
          'Context window full',
          'The conversation is too long for this model\'s context window.\n\nIncrease the context limit in Settings, reduce the number of enabled tools, or start a new chat.',
          [
            {
              text: 'Settings',
              onPress: () => { deps.setAlertState({ visible: false, title: '', message: '', buttons: [] }); deps.setShowSettingsPanel?.(true); },
            },
            {
              text: 'New chat',
              onPress: () => {
                deps.setAlertState({ visible: false, title: '', message: '', buttons: [] });
                const modelId = deps.activeModelInfo?.modelId;
                if (modelId) {
                  const newId = deps.createConversation(modelId);
                  deps.setActiveConversation(newId);
                }
              },
            },
          ],
        ),
        prominentMessage: true,
      });
    } else {
      deps.setAlertState(showAlert('Generation Error', msg));
    }
    generationSession.end('error');
    return;
  }
  generationSession.end();
}
let _msgIdSeq = 0; const nextMsgId = () => `${Date.now()}-${(++_msgIdSeq).toString(36)}`;
export type DispatchCall = { text: string; attachments?: MediaAttachment[]; conversationId: string; imageMode?: 'auto' | 'force' | 'disabled' };
/**
 * THE routing layer: the single place a message is classified and dispatched to
 * image or text generation. Every entry point (new send, queued-message drain)
 * funnels through here, so the decision is made once and never duplicated in an
 * executor. `startTextGeneration` is the pure text executor (it does not route).
 */
export async function dispatchGenerationFn(
  deps: GenerationDeps,
  call: DispatchCall,
  startTextGeneration: (convId: string, messageText: string) => Promise<void>,
): Promise<void> {
  const { text, attachments, conversationId, imageMode = 'auto' } = call;
  let messageText = appendAttachmentText(text, attachments);
  // [ROUTE-SM]: confirms the turn reached the router (esp. the voice path) + the
  // final routed destination — so a "pipeline never triggered" is visible in logs.
  logger.log(`[ROUTE-SM] dispatch text="${text.slice(0, 60)}" imageMode=${imageMode} hasImageModel=${!!deps.activeImageModel}`);
  const shouldGenerateImage = imageMode !== 'disabled' && await shouldRouteToImageGenerationFn(deps, messageText, imageMode === 'force');
  if (shouldGenerateImage && deps.activeImageModel) {
    logger.log('[ROUTE-SM] dispatch → IMAGE pipeline');
    await handleImageGenerationFn(deps, { prompt: text, conversationId, attachments }); // adds user msg (keeps voice note)
    return;
  }
  logger.log(`[ROUTE-SM] dispatch → TEXT generation (shouldGenerateImage=${shouldGenerateImage})`);
  // Text route, no text model selected (image-only device): load one / open selector.
  if (!shouldGenerateImage && deps.hasTextModel === false && !deps.activeModelInfo?.isRemote) {
    const ready = await deps.ensureTextModelForChat();
    if (!ready) {
      deps.setPendingMessage?.(text, attachments);
      return;
    }
  }
  if (shouldGenerateImage && !deps.activeImageModel) messageText = `[User wanted an image but no image model is loaded] ${messageText}`;
  deps.addMessage(conversationId, { role: 'user', content: text, attachments });
  await startTextGeneration(conversationId, messageText);
}
export type SendCall = { text: string; attachments?: MediaAttachment[]; imageMode?: 'auto' | 'force' | 'disabled'; startGeneration: (convId: string, text: string) => Promise<void>; setDebugInfo: SetState<any> };
export async function handleSendFn(deps: GenerationDeps, call: SendCall): Promise<void> {
  const { text, attachments, imageMode, startGeneration } = call;
  abortPreload(); // user acted — stop background warming so it can't block them
  if (!deps.hasActiveModel) { deps.setAlertState(showAlert('No Model Selected', 'Please select a model first.')); return; }
  callHook(HOOKS.audioStop); // stop stale TTS on the new turn (not a streaming-flag effect — see useChatScreen)
  await modelResidencyManager.reclaimSttForGeneration(); // free idle Whisper before LLM+TTS so they don't OOM on tight devices
  let targetConversationId = deps.activeConversationId;
  if (!targetConversationId) {
    const fallbackModelId = deps.activeModelInfo?.modelId || deps.activeImageModel?.id;
    targetConversationId = deps.createConversation(fallbackModelId!, undefined, deps.pendingProjectId);
    deps.setActiveConversation(targetConversationId);
  }
  // Cross-modality serialization: queue if any generation is running (routed later).
  if (generationService.getState().isGenerating || imageGenerationService.getState().isGenerating) {
    const messageText = appendAttachmentText(text, attachments);
    generationService.enqueueMessage({ id: nextMsgId(), conversationId: targetConversationId, text, attachments, messageText });
    return;
  }
  await dispatchGenerationFn(deps, { text, attachments, conversationId: targetConversationId, imageMode }, startGeneration);
}
export async function handleStopFn(deps: Pick<GenerationDeps, 'isGeneratingImage'>): Promise<void> {
  generationSession.end('stopped');
  callHook(HOOKS.audioStop); // abort must silence TTS too — buffered-ahead sentences keep playing otherwise
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
  for (const id of deps.removeImagesByConversationId(deps.activeConversationId)) await onnxImageGeneratorService.deleteGeneratedImage(id);
  contextCompactionService.clearSummary(deps.activeConversationId);
  deps.deleteConversation(deps.activeConversationId);
  deps.setActiveConversation(null);
  deps.navigation.goBack();
}
export type RegenerateCall = { setDebugInfo: SetState<any>; userMessage: Message };
export async function regenerateResponseFn(deps: GenerationDeps, call: RegenerateCall): Promise<void> {
  const { userMessage } = call;
  logger.log(`[RESEND-SM] regenerate start userMsg=${userMessage.id} conv=${deps.activeConversationId} hasActiveModel=${deps.hasActiveModel} isRemote=${deps.activeModelInfo?.isRemote} hasActiveModelObj=${!!deps.activeModel}`);
  if (!deps.activeConversationId || !deps.hasActiveModel) { logger.log('[RESEND-SM] regenerate BAIL: no conv or no active model'); return; }
  await modelResidencyManager.reclaimSttForGeneration(); // free idle Whisper before the LLM reload (memory-tight)
  const targetConversationId = deps.activeConversationId;
  const messageText = appendAttachmentText(userMessage.content, userMessage.attachments);
  const shouldGenerateImage = await shouldRouteToImageGenerationFn(deps, messageText);
  if (shouldGenerateImage && deps.activeImageModel) {
    await handleImageGenerationFn(deps, { prompt: userMessage.content, conversationId: targetConversationId, skipUserMessage: true });
    return;
  }
  if (!deps.activeModelInfo?.isRemote && deps.activeModel &&
      !(await ensureReadyOrAlert(deps, 'regenerate', () => { regenerateResponseFn(deps, call); }))) return;
  logger.log('[RESEND-SM] regenerate → reached LLM generate path');
  generationSession.begin(targetConversationId);
  // LiteRT: native history must be rewound to match the JS messages we're about to replay.
  if (deps.activeModel?.engine === 'litert') liteRTService.invalidateConversation();
  const conversation = useChatStore.getState().conversations.find(c => c.id === targetConversationId);
  const messages = (conversation?.messages || []).filter((m: Message) => !m.isSystemInfo);
  const messagesUpToUser = messages.slice(0, messages.findIndex((m: Message) => m.id === userMessage.id) + 1)
    .map(m => m.id === userMessage.id ? { ...m, content: messageText } : m);
  const { enabledTools, rawPrompt, isLiteRT: isLiteRTRegen } = resolveToolsAndPrompt(deps, conversation, messageText);
  const isRemote = !!useRemoteServerStore.getState().activeRemoteTextModelId;
  const activeTools = enabledTools;
  const basePrompt = await injectRagContext(conversation?.projectId, messageText, rawPrompt);
  const useTextHint = !isRemote && !isLiteRTRegen && activeTools.length > 0 && !llmService.supportsToolCalling();
  // MCP/extension hints come solely from augmentSystemPromptForTools in the tool loop
  // (see the send path above) — adding them here too would double-inject.
  const systemPrompt = applyGemma4ThinkToken(
    useTextHint
      ? `${basePrompt}${buildToolSystemPromptHint(activeTools)}`
      : basePrompt,
    isRemote,
    { isLiteRT: isLiteRTRegen, thinkingEnabled: deps.settings.thinkingEnabled },
  );
  const { prefix, filtered } = applyCompactionPrefix(conversation, systemPrompt, messagesUpToUser);
  try {
    await generateWithCompactionRetry({ id: targetConversationId, prompt: systemPrompt, messages: [...prefix, ...filtered] }, activeTools, conversation?.projectId);
  } catch (error: any) {
    const msg = error?.message || 'Failed to generate response';
    const isContextOverflow = msg.includes('too long') || msg.includes('Exceeding the maximum number of tokens') || msg.includes('Input token ids');
    if (isContextOverflow) {
      deps.setAlertState({
        ...showAlert(
          'Context window full',
          'The conversation is too long for this model\'s context window.\n\nIncrease the context limit in Settings, reduce the number of enabled tools, or start a new chat.',
          [
            {
              text: 'Settings',
              onPress: () => { deps.setAlertState({ visible: false, title: '', message: '', buttons: [] }); deps.setShowSettingsPanel?.(true); },
            },
            {
              text: 'New chat',
              onPress: () => {
                deps.setAlertState({ visible: false, title: '', message: '', buttons: [] });
                const modelId = deps.activeModelInfo?.modelId;
                if (modelId) {
                  const newId = deps.createConversation(modelId);
                  deps.setActiveConversation(newId);
                }
              },
            },
          ],
        ),
        prominentMessage: true,
      });
    } else {
      deps.setAlertState(showAlert('Generation Error', msg));
    }
  }
  generationSession.end();
}
export type SelectProjectDeps = { activeConversationId: string | null | undefined; setConversationProject: (convId: string, projectId: string | null) => void; setShowProjectSelector: SetState<boolean> };
export function handleSelectProjectFn(deps: SelectProjectDeps, project: Project | null): void {
  if (deps.activeConversationId) deps.setConversationProject(deps.activeConversationId, project?.id || null);
  deps.setShowProjectSelector(false); }
