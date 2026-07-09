/** GenerationService - Handles LLM generation independently of UI lifecycle */
import { llmService } from './llm';
import { liteRTService } from './litert';
import { getActiveEngineService } from './engines';
import { useAppStore, useChatStore, useRemoteServerStore } from '../stores';
import { Message, GenerationMeta, MediaAttachment } from '../types';
import { runToolLoop } from './generationToolLoop';
import type { ToolResult } from './tools/types';
import { providerRegistry } from './providers';
import logger from '../utils/logger';
import { shouldShowSharePrompt, emitSharePrompt } from '../utils/sharePrompt';
import { checkProPromptForText } from '../utils/proPrompt';
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
    if (!s.hasEngagedSharePrompt && shouldShowSharePrompt(count)) setTimeout(() => emitSharePrompt('text'), delayMs);
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
  ): Promise<void> {
    // Route to remote provider if active
    if (this.isUsingRemoteProvider()) {
      return this.generateRemoteWithTools(conversationId, messages, options);
    }
    // Local generation with tools
    const { enabledToolIds, projectId, ...callbacks } = options;
    if (!(await this.prepareGeneration(conversationId))) return;
    const chatStore = useChatStore.getState();

    try {
      await runToolLoop({
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
    } catch (error) {
      if (this.abortRequested) return;
      logger.error('[GenerationService] Tool generation error:', error);
      if (this.flushTimer) {
        clearTimeout(this.flushTimer);
        this.flushTimer = null;
      }
      this.tokenBuffer = '';
      chatStore.clearStreamingMessage();
      this.resetState();
      throw error;
    }
  }

  /** Stop the current generation. Returns partial content if any was generated. */
  async stopGeneration(): Promise<string> {
    if (!this.state.isGenerating) {
      // Stop all engines and remote
      await llmService.stopGeneration().catch(() => { });
      await liteRTService.stopGeneration().catch(() => { });
      const provider = this.getCurrentProvider();
      if (provider) provider.stopGeneration().catch(() => { });
      if (this.currentRemoteAbortController) {
        this.currentRemoteAbortController.abort();
        this.currentRemoteAbortController = null;
      }
      // Ensure chat store streaming state is cleared even if generation
      // service already reset — prevents stuck stop button.
      useChatStore.getState().clearStreamingMessage();
      return '';
    }

    // Set abort flag BEFORE stopping so the onComplete callback
    // knows we're stopping and won't finalize/reset on its own.
    this.abortRequested = true;
    this.forceFlushTokens();

    const { conversationId, streamingContent, startTime } = this.state;
    const generationTime = startTime ? Date.now() - startTime : undefined;

    const chatStore = useChatStore.getState();
    if (conversationId && streamingContent.trim()) {
      chatStore.finalizeStreamingMessage(conversationId, generationTime, this.buildGenerationMeta());
      this.checkSharePrompt();
    } else {
      chatStore.clearStreamingMessage();
    }

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
      return streamingContent;
    }

    // Stop the native completion after we've already updated UI state,
    // so the user sees immediate feedback. Store the promise so new
    // generations can drain it before starting.
    const engine = getActiveEngineService();
    this.pendingStop = (engine?.stopGeneration() ?? Promise.resolve())
      .catch(() => { })
      .finally(() => { this.pendingStop = null; });

    return streamingContent;
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
