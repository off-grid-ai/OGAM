import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Message, Conversation, GenerationMeta } from '../types';
import { stripControlTokens, stripStreamingControlTokens } from '../utils/messageContent';
import { generateId } from '../utils/generateId';
import { callHook, HOOKS } from '../bootstrap/hookRegistry';

function nextUpdatedAt(previousUpdatedAt?: string): string {
  const now = Date.now();
  if (!previousUpdatedAt) return new Date(now).toISOString();
  const previousTime = Date.parse(previousUpdatedAt);
  const nextTime = Number.isNaN(previousTime) ? now : Math.max(now, previousTime + 1);
  return new Date(nextTime).toISOString();
}

/** Update a single message inside a conversation's messages array. */
function updateMessageInConv(
  conv: Conversation,
  messageId: string,
  updater: (msg: Message) => Message,
): Conversation {
  return {
    ...conv,
    messages: conv.messages.map((msg) => (msg.id === messageId ? updater(msg) : msg)),
    updatedAt: nextUpdatedAt(conv.updatedAt),
  };
}

/** Locate a fixed-string thinking block and split content into reasoning + response. */
function sliceThinkingBlock(
  content: string,
  openTag: string,
  closeTag: string,
): { reasoningContent: string | undefined; responseContent: string } | null {
  const openIdx = content.toLowerCase().indexOf(openTag.toLowerCase());
  if (openIdx === -1) return null;
  const closeIdx = content.toLowerCase().indexOf(closeTag.toLowerCase(), openIdx + openTag.length);
  if (closeIdx === -1) return null;
  const thinkStart = openIdx + openTag.length;
  return {
    reasoningContent: content.slice(thinkStart, closeIdx).trim() || undefined,
    responseContent: content.slice(closeIdx + closeTag.length),
  };
}

/** Extract channel-based thinking from raw streaming content before control tokens are stripped. */
function extractChannelThinking(rawContent: string): { reasoningContent: string | undefined; responseContent: string } {
  // Gemma 4 format: <|channel>thought\n[thinking]<channel|>[response]
  const gemma4 = sliceThinkingBlock(rawContent, '<|channel>thought\n', '<channel|>');
  if (gemma4) return gemma4;
  // Qwen channel format: <|channel|>analysis<|message|>[thinking]<|channel|>final<|message|>[response]
  const qwen = sliceThinkingBlock(rawContent, '<|channel|>analysis<|message|>', '<|channel|>final<|message|>');
  if (qwen) return qwen;
  // <think>...</think> format (Qwen 3.5, DeepSeek, etc.)
  const thinkTags = sliceThinkingBlock(rawContent, '<think>', '</think>');
  if (thinkTags) return thinkTags;

  return { reasoningContent: undefined, responseContent: rawContent };
}

/** Derive conversation title from the first user message. */
function deriveTitle(currentTitle: string, role: string, content: string): string {
  if (currentTitle !== 'New Conversation' || role !== 'user') return currentTitle;
  const truncated = content.slice(0, 50);
  return content.length > 50 ? `${truncated}...` : truncated;
}

/** Map over conversations, applying `updater` only to the one matching `conversationId`. */
function mapConversation(
  conversations: Conversation[],
  conversationId: string,
  updater: (conv: Conversation) => Conversation,
): Conversation[] {
  return conversations.map((conv) => (conv.id === conversationId ? updater(conv) : conv));
}

interface ChatState {
  conversations: Conversation[];
  activeConversationId: string | null;
  streamingMessage: string;
  streamingReasoningContent: string;
  streamingForConversationId: string | null;
  isStreaming: boolean;
  isThinking: boolean;
  createConversation: (modelId: string, title?: string, projectId?: string) => string;
  deleteConversation: (conversationId: string) => void;
  setActiveConversation: (conversationId: string | null) => void;
  getActiveConversation: () => Conversation | null;
  setConversationProject: (conversationId: string, projectId: string | null) => void;
  addMessage: (conversationId: string, message: Omit<Message, 'id' | 'timestamp'>) => Message;
  updateMessageContent: (conversationId: string, messageId: string, content: string) => void;
  updateMessageThinking: (conversationId: string, messageId: string, isThinking: boolean) => void;
  updateMessageAudio: (conversationId: string, messageId: string, audio: { audioPath?: string; waveformData?: number[]; audioDurationSeconds?: number; isGeneratingAudio?: boolean; isAudioModeMessage?: boolean }) => void;
  deleteMessage: (conversationId: string, messageId: string) => void;
  deleteMessagesAfter: (conversationId: string, messageId: string) => void;
  startStreaming: (conversationId: string) => void;
  setStreamingMessage: (content: string) => void;
  appendToStreamingMessage: (token: string) => void;
  appendToStreamingReasoningContent: (token: string) => void;
  setIsStreaming: (streaming: boolean) => void;
  setIsThinking: (thinking: boolean) => void;
  finalizeStreamingMessage: (conversationId: string, generationTimeMs?: number, generationMeta?: GenerationMeta) => void;
  clearStreamingMessage: () => void;
  getStreamingState: () => { conversationId: string | null; content: string; reasoningContent: string; isStreaming: boolean; isThinking: boolean };
  updateCompactionState: (conversationId: string, summary?: string, cutoffMessageId?: string) => void;
  clearAllConversations: () => void;
  getConversationMessages: (conversationId: string) => Message[];
}

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      conversations: [],
      activeConversationId: null,
      streamingMessage: '',
      streamingReasoningContent: '',
      streamingForConversationId: null,
      isStreaming: false,
      isThinking: false,

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

        set((state) => ({
          conversations: [conversation, ...state.conversations],
          activeConversationId: id,
        }));

        return id;
      },

      deleteConversation: (conversationId) => {
        set((state) => ({
          conversations: state.conversations.filter((c) => c.id !== conversationId),
          activeConversationId: state.activeConversationId === conversationId ? null : state.activeConversationId,
        }));
      },

      setActiveConversation: (conversationId) => {
        set({ activeConversationId: conversationId });
      },

      getActiveConversation: () => {
        const state = get();
        return state.conversations.find((c) => c.id === state.activeConversationId) || null;
      },

      setConversationProject: (conversationId, projectId) => {
        set((state) => ({
          conversations: state.conversations.map((conv) =>
            conv.id !== conversationId
              ? conv
              : { ...conv, projectId: projectId || undefined, updatedAt: nextUpdatedAt(conv.updatedAt) }
          ),
        }));
      },

      addMessage: (conversationId, messageData) => {
        const message: Message = {
          id: generateId(),
          ...messageData,
          timestamp: Date.now(),
        };

        set((state) => ({
          conversations: state.conversations.map((conv) =>
            conv.id === conversationId
              ? {
                  ...conv,
                  messages: [...conv.messages, message],
                  updatedAt: nextUpdatedAt(conv.updatedAt),
                  title: deriveTitle(conv.title, messageData.role, messageData.content),
                }
              : conv
          ),
        }));

        return message;
      },

      updateMessageContent: (conversationId, messageId, content) => {
        set((state) => ({
          conversations: mapConversation(state.conversations, conversationId, (conv) =>
            updateMessageInConv(conv, messageId, (msg) => ({ ...msg, content }))
          ),
        }));
      },

      updateMessageThinking: (conversationId, messageId, isThinking) => {
        set((state) => ({
          conversations: mapConversation(state.conversations, conversationId, (conv) =>
            updateMessageInConv(conv, messageId, (msg) => ({ ...msg, isThinking }))
          ),
        }));
      },

      updateMessageAudio: (conversationId, messageId, audio) => {
        set((state) => ({ conversations: mapConversation(state.conversations, conversationId, (conv) => updateMessageInConv(conv, messageId, (msg) => ({ ...msg, ...audio }))) }));
      },

      deleteMessage: (conversationId, messageId) => {
        set((state) => ({
          conversations: mapConversation(state.conversations, conversationId, (conv) => ({
            ...conv,
            messages: conv.messages.filter((msg) => msg.id !== messageId),
            updatedAt: nextUpdatedAt(conv.updatedAt),
          })),
        }));
      },

      deleteMessagesAfter: (conversationId, messageId) => {
        set((state) => ({
          conversations: mapConversation(state.conversations, conversationId, (conv) => {
            const messageIndex = conv.messages.findIndex((msg) => msg.id === messageId);
            if (messageIndex === -1) return conv;
            return {
              ...conv,
              messages: conv.messages.slice(0, messageIndex + 1),
              updatedAt: nextUpdatedAt(conv.updatedAt),
            };
          }),
        }));
      },

      startStreaming: (conversationId) => {
        set({
          streamingForConversationId: conversationId,
          streamingMessage: '',
          streamingReasoningContent: '',
          isStreaming: false,
          isThinking: true,
        });
      },

      setStreamingMessage: (content) => {
        set({ streamingMessage: content });
      },

      appendToStreamingMessage: (token) => {
        set((state) => ({
          streamingMessage: stripStreamingControlTokens(state.streamingMessage + token),
          isStreaming: true,
          isThinking: false,
        }));
        // Feed the growing answer to pro audio for real-time sentence-by-sentence
        // TTS (no-op unless voice mode + engine ready; free builds register nothing).
        callHook(HOOKS.audioOnStreamingToken, get().streamingMessage);
      },

      appendToStreamingReasoningContent: (token) => {
        set((state) => ({
          streamingReasoningContent: state.streamingReasoningContent + token,
          isStreaming: true,
          isThinking: false,
        }));
      },

      setIsStreaming: (streaming) => {
        set({ isStreaming: streaming, isThinking: false });
      },

      setIsThinking: (thinking) => {
        set({ isThinking: thinking });
      },

      finalizeStreamingMessage: (conversationId, generationTimeMs, generationMeta) => {
        const { streamingMessage, streamingReasoningContent, streamingForConversationId, addMessage } = get();

        let reasoningContent = streamingReasoningContent.trim() || undefined;
        let rawContent = streamingMessage;
        if (!reasoningContent) {
          const extracted = extractChannelThinking(rawContent);
          reasoningContent = extracted.reasoningContent;
          rawContent = extracted.responseContent;
        }

        const sanitizedMessage = stripControlTokens(rawContent).trim();
        if (streamingForConversationId === conversationId && (sanitizedMessage || reasoningContent)) {
          addMessage(conversationId, {
            role: 'assistant',
            content: sanitizedMessage,
            reasoningContent,
            generationTimeMs,
            generationMeta,
          });
        }
        set({
          streamingMessage: '',
          streamingReasoningContent: '',
          streamingForConversationId: null,
          isStreaming: false,
          isThinking: false,
        });
      },

      clearStreamingMessage: () => {
        set({
          streamingMessage: '',
          streamingReasoningContent: '',
          streamingForConversationId: null,
          isStreaming: false,
          isThinking: false,
        });
      },

      getStreamingState: () => {
        const state = get();
        return {
          conversationId: state.streamingForConversationId,
          content: state.streamingMessage,
          reasoningContent: state.streamingReasoningContent,
          isStreaming: state.isStreaming,
          isThinking: state.isThinking,
        };
      },

      updateCompactionState: (conversationId, summary, cutoffMessageId) => {
        set((state) => ({
          conversations: state.conversations.map((conv) =>
            conv.id === conversationId
              ? {
                  ...conv,
                  compactionSummary: summary,
                  compactionCutoffMessageId: cutoffMessageId,
                  updatedAt: nextUpdatedAt(conv.updatedAt),
                }
              : conv
          ),
        }));
      },

      clearAllConversations: () => {
        set({ conversations: [], activeConversationId: null });
      },

      getConversationMessages: (conversationId) => {
        const conversation = get().conversations.find((c) => c.id === conversationId);
        return conversation?.messages || [];
      },
    }),
    {
      name: 'local-llm-chat-storage',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        conversations: state.conversations,
        activeConversationId: state.activeConversationId,
      }),
    }
  )
);
