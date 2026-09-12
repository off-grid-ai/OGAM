/* eslint-disable max-lines -- one persisted store keeps chat mutations atomic */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { Message, Conversation, GenerationMeta } from '../types';
import {
  stripStreamingControlTokens,
} from '../utils/messageContent';
import { generateId } from '../utils/generateId';
import { createHydrationGatedStorage } from '../utils/hydrationGatedStorage';
import {
  finalizeStreamedReply,
  type ReplyEnd,
  type StreamingSnapshot,
} from './chatStoreReplyFinalization';
import { callHook, HOOKS } from '../bootstrap/hookRegistry';
import {
  CHAT_STORAGE_VERSION,
  createPersistedMessage,
  migratePersistedChatState,
  type PersistedChatState,
} from './chatPersistence';
import {
  createMessageMutationActions,
  nextUpdatedAt,
  type ChatMessageMutationActions,
} from './chatMessageMutationActions';
import {
  CORE_SYNC_ENTITIES,
  conversationPutMutation,
  deleteSyncMutation,
  emitSyncMutation,
  messagePutMutation,
} from '../services/sync/mutation';
/**
 * The portion of the in-progress stream that is safe to SPEAK in voice mode —
 * never the reasoning/thinking. Models that stream reasoning on a separate
 * channel leave streamingMessage answer-only. Models that inline reasoning (e.g.
 * Qwen3, whose chat template injects the opening <think> so only a closing
 * </think> is emitted) are sliced at </think>; until that tag arrives we withhold
 * (return '') while thinking is enabled, so the thought process is never spoken
 * sentence-by-sentence. onStreamingEnd still speaks the final answer if nothing
 * streamed.
 */
function speakableStreamingAnswer(
  streamingMessage: string,
  streamingReasoning: string,
): string {
  if (streamingReasoning.length > 0) return streamingMessage; // reasoning came separately
  const closeIdx = streamingMessage.toLowerCase().lastIndexOf('</think>');
  if (closeIdx !== -1)
    return streamingMessage.slice(closeIdx + '</think>'.length);
  // No close tag yet: inline reasoning may still be in progress. Withhold while
  // thinking is enabled; otherwise the content is the answer and is safe to speak.
  const { useAppStore } = require('./appStore');
  return useAppStore.getState().settings?.thinkingEnabled
    ? ''
    : streamingMessage;
}
/** Derive conversation title from the first user message. */
function deriveTitle(
  currentTitle: string,
  role: string,
  content: string,
): string {
  if (currentTitle !== 'New Conversation' || role !== 'user')
    return currentTitle;
  const truncated = content.slice(0, 50);
  return content.length > 50 ? `${truncated}...` : truncated;
}
export interface ChatState extends ChatMessageMutationActions {
  conversations: Conversation[];
  activeConversationId: string | null;
  streamingMessage: string;
  streamingReasoningContent: string;
  streamingForConversationId: string | null;
  /**
   * The uuid the reply being generated will be STORED under, minted before its first token.
   *
   * One reply, one identity. It used to be minted at the end, when the message was persisted, so a
   * paired device streaming this reply live had to invent its own id for it - and then could not tell
   * that the record which arrived moments later was the same answer. It drew both.
   */
  streamingMessageUuid: string | null;
  isStreaming: boolean;
  isThinking: boolean;
  createConversation: (
    modelId: string,
    title?: string,
    projectId?: string,
  ) => string;
  deleteConversation: (conversationId: string) => void;
  setActiveConversation: (conversationId: string | null) => void;
  getActiveConversation: () => Conversation | null;
  setConversationProject: (
    conversationId: string,
    projectId: string | null,
  ) => void;
  /** Unfile every conversation filed under a project (used when the project is deleted,
   *  so no chat is left pointing at a project that no longer exists). */
  unfileConversationsForProject: (projectId: string) => void;
  addMessage: (
    conversationId: string,
    message: Omit<Message, 'id' | 'timestamp'>,
  ) => Message;
  startStreaming: (conversationId: string) => void;
  setStreamingMessage: (content: string) => void;
  appendToStreamingMessage: (token: string) => void;
  appendToStreamingReasoningContent: (token: string) => void;
  /** Start the next reasoning/answer segment without ending the reply or changing its identity. */
  resetStreamingSegment: () => void;
  setIsStreaming: (streaming: boolean) => void;
  setIsThinking: (thinking: boolean) => void;
  /**
   * The text model is loading, and which one.
   *
   * Here rather than in ChatScreen's `useState`, which is where it used to live. A fact known only
   * to a component is a fact sync cannot see: the phone showed "Loading Qwen3.5 2B" for tens of
   * seconds while every paired device sat on "Preparing reply...", because the live-stream service
   * subscribes to THIS store and there was nothing here to read. The image path never had the bug -
   * its loading state was always a published phase.
   */
  isModelLoading: boolean;
  loadingModelName: string | null;
  setIsModelLoading: (loading: boolean) => void;
  setLoadingModelName: (name: string | null) => void;
  lastReplyEnd: ReplyEnd | null;
  noteReplyEndHandled: () => void;
  finalizeStreamingMessage: (
    conversationId: string,
    generationTimeMs?: number,
    generationMeta?: GenerationMeta,
  ) => void;
  clearStreamingMessage: () => void;
  getStreamingState: () => StreamingSnapshot;
  updateCompactionState: (
    conversationId: string,
    summary?: string,
    cutoffMessageId?: string,
  ) => void;
  clearAllConversations: () => void;
  getConversationMessages: (conversationId: string) => Message[];
}

/** The streaming fields, named so a caller can say WHICH state it means rather than list it. */
type StreamingFields = Pick<
  ChatState,
  | 'streamingMessage'
  | 'streamingReasoningContent'
  | 'streamingForConversationId'
  | 'streamingMessageUuid'
  | 'isStreaming'
  | 'isThinking'
>;

/**
 * No reply is forming. ONE definition, because that is one fact.
 *
 * It used to be written out in four places - the initial state, the start of a stream, the end of
 * one, and a cancel - so every field added to the streaming state had to be remembered in all four,
 * and whichever copy was missed would leak that field into the next reply. The type is a `Pick`, so
 * adding a streaming field is a compile error here until it is given a cleared value.
 */
const MODEL_NOT_LOADING = {
  isModelLoading: false,
  loadingModelName: null,
};
const NO_REPLY_ENDED = { lastReplyEnd: null };

const NO_REPLY_FORMING: StreamingFields = {
  streamingMessage: '',
  streamingReasoningContent: '',
  streamingForConversationId: null,
  streamingMessageUuid: null,
  isStreaming: false,
  isThinking: false,
};

const chatStorage = createHydrationGatedStorage<PersistedChatState>(
  undefined,
  (previous, next) =>
    previous.conversations === next.conversations &&
    previous.activeConversationId === next.activeConversationId,
);

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      conversations: [],
      activeConversationId: null,
      ...NO_REPLY_FORMING,
      ...MODEL_NOT_LOADING,
      ...NO_REPLY_ENDED,

      createConversation: (modelId, title, projectId) => {
        const id = generateId();
        const conversation: Conversation = {
          id,
          title: title || 'New Conversation',
          modelId,
          messages: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          projectId: projectId,
        };

        set(state => ({
          conversations: [conversation, ...state.conversations],
          activeConversationId: id,
        }));
        emitSyncMutation(conversationPutMutation(conversation));

        return id;
      },

      deleteConversation: conversationId => {
        const removed = get().conversations.find(c => c.id === conversationId);
        set(state => ({
          conversations: state.conversations.filter(
            c => c.id !== conversationId,
          ),
          activeConversationId:
            state.activeConversationId === conversationId
              ? null
              : state.activeConversationId,
        }));
        for (const message of removed?.messages ?? []) {
          if (message.uuid)
            emitSyncMutation(
              deleteSyncMutation(CORE_SYNC_ENTITIES.message, message.uuid),
            );
        }
        if (removed)
          emitSyncMutation(
            deleteSyncMutation(CORE_SYNC_ENTITIES.conversation, conversationId),
          );
      },

      setActiveConversation: conversationId => {
        set({ activeConversationId: conversationId });
      },

      getActiveConversation: () => {
        const state = get();
        return (
          state.conversations.find(c => c.id === state.activeConversationId) ||
          null
        );
      },

      setConversationProject: (conversationId, projectId) => {
        set(state => ({
          conversations: state.conversations.map(conv =>
            conv.id !== conversationId
              ? conv
              : {
                  ...conv,
                  projectId: projectId || undefined,
                  updatedAt: nextUpdatedAt(conv.updatedAt),
                },
          ),
        }));
        const conversation = get().conversations.find(
          conv => conv.id === conversationId,
        );
        if (conversation)
          emitSyncMutation(conversationPutMutation(conversation));
      },

      unfileConversationsForProject: projectId => {
        const affected = get().conversations.filter(
          conv => conv.projectId === projectId,
        );
        set(state => ({
          conversations: state.conversations.map(conv =>
            conv.projectId !== projectId
              ? conv
              : {
                  ...conv,
                  projectId: undefined,
                  updatedAt: nextUpdatedAt(conv.updatedAt),
                },
          ),
        }));
        for (const previous of affected) {
          const conversation = get().conversations.find(
            conv => conv.id === previous.id,
          );
          if (conversation)
            emitSyncMutation(conversationPutMutation(conversation));
        }
      },

      addMessage: (conversationId, messageData) => {
        const message = createPersistedMessage(messageData);

        set(state => ({
          conversations: state.conversations.map(conv =>
            conv.id === conversationId
              ? {
                  ...conv,
                  messages: [...conv.messages, message],
                  updatedAt: nextUpdatedAt(conv.updatedAt),
                  title: deriveTitle(
                    conv.title,
                    messageData.role,
                    messageData.content,
                  ),
                }
              : conv,
          ),
        }));
        emitSyncMutation(messagePutMutation(conversationId, message));
        const conversation = get().conversations.find(
          conv => conv.id === conversationId,
        );
        if (conversation)
          emitSyncMutation(conversationPutMutation(conversation));

        return message;
      },

      ...createMessageMutationActions({
        updateConversations: update =>
          set(state => ({ conversations: update(state.conversations) })),
        getConversationMessages: conversationId =>
          get().getConversationMessages(conversationId),
      }),

      startStreaming: conversationId => {
        set({
          ...NO_REPLY_FORMING,
          streamingForConversationId: conversationId,
          // Minted here, before the first token, and carried all the way to the stored row. This is
          // the id a paired device sees on every live frame, so when the record arrives it recognises
          // the answer it is already showing instead of drawing it a second time.
          streamingMessageUuid: generateId(),
          isThinking: true,
        });
      },

      setStreamingMessage: content => {
        set({ streamingMessage: content });
      },

      appendToStreamingMessage: token => {
        set(state => ({
          streamingMessage: stripStreamingControlTokens(
            state.streamingMessage + token,
          ),
          isStreaming: true,
          isThinking: false,
        }));
        // Feed only the ANSWER to pro audio for real-time sentence-by-sentence
        // TTS (never the reasoning) — no-op unless voice mode + engine ready;
        // free builds register nothing.
        callHook(
          HOOKS.audioOnStreamingToken,
          speakableStreamingAnswer(
            get().streamingMessage,
            get().streamingReasoningContent,
          ),
        );
      },

      appendToStreamingReasoningContent: token => {
        set(state => ({
          streamingReasoningContent: state.streamingReasoningContent + token,
          isStreaming: true,
          isThinking: false,
        }));
      },

      resetStreamingSegment: () => {
        set({ streamingMessage: '', streamingReasoningContent: '' });
      },

      setIsStreaming: streaming => {
        set({ isStreaming: streaming, isThinking: false });
      },

      setIsThinking: thinking => {
        set({ isThinking: thinking });
      },

      finalizeStreamingMessage: (
        conversationId,
        generationTimeMs,
        generationMeta,
      ) => {
        const {
          streamingMessage,
          streamingReasoningContent,
          streamingForConversationId,
          streamingMessageUuid,
          addMessage,
        } = get();

        const { persisted, content, reasoningContent } = finalizeStreamedReply({
          streamingMessage,
          streamingReasoningContent,
          streamingForConversationId,
          conversationId,
        });
        // End the ephemeral reply before the durable mutation leaves this device. Both use the same
        // peer link. This order guarantees a receiver sees the final stream frame first and then the
        // record that replaces it, never the reverse order that could recreate a retired preview.
        set({ ...NO_REPLY_FORMING, lastReplyEnd: { conversationId, persisted } });
        if (persisted) {
          addMessage(conversationId, {
            role: 'assistant',
            content,
            reasoningContent,
            generationTimeMs,
            generationMeta,
            // The SAME id the live frames carried. `createPersistedMessage` keeps a supplied uuid, so
            // the reply is stored under the identity its peers have already seen.
            ...(streamingMessageUuid ? { uuid: streamingMessageUuid } : {}),
          });
        }
      },

      clearStreamingMessage: () => {
        // Nothing was shown and nothing is stored, so any peer preview for this reply is orphaned.
        const conversationId = get().streamingForConversationId;
        set({
          ...NO_REPLY_FORMING,
          ...(conversationId
            ? { lastReplyEnd: { conversationId, persisted: false } }
            : {}),
        });
      },

      noteReplyEndHandled: () => set(NO_REPLY_ENDED),

      setIsModelLoading: (loading: boolean) => set({ isModelLoading: loading }),
      setLoadingModelName: (name: string | null) =>
        set({ loadingModelName: name }),

      getStreamingState: () => {
        const state = get();
        return {
          conversationId: state.streamingForConversationId,
          messageId: state.streamingMessageUuid,
          content: state.streamingMessage,
          reasoningContent: state.streamingReasoningContent,
          isStreaming: state.isStreaming,
          isThinking: state.isThinking,
          isModelLoading: state.isModelLoading,
          loadingModelName: state.loadingModelName,
        };
      },

      updateCompactionState: (conversationId, summary, cutoffMessageId) => {
        set(state => ({
          conversations: state.conversations.map(conv =>
            conv.id === conversationId
              ? {
                  ...conv,
                  compactionSummary: summary,
                  compactionCutoffMessageId: cutoffMessageId,
                  updatedAt: nextUpdatedAt(conv.updatedAt),
                }
              : conv,
          ),
        }));
      },

      clearAllConversations: () => {
        const removed = get().conversations;
        set({ conversations: [], activeConversationId: null });
        for (const conversation of removed) {
          for (const message of conversation.messages) {
            if (message.uuid)
              emitSyncMutation(
                deleteSyncMutation(CORE_SYNC_ENTITIES.message, message.uuid),
              );
          }
          emitSyncMutation(
            deleteSyncMutation(
              CORE_SYNC_ENTITIES.conversation,
              conversation.id,
            ),
          );
        }
      },

      getConversationMessages: conversationId => {
        const conversation = get().conversations.find(
          c => c.id === conversationId,
        );
        return conversation?.messages || [];
      },
    }),
    {
      name: 'local-llm-chat-storage',
      storage: chatStorage.storage,
      onRehydrateStorage: () => () => chatStorage.markHydrated(),
      version: CHAT_STORAGE_VERSION,
      migrate: migratePersistedChatState,
      partialize: (state): PersistedChatState => ({
        conversations: state.conversations,
        activeConversationId: state.activeConversationId,
      }),
    },
  ),
);
