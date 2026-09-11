/** Mobile projection of the Shared ChatSessionService lifecycle. */
import { answerTextForStreamingSpeech } from '@offgrid/application';
import {
  compactionNoticeText,
  fallbackNoticeText,
  type ChatSessionEvent,
  type ChatTurn,
} from '@offgrid/models';
import { callHook, HOOKS } from '../bootstrap/hookRegistry';
import { useAppStore, useChatStore } from '../stores';
import { maybeScheduleSharePrompt } from '../utils/sharePrompt';
import { checkProPromptForText } from './proPrompt';
import { FLUSH_INTERVAL_MS } from './generationServiceHelpers';
import { appendWorkspaceContentMessage } from './workspaceContentMessages';

const SHARE_PROMPT_DELAY_MS = 1500;
/** Compaction is silent otherwise; the row below says the model made room and that nothing here was removed. */
const COMPACTION_TOOL_NAME = 'context_compaction';
/** A fallback changes who answers; the row below names the model that failed and the one that took over. */
const MODEL_FALLBACK_TOOL_NAME = 'model_fallback';

/** Projects Shared chat events into Mobile UI state. It owns no generation policy. */
class MobileGenerationProjection {
  /** Exact Shared turn whose ephemeral stream currently owns Mobile's single visible buffer. */
  private activeTurnId: string | null = null;
  private activeConversationId: string | null = null;
  private cumulativeContent = '';
  private totalReasoningLength = 0;
  private thinkingEnabled = false;
  // Token batching — collect tokens and flush to the store at a controlled rate
  private tokenBuffer = '';
  private reasoningBuffer = '';
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private lastFlushAt = 0;

  async publish(event: ChatSessionEvent): Promise<void> {
    switch (event.type) {
      case 'started':
        this.start(event.turn);
        return;
      case 'partial':
        this.partial(
          event.turn,
          event.partial.content,
          event.partial.reasoning,
        );
        return;
      case 'tool_started':
        this.toolStarted(event.turn);
        return;
      case 'compacted':
        return this.compacted(event.turn, event.before, event.after);
      case 'fallback':
        return this.fallback(event);
      case 'completed':
        this.complete(event.turn);
        return;
      case 'stopped':
      case 'interrupted':
      case 'failed':
        this.terminal(event.turn);
        return;
      default:
        return;
    }
  }

  private start(turn: ChatTurn): void {
    if (turn.request.operation.type === 'image') return;
    if (this.isActive(turn)) return;
    // Mobile has one visible ephemeral stream. A newer visible turn may replace an older one, but
    // buffered bytes and delayed flushes from the old turn must never enter the new turn's row.
    if (this.activeTurnId !== turn.id) this.discardBufferedTokens();
    this.activeTurnId = turn.id;
    this.lastFlushAt = Date.now();
    this.totalReasoningLength = 0;
    this.cumulativeContent = '';
    this.activeConversationId = turn.conversationId;
    // Shared Models resolved this committed setting into the immutable turn request before native
    // generation began. The UI store must not read a second writable settings projection.
    this.thinkingEnabled = turn.request.request.reasoning?.enabled === true;
    if (!turn.assistantMessageId) {
      throw new Error(`Assistant message identity missing for turn: ${turn.id}`);
    }
    useChatStore
      .getState()
      .startStreaming(turn.conversationId, turn.assistantMessageId);
  }

  private partial(turn: ChatTurn, content: string, reasoning: string): void {
    if (!this.isActive(turn)) return;
    const contentDelta = content.startsWith(this.cumulativeContent)
      ? content.slice(this.cumulativeContent.length)
      : content;
    const reasoningDelta = reasoning.slice(this.totalReasoningLength);
    if (contentDelta) {
      this.tokenBuffer += contentDelta;
    }
    if (reasoningDelta) this.reasoningBuffer += reasoningDelta;
    if (contentDelta || reasoningDelta) {
      const remaining = FLUSH_INTERVAL_MS - (Date.now() - this.lastFlushAt);
      if (remaining <= 0) {
        this.forceFlushTokens();
      } else if (!this.flushTimer) {
        this.flushTimer = setTimeout(
          () => this.flushTokenBuffer(),
          remaining,
        );
      }
    }
    this.totalReasoningLength = reasoning.length;
    this.cumulativeContent = content;
  }

  private toolStarted(turn: ChatTurn): void {
    if (!this.isActive(turn)) return;
    this.forceFlushTokens();
    useChatStore.getState().resetStreamingSegment();
    // Shared reports turn-level cumulative reasoning across tool rounds. Keep
    // the consumed length when the visible segment resets, so the next round
    // appends only its new reasoning instead of repeating the completed round.
    this.cumulativeContent = '';
  }

  /** Compaction is forward-looking: text already on screen stays; the continuation streams after it. */
  private async compacted(
    turn: ChatTurn,
    before: number,
    after: number,
  ): Promise<void> {
    if (this.isActive(turn)) {
      this.forceFlushTokens();
      useChatStore.getState().resetStreamingSegment();
    }
    await appendWorkspaceContentMessage({
      conversationId: turn.conversationId,
      portable: {
        role: 'tool',
        content: compactionNoticeText(before, after),
        context: { notice: true, tool: { name: COMPACTION_TOOL_NAME } },
      },
    });
    if (this.isActive(turn)) {
      this.cumulativeContent = '';
    }
  }

  /** Another model takes the reply. The chat says so before that model's first token arrives. */
  private async fallback({
    turn,
    failed,
    next,
    error,
  }: Extract<ChatSessionEvent, { type: 'fallback' }>): Promise<void> {
    if (turn.request.operation.type === 'image') return;
    if (this.isActive(turn)) {
      this.forceFlushTokens();
      useChatStore.getState().resetStreamingSegment();
    }
    await appendWorkspaceContentMessage({
      conversationId: turn.conversationId,
      portable: {
        role: 'tool',
        content: fallbackNoticeText(failed, next, error),
        context: { notice: true, tool: { name: MODEL_FALLBACK_TOOL_NAME } },
      },
    });
    if (this.isActive(turn)) {
      this.cumulativeContent = '';
    }
  }

  private complete(turn: ChatTurn): void {
    if (turn.request.operation.type === 'image') {
      // ChatSession publishes completion only after the final assistant row is durable. Starting
      // voice from the image engine's earlier `done` phase raced that write and read the prompt card
      // or the user row instead of the generated-image response.
      callHook(HOOKS.audioOnStreamingEnd, turn.conversationId);
      return;
    }
    if (!this.isActive(turn)) {
      this.checkSharePrompt();
      return;
    }
    this.forceFlushTokens();
    this.endEphemeralStream(turn);
    this.checkSharePrompt();
    this.reset();
  }

  private terminal(turn: ChatTurn): void {
    if (turn.request.operation.type === 'image') return;
    if (!this.isActive(turn)) return;
    this.forceFlushTokens();
    this.endEphemeralStream(turn);
    this.reset();
  }

  /** Shared has committed the terminal turn before it publishes this event. Clear only UI state. */
  private endEphemeralStream(turn: ChatTurn): void {
    const streamingForConversationId =
      useChatStore.getState().streamingForConversationId;
    if (streamingForConversationId !== turn.conversationId) return;
    useChatStore.setState({
      streamingMessage: '',
      streamingReasoningContent: '',
      streamingForConversationId: null,
      streamingMessageUuid: null,
      lastReplyEnd: {
        conversationId: turn.conversationId,
        persisted: Boolean(turn.responseMessages?.length),
      },
    });
  }

  private checkSharePrompt(): void {
    const state = useAppStore.getState();
    const count = state.incrementTextGenerationCount();
    maybeScheduleSharePrompt({
      variant: 'text',
      count,
      hasEngaged: state.hasEngagedSharePrompt,
      delayMs: SHARE_PROMPT_DELAY_MS,
    });
    checkProPromptForText(SHARE_PROMPT_DELAY_MS);
  }

  private flushTokenBuffer(): void {
    const store = useChatStore.getState();
    if (this.tokenBuffer) {
      store.appendToStreamingMessage(this.tokenBuffer);
      this.tokenBuffer = '';
      const streaming = useChatStore.getState();
      // Feed only the answer to optional Pro speech. This adapter owns the hook boundary; ChatStore
      // owns only transient UI text and has no model-setting dependency.
      callHook(
        HOOKS.audioOnStreamingToken,
        answerTextForStreamingSpeech({
          content: streaming.streamingMessage,
          reasoning: streaming.streamingReasoningContent,
          thinkingEnabled: this.thinkingEnabled,
        }),
        streaming.streamingMessageUuid,
      );
    }
    if (this.reasoningBuffer) {
      store.appendToStreamingReasoningContent(this.reasoningBuffer);
      this.reasoningBuffer = '';
    }
    this.flushTimer = null;
    this.lastFlushAt = Date.now();
  }

  private forceFlushTokens(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.flushTokenBuffer();
  }

  private discardBufferedTokens(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    this.tokenBuffer = '';
    this.reasoningBuffer = '';
    this.lastFlushAt = 0;
  }

  private isActive(turn: ChatTurn): boolean {
    return (
      this.activeTurnId === turn.id &&
      this.activeConversationId === turn.conversationId
    );
  }

  private reset(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.tokenBuffer = '';
    this.reasoningBuffer = '';
    this.totalReasoningLength = 0;
    this.lastFlushAt = 0;
    this.thinkingEnabled = false;
    this.activeTurnId = null;
    this.activeConversationId = null;
    this.cumulativeContent = '';
  }
}

export const mobileChatGenerationProjection = new MobileGenerationProjection();
