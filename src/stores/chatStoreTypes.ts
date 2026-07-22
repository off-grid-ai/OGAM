import type { Conversation, GenerationMeta, Message } from '../types';

export interface ChatState {
  conversations: Conversation[];
  activeConversationId: string | null;
  streamingMessage: string;
  streamingReasoningContent: string;
  streamingForConversationId: string | null;
  isStreaming: boolean;
  isThinking: boolean;
  createConversation: (
    modelId: string,
    title?: string,
    projectId?: string,
  ) => string;
  renameConversation: (conversationId: string, title: string) => void;
  deleteConversation: (conversationId: string) => void;
  setActiveConversation: (conversationId: string | null) => void;
  getActiveConversation: () => Conversation | null;
  setConversationProject: (
    conversationId: string,
    projectId: string | null,
  ) => void;
  unfileConversationsForProject: (projectId: string) => void;
  addMessage: (
    conversationId: string,
    message: Omit<Message, 'id' | 'timestamp'>,
  ) => Message;
  updateMessageContent: (
    conversationId: string,
    messageId: string,
    content: string,
  ) => void;
  updateMessageThinking: (
    conversationId: string,
    messageId: string,
    isThinking: boolean,
  ) => void;
  updateMessageAudio: (
    conversationId: string,
    messageId: string,
    audio: {
      audioPath?: string;
      waveformData?: number[];
      audioDurationSeconds?: number;
      isGeneratingAudio?: boolean;
      isAudioModeMessage?: boolean;
    },
  ) => void;
  deleteMessage: (conversationId: string, messageId: string) => void;
  deleteMessagesAfter: (conversationId: string, messageId: string) => void;
  startStreaming: (conversationId: string) => void;
  setStreamingMessage: (content: string) => void;
  resetStreamingOutput: () => void;
  appendToStreamingMessage: (token: string) => void;
  appendToStreamingReasoningContent: (token: string) => void;
  setIsStreaming: (streaming: boolean) => void;
  setIsThinking: (thinking: boolean) => void;
  finalizeStreamingMessage: (
    conversationId: string,
    generationTimeMs?: number,
    generationMeta?: GenerationMeta,
  ) => void;
  clearStreamingMessage: () => void;
  getStreamingState: () => {
    conversationId: string | null;
    content: string;
    reasoningContent: string;
    isStreaming: boolean;
    isThinking: boolean;
  };
  updateCompactionState: (
    conversationId: string,
    summary?: string,
    cutoffMessageId?: string,
  ) => void;
  clearAllConversations: () => void;
  getConversationMessages: (conversationId: string) => Message[];
}
