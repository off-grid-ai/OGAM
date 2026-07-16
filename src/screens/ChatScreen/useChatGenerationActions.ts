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
import { invalidateActiveConversation, activeLocalTextCapabilities, wantsLeadingThinkToken, localModelAcceptsImages } from '../../services/engines';
import { needsVisionRepair } from '../../utils/visionRepair';
import { ensureDefaultClassifier } from '../../services/classifierProvisioning';
import { abortPreload } from '../../services/modelPreloader';
import { modelResidencyManager } from '../../services/modelResidency';
import { reportModelFailure } from '../../services/modelFailureHandler';
import { embeddingService } from '../../services/rag/embedding';
import { useChatStore, useProjectStore, useRemoteServerStore, useAppStore } from '../../stores';
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
/**
 * The SINGLE vision gate for any turn that carries an image — used by BOTH the send and the resend paths so
 * they behave identically. Returns true (and shows a repair-aware alert) when the image can't go to the
 * active model because it can't do vision, so neither path reaches the native completion with an image and
 * crashes with "Multimodal support not enabled" (device 2026-07-14).
 */
function blockedImageForNonVisionModel(deps: GenerationDeps, attachments?: MediaAttachment[]): boolean {
  if (!attachments?.some(a => a.type === 'image')) return false;
  if (deps.activeModelInfo?.isRemote || localModelAcceptsImages(deps.activeModel)) return false;
  const repair = needsVisionRepair(deps.activeModel);
  deps.setAlertState(showAlert(
    repair ? 'Vision File Missing' : 'Vision Not Supported',
    repair
      ? 'This model supports vision, but its vision file has not been installed.\n\nOpen Download Manager and tap the wrench next to the model to download it.'
      : 'This model does not support image input.\n\nSwitch to a vision-capable model to send images.',
  ));
  return true;
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
/** The modality of a turn. Resolved ONCE from user intent when the turn is created, recorded on
 *  the turn's record, and READ on resend/edit so the same pipeline runs again (deterministic) —
 *  never re-classified from current settings. STT/TTS join this union as the pipeline grows. */
export type TurnKind = 'text' | 'image';

/** Did this assistant reply produce an image? An image turn's final assistant message carries an
 *  image attachment (imageGenerationService), so that message IS the owning record of the turn's
 *  modality. Read it instead of re-deriving from the prompt + current settings. */
export function messageHasImageOutput(message: Message | undefined | null): boolean {
  return !!message?.attachments?.some(a => a.type === 'image');
}

/** The recorded kind of the turn whose USER message is userMessageId — scanned across EVERY
 *  assistant reply in that turn (until the next user message), not just the first. An image turn
 *  emits an "Enhanced prompt" assistant message BEFORE the image-result message, so checking only
 *  the first reply misclassified it as text → resend loaded a text model instead of re-drawing
 *  (device-confirmed). If ANY reply in the turn produced an image, the turn is an image turn.
 *  undefined when the turn has no reply yet / the message is unknown → caller falls back to classify. */
export function recordedTurnKind(messages: Message[], userMessageId: string): TurnKind | undefined {
  const idx = messages.findIndex(m => m.id === userMessageId);
  if (idx === -1) return undefined;
  let sawReply = false;
  for (let i = idx + 1; i < messages.length; i++) {
    const m = messages[i];
    if (m.role === 'user') break; // next turn begins — stop scanning
    if (m.role !== 'assistant') continue;
    sawReply = true;
    if (messageHasImageOutput(m)) return 'image';
  }
  return sawReply ? 'text' : undefined;
}

/** THE single modality decision for a turn — the seam send AND resend both go through, so the two
 *  can never disagree (the resend-misroute bug was two decision sites with different inputs). A REPLAY
 *  passes the turn's recorded kind and it wins verbatim (deterministic, no classify); a NEW turn has
 *  none, so the route rule (force / manual / classifier) decides. Adding a modality (stt/tts) extends
 *  this one function, not each call site (OCP). */
export async function resolveTurnKind(
  deps: Parameters<typeof shouldRouteToImageGenerationFn>[0],
  input: { text: string; recordedKind?: TurnKind; forceImageMode?: boolean; imageEnabled?: boolean },
): Promise<TurnKind> {
  if (input.recordedKind) return input.recordedKind; // replay: the recorded fact wins
  if (input.imageEnabled === false) return 'text'; // image route explicitly disabled for this turn
  return (await shouldRouteToImageGenerationFn(deps, input.text, input.forceImageMode)) ? 'image' : 'text';
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
  // Do NOT thread steps/guidanceScale from deps.settings — that is a React render snapshot, one
  // change stale (the off-by-one the user hit: change steps → next gen still used the old value).
  // The service reads imageSteps/imageGuidanceScale FRESH from useAppStore.getState() at gen time,
  // exactly as it already does for width/height (which is why size applied immediately and these
  // didn't). Passing nothing here makes all four tunables read from the one fresh source.
  const result = await imageGenerationService.generateImage({
    prompt, conversationId,
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
): Promise<boolean> {
  const extCount = getToolExtensions().reduce((n, e) => n + e.enabledToolCount(), 0);
  logger.log(`[GEN-SM] generateWithCompactionRetry conv=${opts.id} msgs=${opts.messages.length} tools=${enabledTools.length} ext=${extCount}`);
  const gen = (msgs: Message[]) => (enabledTools.length > 0 || extCount > 0)
    ? generationService.generateWithTools(opts.id, msgs, { enabledToolIds: enabledTools, projectId })
    : generationService.generateResponse(opts.id, msgs);
  let turnInterrupted = false; // PER-TURN stop truth from the loop outcome (returned to the caller)
  try { const outcome = await gen(opts.messages); turnInterrupted = !!(outcome as { interrupted?: boolean } | void)?.interrupted; } catch (error: any) {
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
  return turnInterrupted;
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
/** Gemma 4 E2B/E4B need <|think|> prepended to activate thinking mode — both llama.cpp and LiteRT.
 *  The engine-specific decision lives in engines.wantsLeadingThinkToken (the seam), not here. */
const applyGemma4ThinkToken = (prompt: string, model: DownloadedModel | null | undefined, opts: { isRemote: boolean }): string => {
  const prepend = wantsLeadingThinkToken(model, opts);
  // [THINK-SM] the activation decision now reads the LIVE thinking setting (no stale render snapshot),
  // so a toggle takes effect on the very next turn (was off-by-one — device 2026-07-14).
  logger.log(`[THINK-SM] prepend=${prepend} thinkingEnabled=${useAppStore.getState().settings.thinkingEnabled} isRemote=${opts.isRemote} engine=${model?.engine ?? 'none'}`);
  return prepend ? `<|think|>\n${prompt}` : prompt;
};

function resolveToolsAndPrompt(deps: GenerationDeps, conversation: any, _messageText: string): { enabledTools: string[]; rawPrompt: string; localToolSupport: boolean } {
  const project = conversation?.projectId ? useProjectStore.getState().getProject(conversation.projectId) : null;
  const { activeServerId, activeRemoteTextModelId } = useRemoteServerStore.getState();
  // Native tool-calling of the ACTIVE LOCAL engine (llama Jinja support / LiteRT loaded), resolved
  // by the engine registry — no engine === 'litert' branch here (OCP: add a backend in engines.ts).
  const localToolSupport = activeLocalTextCapabilities(deps.activeModel).tools;
  // Honour the UI gate: "N/A" (supportsToolCalling === false) means the picker is unreachable, so don't inject tools the user can't disable.
  const canUseTools = deps.supportsToolCalling !== false && (localToolSupport || !!(activeServerId && activeRemoteTextModelId));

  // SINGLE source of truth for the turn's tools: ONLY what the user toggled (settings.enabledTools).
  // No auto-injection — a project no longer silently adds search_knowledge_base. This keeps the tools
  // SENT identical to the tools the quick-settings count SHOWS (both read settings.enabledTools), so
  // the two can never drift ("0 tools" in the popover but "Tools sent in request (1)" — device 2026-07-14).
  // The user enables KB search explicitly when they want it.
  const enabledTools = canUseTools ? (deps.settings.enabledTools || []) : [];

  const rawPrompt = project?.systemPrompt || deps.settings.systemPrompt || APP_CONFIG.defaultSystemPrompt;
  return { enabledTools, rawPrompt, localToolSupport };
}
export async function startGenerationFn(deps: GenerationDeps, call: StartGenerationCall): Promise<void> {
  // PER-TURN stop truth (from the tool loop's outcome) — never the service's shared abort flag,
  // which the NEXT turn's prepare resets (the race that mislabeled a stopped turn 'No response').
  let turnStopped = false;
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
  const { enabledTools, rawPrompt, localToolSupport } = resolveToolsAndPrompt(deps, conversation, messageText);
  let basePrompt = await injectRagContext(conversation?.projectId, messageText, rawPrompt);

  // In voice/audio mode the pro audio feature augments the prompt for spoken
  // output. No-op (returns undefined) in free builds.
  basePrompt = callHook<string>(HOOKS.audioAugmentPrompt, basePrompt) ?? basePrompt;

  const isRemote = !!useRemoteServerStore.getState().activeRemoteTextModelId;
  const activeTools = enabledTools;
  // Text hint only when the LOCAL engine lacks native tool-calling (llama without Jinja); LiteRT
  // and remote pass tools natively, so injecting a hint would double-inject. localToolSupport is
  // the engine-registry answer — no engine === 'litert' branch here.
  const useTextHint = !isRemote && !localToolSupport && activeTools.length > 0;

  // MCP/extension hints are injected once, centrally, by augmentSystemPromptForTools
  // in the tool loop (covers every engine + tool path). Do NOT add them here too, or
  // the hint lands in the system prompt twice. Only the built-in-tools text hint is
  // added here, and only when the model lacks native Jinja tool calling.
  const systemPrompt = applyGemma4ThinkToken(
    useTextHint
      ? `${basePrompt}${buildToolSystemPromptHint(activeTools)}`
      : basePrompt,
    deps.activeModel,
    { isRemote },
  );
  const messagesForContext = buildMessagesForContext(targetConversationId, messageText, systemPrompt);
  await prepareContext(setDebugInfo, systemPrompt, messagesForContext);
  try {
    turnStopped = await generateWithCompactionRetry({ id: targetConversationId, prompt: systemPrompt, messages: messagesForContext }, activeTools, conversation?.projectId);
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
                  // Inherit the current chat's project so the context-full continuation
                  // stays filed under the same project (Q11: it was created unfiled).
                  const newId = deps.createConversation(modelId, undefined, conversation?.projectId);
                  deps.setActiveConversation(newId);
                }
              },
            },
          ],
        ),
        prominentMessage: true,
      });
    } else {
      // A runtime engine failure (e.g. LiteRT CPU 'Status Code: 13 Failed to invoke the
      // compiled model', B23) must not vanish into an ephemeral alert, leaving the user
      // staring at their own message. Surface the exact error durably inline as an
      // assistant message on the turn, AND keep the immediate alert (generic body so the
      // detailed error text lives in ONE place — the inline message).
      deps.addMessage(targetConversationId, { role: 'assistant', content: msg });
      deps.setAlertState(showAlert('Generation Error', 'The model could not complete this response. The details are shown in the chat.'));
    }
    generationSession.end('error');
    return;
  }
  // The model produced NO output (0 tokens) — finalizeStreamingMessage only appends an
  // assistant message when there's content/reasoning, so an empty turn leaves the user
  // message last. Don't strand the user staring at their message: surface a retry (this
  // happens when a model runs on an incompatible backend, e.g. a K-quant on NPU/GPU).
  const finalConv = useChatStore.getState().conversations.find(c => c.id === targetConversationId);
  const lastMsg = finalConv?.messages[finalConv.messages.length - 1];
  // `turnInterrupted` is THIS turn's own outcome. The shared wasAborted() flag is reset by the
  // NEXT turn's prepare — a concurrent retry raced it and this stopped turn read "not aborted",
  // painting the wrong 'No response / incompatible backend' card (device 2026-07-14 00:23).
  if (!turnStopped && !generationService.wasAborted() && lastMsg?.role === 'user') {
    reportModelFailure('text', 'The model produced no output', {
      title: 'No response',
      message: 'The model returned nothing. This can happen when it runs on an incompatible backend (a K-quant on NPU/GPU falls back to CPU and may emit nothing). Try again, or switch the backend/model.',
      onRetry: () => { startGenerationFn(deps, call); },
    });
  }
  generationSession.end();
}
let _msgIdSeq = 0; const nextMsgId = () => `${Date.now()}-${(++_msgIdSeq).toString(36)}`;

/** The outcome of the shared post-decision dispatch: either the turn is fully HANDLED here (an image was
 *  generated, or the text route bailed because no text model could be provisioned), or the caller must run
 *  its own text executor with the (possibly image-fallback-augmented) messageText. */
type ResolvedDispatch = { handled: true } | { handled: false; messageText: string };

/**
 * THE single post-decision dispatch seam — shared by send (dispatchGenerationFn) AND resend
 * (regenerateResponseFn) so the two can never diverge once resolveTurnKind has chosen the modality.
 * Given the resolved `kind`, it applies the SAME image-model guard, text-model provisioning, and
 * image-fallback note to both paths; the only per-path variance (whether the user message already
 * exists in history, and what to do when no text model can be provisioned) is injected via `opts`.
 * The prior bug was two post-decision sites: resend fired the image pipeline UNCONDITIONALLY (no
 * activeImageModel guard) and had no text-provision path, so the same prompt behaved differently on
 * resend vs send when no image model / no text model was loaded. This is now decided in ONE place.
 */
async function dispatchResolvedTurn(
  deps: GenerationDeps,
  kind: TurnKind,
  opts: {
    /** The user text for the turn (image prompt + text-route base before the image-fallback note). */
    text: string;
    /** Attachments carried on the user message (kept on the image user message, e.g. a voice note). */
    attachments?: MediaAttachment[];
    conversationId: string;
    /** True on resend: the user message already exists in history, so the image path must not re-add it. */
    imageSkipsUserMessage: boolean;
    /** Called when the text route needs a text model (image-only device) but none could be provisioned —
     *  send stashes a pending message here; resend just bails. Return value is ignored (the turn is handled). */
    onTextModelUnavailable: () => void;
  },
): Promise<ResolvedDispatch> {
  const shouldGenerateImage = kind === 'image';
  if (shouldGenerateImage && deps.activeImageModel) {
    logger.log('[ROUTE-SM] dispatch → IMAGE pipeline');
    await handleImageGenerationFn(deps, { prompt: opts.text, conversationId: opts.conversationId, attachments: opts.attachments, skipUserMessage: opts.imageSkipsUserMessage });
    return { handled: true };
  }
  logger.log(`[ROUTE-SM] dispatch → TEXT generation (shouldGenerateImage=${shouldGenerateImage})`);
  // Text route, no text model selected (image-only device): load one / open selector.
  if (!shouldGenerateImage && deps.hasTextModel === false && !deps.activeModelInfo?.isRemote) {
    const ready = await deps.ensureTextModelForChat();
    if (!ready) {
      opts.onTextModelUnavailable();
      return { handled: true };
    }
  }
  let messageText = appendAttachmentText(opts.text, opts.attachments);
  if (shouldGenerateImage && !deps.activeImageModel) messageText = `[User wanted an image but no image model is loaded] ${messageText}`;
  return { handled: false, messageText };
}

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
  const messageTextForRoute = appendAttachmentText(text, attachments);
  // [ROUTE-SM]: confirms the turn reached the router (esp. the voice path) + the
  // final routed destination — so a "pipeline never triggered" is visible in logs.
  logger.log(`[ROUTE-SM] dispatch text="${text.slice(0, 60)}" imageMode=${imageMode} hasImageModel=${!!deps.activeImageModel}`);
  // ONE decision seam (resolveTurnKind); a NEW turn has no recorded kind so the route rule decides.
  const kind = await resolveTurnKind(deps, { text: messageTextForRoute, forceImageMode: imageMode === 'force', imageEnabled: imageMode !== 'disabled' });
  // ONE post-decision dispatch seam, shared with resend (image-model guard + text-provision path).
  const result = await dispatchResolvedTurn(deps, kind, {
    text, attachments, conversationId, imageSkipsUserMessage: false,
    onTextModelUnavailable: () => { deps.setPendingMessage?.(text, attachments); },
  });
  if (result.handled) return;
  deps.addMessage(conversationId, { role: 'user', content: text, attachments });
  await startTextGeneration(conversationId, result.messageText);
}
export type SendCall = { text: string; attachments?: MediaAttachment[]; imageMode?: 'auto' | 'force' | 'disabled'; startGeneration: (convId: string, text: string) => Promise<void>; setDebugInfo: SetState<any> };
export async function handleSendFn(deps: GenerationDeps, call: SendCall): Promise<void> {
  const { text, attachments, imageMode = 'auto', startGeneration } = call;
  abortPreload(); // user acted — stop background warming so it can't block them
  if (!deps.hasActiveModel) { deps.setAlertState(showAlert('No Model Selected', 'Please select a model first.')); return; }
  // Vision gate (shared with resend): never send an image to a model that can't do vision.
  if (blockedImageForNonVisionModel(deps, attachments)) return;
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
    // Carry the user's forced modality through the queue so a queued force-image send is dispatched as
    // image on drain — not re-decided at 'auto' by resolveTurnKind (#510).
    generationService.enqueueMessage({ id: nextMsgId(), conversationId: targetConversationId, text, attachments, messageText, imageMode });
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
export type RegenerateCall = { setDebugInfo: SetState<any>; userMessage: Message; recordedKind?: TurnKind };
export async function regenerateResponseFn(deps: GenerationDeps, call: RegenerateCall): Promise<void> {
  const { userMessage, recordedKind } = call;
  logger.log(`[RESEND-SM] regenerate start userMsg=${userMessage.id} conv=${deps.activeConversationId} hasActiveModel=${deps.hasActiveModel} isRemote=${deps.activeModelInfo?.isRemote} hasActiveModelObj=${!!deps.activeModel} recordedKind=${recordedKind ?? 'none'}`);
  if (!deps.activeConversationId || !deps.hasActiveModel) { logger.log('[RESEND-SM] regenerate BAIL: no conv or no active model'); return; }
  await modelResidencyManager.reclaimSttForGeneration(); // free idle Whisper before the LLM reload (memory-tight)
  const targetConversationId = deps.activeConversationId;
  const messageTextForRoute = appendAttachmentText(userMessage.content, userMessage.attachments);
  // Same decision seam as dispatch (resolveTurnKind): a replay passes the RECORDED kind, which wins
  // verbatim — an image turn re-runs the image pipeline, NEVER re-classifies to text and fails to
  // load a text model (the 1★ resend bug). Only a legacy turn with no recorded kind classifies.
  const kind = await resolveTurnKind(deps, { text: messageTextForRoute, recordedKind });
  // SAME post-decision dispatch seam as send: the image path is guarded on activeImageModel (so an
  // image turn resent with no image model FALLS BACK to text like send, instead of erroring), and the
  // text route provisions a text model on an image-only device (like send). skipUserMessage: the user
  // message already exists in history on resend.
  const result = await dispatchResolvedTurn(deps, kind, {
    text: userMessage.content, attachments: userMessage.attachments, conversationId: targetConversationId,
    imageSkipsUserMessage: true,
    onTextModelUnavailable: () => { deps.setPendingMessage?.(userMessage.content, userMessage.attachments); },
  });
  if (result.handled) return;
  const messageText = result.messageText;
  // Same vision gate as the send path: resending a turn whose message carries an image must not push it to a
  // model that can't do vision (would crash with "Multimodal support not enabled"). Shared gate → identical UX.
  if (blockedImageForNonVisionModel(deps, userMessage.attachments)) return;
  if (!deps.activeModelInfo?.isRemote && deps.activeModel &&
      !(await ensureReadyOrAlert(deps, 'regenerate', () => { regenerateResponseFn(deps, call); }))) return;
  logger.log('[RESEND-SM] regenerate → reached LLM generate path');
  generationSession.begin(targetConversationId);
  // LiteRT: native history must be rewound to match the JS messages we're about to replay.
  // Dispatched via the service (no engine branch here); a no-op for engines without a KV cache.
  invalidateActiveConversation();
  const conversation = useChatStore.getState().conversations.find(c => c.id === targetConversationId);
  const messages = (conversation?.messages || []).filter((m: Message) => !m.isSystemInfo);
  const messagesUpToUser = messages.slice(0, messages.findIndex((m: Message) => m.id === userMessage.id) + 1)
    .map(m => m.id === userMessage.id ? { ...m, content: messageText } : m);
  const { enabledTools, rawPrompt, localToolSupport } = resolveToolsAndPrompt(deps, conversation, messageText);
  const isRemote = !!useRemoteServerStore.getState().activeRemoteTextModelId;
  const activeTools = enabledTools;
  const basePrompt = await injectRagContext(conversation?.projectId, messageText, rawPrompt);
  const useTextHint = !isRemote && !localToolSupport && activeTools.length > 0;
  // MCP/extension hints come solely from augmentSystemPromptForTools in the tool loop
  // (see the send path above) — adding them here too would double-inject.
  const systemPrompt = applyGemma4ThinkToken(
    useTextHint
      ? `${basePrompt}${buildToolSystemPromptHint(activeTools)}`
      : basePrompt,
    deps.activeModel,
    { isRemote },
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
                  // Inherit the current chat's project so the context-full continuation
                  // stays filed under the same project (Q11: it was created unfiled).
                  const newId = deps.createConversation(modelId, undefined, conversation?.projectId);
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
