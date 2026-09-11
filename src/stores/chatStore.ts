import { create } from 'zustand';
import { stripStreamingControlTokens } from '../utils/messageContent';
import {
  type ReplyEnd,
  type StreamingSnapshot,
} from './chatStoreReplyFinalization';

export interface ChatState {
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
  setActiveConversation: (conversationId: string | null) => void;
  startStreaming: (conversationId: string, messageId: string) => void;
  setStreamingMessage: (content: string) => void;
  appendToStreamingMessage: (token: string) => void;
  appendToStreamingReasoningContent: (token: string) => void;
  /** Start the next reasoning/answer segment without ending the reply or changing its identity. */
  resetStreamingSegment: () => void;
  lastReplyEnd: ReplyEnd | null;
  noteReplyEndHandled: () => void;
  clearStreamingMessage: () => void;
  getStreamingState: () => StreamingSnapshot;
}

/** The streaming fields, named so a caller can say WHICH state it means rather than list it. */
type StreamingFields = Pick<
  ChatState,
  | 'streamingMessage'
  | 'streamingReasoningContent'
  | 'streamingForConversationId'
  | 'streamingMessageUuid'
>;

/**
 * No reply is forming. ONE definition, because that is one fact.
 *
 * It used to be written out in four places - the initial state, the start of a stream, the end of
 * one, and a cancel - so every field added to the streaming state had to be remembered in all four,
 * and whichever copy was missed would leak that field into the next reply. The type is a `Pick`, so
 * adding a streaming field is a compile error here until it is given a cleared value.
 */
const NO_REPLY_ENDED = { lastReplyEnd: null };

const NO_REPLY_FORMING: StreamingFields = {
  streamingMessage: '',
  streamingReasoningContent: '',
  streamingForConversationId: null,
  streamingMessageUuid: null,
};

export const useChatStore = create<ChatState>()((set, get) => ({
  activeConversationId: null,
  ...NO_REPLY_FORMING,
  ...NO_REPLY_ENDED,

  setActiveConversation: conversationId => {
    set({ activeConversationId: conversationId });
  },

  startStreaming: (conversationId, messageId) => {
    set({
      ...NO_REPLY_FORMING,
      streamingForConversationId: conversationId,
      streamingMessageUuid: messageId,
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
    }));
  },

  appendToStreamingReasoningContent: token => {
    set(state => ({
      streamingReasoningContent: state.streamingReasoningContent + token,
    }));
  },

  resetStreamingSegment: () => {
    set({ streamingMessage: '', streamingReasoningContent: '' });
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

  getStreamingState: () => {
    const state = get();
    const hasStream = state.streamingForConversationId !== null;
    return {
      conversationId: state.streamingForConversationId,
      messageId: state.streamingMessageUuid,
      content: state.streamingMessage,
      reasoningContent: state.streamingReasoningContent,
      isStreaming: hasStream,
      isThinking:
        hasStream &&
        !state.streamingMessage &&
        !state.streamingReasoningContent,
    };
  },
}));
