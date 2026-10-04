import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { Message, Conversation } from '../types';
import { stripStreamingControlTokens } from '../utils/messageContent';
import { generateId } from '../utils/generateId';
import {
  type ReplyEnd,
  type StreamingSnapshot,
} from './chatStoreReplyFinalization';
import {
  CHAT_STORAGE_VERSION,
  chatPersistStorage,
  migratePersistedChatState,
} from './chatPersistence';

export interface ChatState {
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
  setActiveConversation: (conversationId: string | null) => void;
  getActiveConversation: () => Conversation | null;
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
  clearStreamingMessage: () => void;
  getStreamingState: () => StreamingSnapshot;
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

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      conversations: [],
      activeConversationId: null,
      ...NO_REPLY_FORMING,
      ...MODEL_NOT_LOADING,
      ...NO_REPLY_ENDED,

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

      getConversationMessages: conversationId => {
        const conversation = get().conversations.find(
          c => c.id === conversationId,
        );
        return conversation?.messages || [];
      },
    }),
    {
      name: 'local-llm-chat-storage',
      storage: chatPersistStorage,
      version: CHAT_STORAGE_VERSION,
      migrate: migratePersistedChatState,
      partialize: state => ({
        conversations: state.conversations,
        activeConversationId: state.activeConversationId,
      }),
    },
  ),
);
