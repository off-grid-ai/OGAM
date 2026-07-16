/** GenerationService - Handles LLM generation independently of UI lifecycle */
import { llmService } from './llm';
import { getActiveEngineService, stopAllTextEngines } from './engines';
import { useAppStore, useChatStore, useRemoteServerStore } from '../stores';
import { Message, GenerationMeta, MediaAttachment } from '../types';
import { runToolLoop } from './generationToolLoop';
import type { ToolResult } from './tools/types';
import { providerRegistry } from './providers';
import logger from '../utils/logger';
import { maybeScheduleSharePrompt } from '../utils/sharePrompt';
import { checkProPromptForText } from './proPrompt';
import {
  buildGenerationMetaImpl,
  buildToolLoopHandlersImpl,
  prepareGenerationImpl,
  generateResponseImpl,
  generateRemoteResponseImpl,
  generateRemoteWithToolsImpl,
  type GenerationWithToolsRequest,
} from './generationServiceHelpers';

const SHARE_PROMPT_DELAY_MS = 1500;
type StreamChunk = string | { content?: string; reasoningContent?: string };

export interface QueuedMessage {
  id: string; conversationId: string; text: string;
  attachments?: MediaAttachment[]; messageText: string;
  /** The modality the user forced for THIS send (force/disabled/auto). Carried through the queue so a
   *  message the user explicitly forced to image mode is dispatched as image on drain — never re-decided
   *  at 'auto' by resolveTurnKind (#510: a queued force-image send generated as text). */
  imageMode?: 'auto' | 'force' | 'disabled';
}

export interface GenerationState {
  isGenerating: boolean;
  isThinking: boolean;
  conversationId: string | null;
  streamingContent: string;
  startTime: number | null;
  queuedMessages: QueuedMessage[];
}

type GenerationListener = (state: GenerationState) => void;
type QueueProcessor = (item: QueuedMessage) => Promise<void>;

class GenerationService {
  private state: GenerationState = {
    isGenerating: false, isThinking: false, conversationId: null,
    streamingContent: '', startTime: null, queuedMessages: [],
  };

  private listeners: Set<GenerationListener> = new Set();
  private abortRequested: boolean = false;
  /** Whether the last/active generation was stopped by the user — lets callers skip a
   *  "no response" retry prompt when the empty result was an intentional abort. */
  wasAborted(): boolean { return this.abortRequested; }
  private pendingStop: Promise<void> | null = null;
  private queueProcessor: QueueProcessor | null = null;
  private currentRemoteAbortController: AbortController | null = null;
  private remoteTimeToFirstToken: number | undefined;

  // Token batching — collect tokens and flush to UI at a controlled rate
  private tokenBuffer: string = '';
  private reasoningBuffer: string = '';
  private totalReasoningLength: number = 0;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  /** Get the current provider (local or remote) */
  private getCurrentProvider() {
    const activeServerId = useRemoteServerStore.getState().activeServerId;
    if (activeServerId) {
      return providerRegistry.getProvider(activeServerId);
    }
    return providerRegistry.getProvider('local');
  }

  /** Check if using a remote provider */
  private isUsingRemoteProvider(): boolean {
    const { activeServerId } = useRemoteServerStore.getState();
    const hasProvider = activeServerId ? providerRegistry.hasProvider(activeServerId) : false;
    const localLoaded = llmService.isModelLoaded();
    logger.log(`[REMOTE-SM] isUsingRemoteProvider? activeServerId=${activeServerId ?? 'none'} hasProvider=${hasProvider} localLoaded=${localLoaded}`);
    if (!activeServerId) return false;
    // Provider must be registered (not just persisted from a previous session)
    if (!hasProvider) return false;
    // If a local model is loaded, prefer it over the remote server.
    // Log a warning so this is diagnosable if a user selects remote but gets local responses.
    if (localLoaded) {
      logger.warn('[GenerationService] Local model is loaded — preferring local over active remote server:', activeServerId);
      return false;
    }
    return true;
  }

  private flushTokenBuffer(): void {
    const store = useChatStore.getState();
    if (this.tokenBuffer) {
      store.appendToStreamingMessage(this.tokenBuffer);
      this.tokenBuffer = '';
    }
    if (this.reasoningBuffer) {
      store.appendToStreamingReasoningContent(this.reasoningBuffer);
      this.reasoningBuffer = '';
    }
    this.flushTimer = null;
  }

  private forceFlushTokens(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.flushTokenBuffer();
  }

  private normalizeStreamChunk(data: StreamChunk): { content?: string; reasoningContent?: string } {
    return typeof data === 'string' ? { content: data } : data;
  }

  getState(): GenerationState { return { ...this.state }; }

  isGeneratingFor(conversationId: string): boolean {
    return this.state.isGenerating && this.state.conversationId === conversationId;
  }

  subscribe(listener: GenerationListener): () => void {
    this.listeners.add(listener); listener(this.getState()); return () => this.listeners.delete(listener);
  }

  private notifyListeners(): void { this.listeners.forEach(l => l(this.getState())); }

  private updateState(partial: Partial<GenerationState>): void {
    this.state = { ...this.state, ...partial };
    this.notifyListeners();
  }

  private checkSharePrompt(delayMs = SHARE_PROMPT_DELAY_MS): void {
    const s = useAppStore.getState();
    const count = s.incrementTextGenerationCount();
    maybeScheduleSharePrompt({ variant: 'text', count, hasEngaged: s.hasEngagedSharePrompt, delayMs });
    checkProPromptForText(delayMs);
  }

  private buildToolLoopHandlers() { return buildToolLoopHandlersImpl(this); }
  private buildGenerationMeta(): GenerationMeta { return buildGenerationMetaImpl(this); }
  private async prepareGeneration(conversationId: string): Promise<boolean> {
    return prepareGenerationImpl(this, conversationId);
  }

  /** Generate a response for a conversation. Runs independently of UI lifecycle. */
  async generateResponse(
    conversationId: string,
    messages: Message[],
    onFirstToken?: () => void,
  ): Promise<void> {
    logger.log(`[REMOTE-SM] generateResponse entry conv=${conversationId} msgs=${messages.length}`);
    // Route to remote provider if active
    if (this.isUsingRemoteProvider()) {
      return this.generateRemoteResponse(conversationId, messages, onFirstToken);
    }
    return generateResponseImpl(this, { conversationId, messages, onFirstToken });
  }

  /** Generate a response with tool calling support (LLM → tools → repeat, max 5 iterations). */
  async generateWithTools(
    conversationId: string,
    messages: Message[],
    options: {
      enabledToolIds: string[];
      projectId?: string;
      onToolCallStart?: (name: string, args: Record<string, any>) => void;
      onToolCallComplete?: (name: string, result: ToolResult) => void;
      onFirstToken?: () => void;
    },
  ): Promise<import('./generationToolLoop').ToolLoopOutcome | void> {
    // Route to remote provider if active
    if (this.isUsingRemoteProvider()) {
      return this.generateRemoteWithTools(conversationId, messages, options);
    }
    // Local generation with tools
    const { enabledToolIds, projectId, ...callbacks } = options;
    if (!(await this.prepareGeneration(conversationId))) return;

    try {
      const outcome = await runToolLoop({
        conversationId,
        messages,
        enabledToolIds,
        projectId,
        callbacks,
        ...this.buildToolLoopHandlers(),
      });

      // If aborted, stopGeneration() already handled cleanup.
      logger.log(`[GenService][ToolLoop] runToolLoop done — aborted=${this.abortRequested}, streamingContent=${this.state.streamingContent?.length ?? 0}ch, tokenBuffer=${this.tokenBuffer?.length ?? 0}ch`);
      if (!this.abortRequested) {
        this.forceFlushTokens();
        const store = useChatStore.getState();
        logger.log(`[GenService][ToolLoop] pre-finalize — streamingForConvId=${store.streamingForConversationId}, targetConvId=${conversationId}, streamingMsg=${store.streamingMessage?.length ?? 0}ch`);
        const generationTime = this.state.startTime ? Date.now() - this.state.startTime : undefined;
        store.finalizeStreamingMessage(conversationId, generationTime, this.buildGenerationMeta());
        logger.log(`[GenService][ToolLoop] finalizeStreamingMessage called — convId=${conversationId}`);
        this.checkSharePrompt();
        this.resetState();
      }
      return outcome;
    } catch (error) {
      if (this.abortRequested) return;
      logger.error('[GenerationService] Tool generation error:', error);
      // Even on error, keep any partial the user already saw — keepShownPartialOrClear flushes the token
      // buffer to the store first (do NOT discard it here), then finalizes.
      this.keepShownPartialOrClear();
      this.resetState();
      throw error;
    }
  }

  /**
   * Keep whatever is ALREADY on screen. The source of truth is the store's streamingMessage (what the user
   * sees) — NOT generationService.state.streamingContent, which can be empty for LiteRT or after a state
   * reset while a partial is still rendered. If there's shown content, finalize it (an interrupted partial
   * is still the model's output); only clear when the stream is genuinely empty. Once tokens are shown, they
   * are never discarded (device 2026-07-14: Stop dropped the partial because the decision read the wrong source).
   */
  private keepShownPartialOrClear(generationTimeMs?: number): void {
    this.forceFlushTokens(); // flush any batched tokens to the store so a partial isn't lost to a pending timer
    const store = useChatStore.getState();
    const convId = store.streamingForConversationId;
    // There is NO case to discard shown output. finalizeStreamingMessage persists whatever streamed —
    // content OR reasoning (its own guard drops a genuinely-empty stream) — and resets the streaming state
    // either way, so it's a strict superset of clear. ALWAYS finalize when a conversation is streaming; only
    // clear when there is no streaming conversation at all (nothing was ever shown). The old check looked at
    // streamingMessage ONLY, so a reasoning-only partial (LiteRT still THINKING at stop) was wrongly cleared.
    const shownLen = (store.streamingMessage + store.streamingReasoningContent).trim().length;
    logger.log(`[STOP-SM] keepShownPartialOrClear convId=${convId ?? 'null'} shown=${shownLen}ch → ${convId ? 'finalize' : 'clear'}`);
    if (convId) {
      store.finalizeStreamingMessage(convId, generationTimeMs, this.buildGenerationMeta());
    } else {
      store.clearStreamingMessage();
    }
  }

  /** Stop the current generation. Returns partial content if any was generated. */
  async stopGeneration(): Promise<string> {
    if (!this.state.isGenerating) {
      // Stop generation on every engine through the registry — no engine enumeration leaked into the caller.
      await stopAllTextEngines();
      const provider = this.getCurrentProvider();
      if (provider) provider.stopGeneration().catch(() => { });
      if (this.currentRemoteAbortController) {
        this.currentRemoteAbortController.abort();
        this.currentRemoteAbortController = null;
      }
      // Generation already reset — but a partial may still be on screen (e.g. generationSession.end ran
      // first, or LiteRT's state diverged). Keep the shown output instead of blindly clearing it.
      this.keepShownPartialOrClear();
      return '';
    }

    // Set abort flag BEFORE stopping so the onComplete callback
    // knows we're stopping and won't finalize/reset on its own.
    this.abortRequested = true;
    this.forceFlushTokens();

    const { startTime } = this.state;
    const generationTime = startTime ? Date.now() - startTime : undefined;
    // Capture the return value BEFORE resetState clears it (prefer the shown text; fall back to state).
    const partialContent = useChatStore.getState().streamingMessage || this.state.streamingContent;

    // Keep whatever is shown (based on the store, not this.state.streamingContent which LiteRT may not fill).
    const hadShownPartial = !!useChatStore.getState().streamingMessage.trim();
    this.keepShownPartialOrClear(generationTime);
    if (hadShownPartial) this.checkSharePrompt();

    this.resetState();

    // Stop both local and remote
    if (this.isUsingRemoteProvider()) {
      // Abort the provider's XHR so the server connection is closed immediately
      const provider = this.getCurrentProvider();
      if (provider) provider.stopGeneration().catch(() => { });
      if (this.currentRemoteAbortController) {
        this.currentRemoteAbortController.abort();
        this.currentRemoteAbortController = null;
      }
      return partialContent;
    }

    // Stop the native completion after we've already updated UI state,
    // so the user sees immediate feedback. Store the promise so new
    // generations can drain it before starting.
    const engine = getActiveEngineService();
    this.pendingStop = (engine?.stopGeneration() ?? Promise.resolve())
      .catch(() => { })
      .finally(() => { this.pendingStop = null; });

    return partialContent;
  }

  /** Generate a response using a remote provider */
  async generateRemoteResponse(
    conversationId: string,
    messages: Message[],
    onFirstToken?: () => void,
  ): Promise<void> {
    return generateRemoteResponseImpl(this, { conversationId, messages, onFirstToken });
  }

  /** Generate a response with tools using a remote provider */
  async generateRemoteWithTools(
    conversationId: string,
    messages: Message[],
    options: GenerationWithToolsRequest['options'],
  ): Promise<void> {
    return generateRemoteWithToolsImpl(this, { conversationId, messages, options });
  }

  enqueueMessage(entry: QueuedMessage): void {
    this.state = { ...this.state, queuedMessages: [...this.state.queuedMessages, entry] };
    this.notifyListeners();
  }

  removeFromQueue(id: string): void {
    this.state = { ...this.state, queuedMessages: this.state.queuedMessages.filter(m => m.id !== id) };
    this.notifyListeners();
  }

  clearQueue(): void { this.state = { ...this.state, queuedMessages: [] }; this.notifyListeners(); }

  setQueueProcessor(processor: QueueProcessor | null): void { this.queueProcessor = processor; }

  /**
   * Process queued messages now. Text generation drains its own queue on
   * completion, but image generation finishes outside this service, so the
   * image path calls this to release messages that queued behind it. No-op if a
   * text generation is currently running.
   */
  drainQueue(): void {
    if (this.state.isGenerating) return;
    this.processNextInQueue();
  }

  private processNextInQueue(): void {
    if (this.state.queuedMessages.length === 0 || !this.queueProcessor) return;
    const all = this.state.queuedMessages;
    this.state = { ...this.state, queuedMessages: [] };
    this.notifyListeners();
    const combined: QueuedMessage = all.length === 1 ? all[0] : {
      id: all[0].id, conversationId: all[0].conversationId,
      text: all.map(m => m.text).join('\n\n'),
      attachments: all.flatMap(m => m.attachments || []),
      messageText: all.map(m => m.messageText).join('\n\n'),
      // If ANY coalesced send forced image mode, the combined dispatch must force image too — the
      // user's explicit force must never be dropped by the merge (mirror of the single-message carry).
      imageMode: all.some(m => m.imageMode === 'force') ? 'force' : all[0].imageMode,
    };
    this.queueProcessor(combined).catch(e => { logger.error('[GenerationService] Queue processor error:', e); });
  }

  private resetState(): void {
    const hasQueuedItems = this.state.queuedMessages.length > 0;
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.tokenBuffer = '';
    this.reasoningBuffer = '';
    this.totalReasoningLength = 0;
    this.remoteTimeToFirstToken = undefined;
    this.updateState({
      isGenerating: false,
      isThinking: false,
      conversationId: null,
      streamingContent: '',
      startTime: null,
    });
    if (hasQueuedItems) {
      setTimeout(() => this.processNextInQueue(), 100);
    }
  }
}

export const generationService = new GenerationService();
