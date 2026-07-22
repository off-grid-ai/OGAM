/**
 * Integration Tests: ChatStore Streaming Integration
 *
 * Tests the chatStore's streaming functionality in isolation
 * and how it integrates with the generation flow.
 */

import { useChatStore } from '../../../src/stores/chatStore';
import {
  resetStores,
  getChatState,
  setupWithConversation,
} from '../../utils/testHelpers';
import { createGenerationMeta } from '../../utils/factories';

describe('ChatStore Streaming Integration', () => {
  beforeEach(() => {
    resetStores();
  });

  describe('Streaming Message Lifecycle', () => {
    it('should initialize streaming state correctly', () => {
      const conversationId = setupWithConversation();

      useChatStore.getState().startStreaming(conversationId);

      const state = getChatState();
      expect(state.streamingForConversationId).toBe(conversationId);
      expect(state.streamingMessage).toBe('');
      expect(state.isStreaming).toBe(false);
      expect(state.isThinking).toBe(true);
    });

    it('should transition from thinking to streaming on first token', () => {
      const conversationId = setupWithConversation();
      const chatStore = useChatStore.getState();

      chatStore.startStreaming(conversationId);
      expect(getChatState().isThinking).toBe(true);
      expect(getChatState().isStreaming).toBe(false);

      chatStore.appendToStreamingMessage('First');
      expect(getChatState().isThinking).toBe(false);
      expect(getChatState().isStreaming).toBe(true);
    });

    it('should accumulate tokens in streaming message', () => {
      const conversationId = setupWithConversation();
      const chatStore = useChatStore.getState();

      chatStore.startStreaming(conversationId);
      chatStore.appendToStreamingMessage('Hello');
      chatStore.appendToStreamingMessage(' ');
      chatStore.appendToStreamingMessage('world');

      expect(getChatState().streamingMessage).toBe('Hello world');
    });

    it('should strip control tokens from streaming message', () => {
      const conversationId = setupWithConversation();
      const chatStore = useChatStore.getState();

      chatStore.startStreaming(conversationId);
      chatStore.appendToStreamingMessage('Hello<|im_end|>');
      chatStore.appendToStreamingMessage(' there');

      // Control token should be stripped
      expect(getChatState().streamingMessage).not.toContain('<|im_end|>');
    });

    it('should finalize streaming message as assistant message', () => {
      const conversationId = setupWithConversation();
      const chatStore = useChatStore.getState();

      chatStore.startStreaming(conversationId);
      chatStore.appendToStreamingMessage('Complete response');
      chatStore.finalizeStreamingMessage(conversationId, 1500);

      const state = getChatState();

      // Streaming state should be cleared
      expect(state.streamingMessage).toBe('');
      expect(state.streamingForConversationId).toBeNull();
      expect(state.isStreaming).toBe(false);

      // Message should be added to conversation
      const conversation = state.conversations.find(c => c.id === conversationId);
      expect(conversation?.messages).toHaveLength(1);
      expect(conversation?.messages[0].role).toBe('assistant');
      expect(conversation?.messages[0].content).toBe('Complete response');
      expect(conversation?.messages[0].generationTimeMs).toBe(1500);
    });

    it('should include generation metadata when finalizing', () => {
      const conversationId = setupWithConversation();
      const chatStore = useChatStore.getState();
      const meta = createGenerationMeta({
        gpu: true,
        gpuBackend: 'Metal',
        tokensPerSecond: 25.5,
      });

      chatStore.startStreaming(conversationId);
      chatStore.appendToStreamingMessage('Response with meta');
      chatStore.finalizeStreamingMessage(conversationId, 2000, meta);

      const state = getChatState();
      const conversation = state.conversations.find(c => c.id === conversationId);
      const message = conversation?.messages[0];

      expect(message?.generationMeta).toBeDefined();
      expect(message?.generationMeta?.gpu).toBe(true);
      expect(message?.generationMeta?.gpuBackend).toBe('Metal');
      expect(message?.generationMeta?.tokensPerSecond).toBe(25.5);
    });

    it('should not finalize empty streaming message', () => {
      const conversationId = setupWithConversation();
      const chatStore = useChatStore.getState();

      chatStore.startStreaming(conversationId);
      // Don't append any content
      chatStore.finalizeStreamingMessage(conversationId, 1000);

      const state = getChatState();
      const conversation = state.conversations.find(c => c.id === conversationId);
      expect(conversation?.messages).toHaveLength(0);
    });

    it('should not finalize for wrong conversation', () => {
      const conversationId = setupWithConversation();
      const chatStore = useChatStore.getState();

      chatStore.startStreaming(conversationId);
      chatStore.appendToStreamingMessage('Content');

      // Try to finalize for different conversation
      chatStore.finalizeStreamingMessage('wrong-conversation-id', 1000);

      const state = getChatState();

      // Message should NOT be added because conversation doesn't match
      const conversation = state.conversations.find(c => c.id === conversationId);
      expect(conversation?.messages).toHaveLength(0);

      // Streaming state IS cleared - this is intentional.
      // finalize() always ends the streaming session, regardless of whether
      // the message was saved. The caller is signaling "streaming is done"
      // and the state should reset to allow new generations.
      expect(state.streamingMessage).toBe('');
    });

    it('should clear streaming message without creating message', () => {
      const conversationId = setupWithConversation();
      const chatStore = useChatStore.getState();

      chatStore.startStreaming(conversationId);
      chatStore.appendToStreamingMessage('Partial content');
      chatStore.clearStreamingMessage();

      const state = getChatState();

      // Everything should be cleared
      expect(state.streamingMessage).toBe('');
      expect(state.streamingForConversationId).toBeNull();
      expect(state.isStreaming).toBe(false);
      expect(state.isThinking).toBe(false);

      // No message should be added
      const conversation = state.conversations.find(c => c.id === conversationId);
      expect(conversation?.messages).toHaveLength(0);
    });
  });

  describe('getStreamingState', () => {
    it('should return current streaming state', () => {
      const conversationId = setupWithConversation();
      const chatStore = useChatStore.getState();

      chatStore.startStreaming(conversationId);
      chatStore.appendToStreamingMessage('Test content');

      const streamingState = chatStore.getStreamingState();

      expect(streamingState.conversationId).toBe(conversationId);
      expect(streamingState.content).toBe('Test content');
      expect(streamingState.isStreaming).toBe(true);
      expect(streamingState.isThinking).toBe(false);
    });

    it('should return idle state when not streaming', () => {
      const streamingState = useChatStore.getState().getStreamingState();

      expect(streamingState.conversationId).toBeNull();
      expect(streamingState.content).toBe('');
      expect(streamingState.isStreaming).toBe(false);
      expect(streamingState.isThinking).toBe(false);
    });
  });

  describe('Conversation Navigation During Streaming', () => {
    it('should preserve streaming state when switching conversations', () => {
      const conv1 = setupWithConversation();
      const chatStore = useChatStore.getState();

      // Create second conversation
      const conv2 = chatStore.createConversation('model-id', 'Second Conv');

      // Start streaming in first conversation
      chatStore.setActiveConversation(conv1);
      chatStore.startStreaming(conv1);
      chatStore.appendToStreamingMessage('Streaming in conv1');

      // Switch to second conversation
      chatStore.setActiveConversation(conv2);

      // Streaming state should be preserved
      const state = getChatState();
      expect(state.streamingForConversationId).toBe(conv1);
      expect(state.streamingMessage).toBe('Streaming in conv1');
      expect(state.activeConversationId).toBe(conv2);
    });

    it('should still finalize message correctly after navigation', () => {
      const conv1 = setupWithConversation();
      const chatStore = useChatStore.getState();

      // Create second conversation and switch to it
      const conv2 = chatStore.createConversation('model-id', 'Second Conv');

      // Start streaming in first conversation
      chatStore.setActiveConversation(conv1);
      chatStore.startStreaming(conv1);
      chatStore.appendToStreamingMessage('Complete response');

      // Switch away
      chatStore.setActiveConversation(conv2);

      // Finalize the streaming message for conv1
      chatStore.finalizeStreamingMessage(conv1, 1500);

      // Message should be added to conv1
      const state = getChatState();
      const conversation1 = state.conversations.find(c => c.id === conv1);
      expect(conversation1?.messages).toHaveLength(1);
      expect(conversation1?.messages[0].content).toBe('Complete response');

      // conv2 should have no messages
      const conversation2 = state.conversations.find(c => c.id === conv2);
      expect(conversation2?.messages).toHaveLength(0);
    });
  });

  describe('setIsStreaming and setIsThinking', () => {
    it('should set streaming state directly', () => {
      const conversationId = setupWithConversation();
      const chatStore = useChatStore.getState();

      chatStore.startStreaming(conversationId);
      expect(getChatState().isStreaming).toBe(false);

      chatStore.setIsStreaming(true);
      expect(getChatState().isStreaming).toBe(true);
      expect(getChatState().isThinking).toBe(false);
    });

    it('should set thinking state directly', () => {
      const conversationId = setupWithConversation();
      const chatStore = useChatStore.getState();

      chatStore.startStreaming(conversationId);
      expect(getChatState().isThinking).toBe(true);

      chatStore.setIsThinking(false);
      expect(getChatState().isThinking).toBe(false);
    });
  });

  describe('Message Operations During Streaming', () => {
    it('should allow adding user message while streaming', () => {
      const conversationId = setupWithConversation();
      const chatStore = useChatStore.getState();

      chatStore.startStreaming(conversationId);
      chatStore.appendToStreamingMessage('Streaming...');

      // Add a user message (shouldn't happen in normal flow, but test it)
      chatStore.addMessage(conversationId, {
        role: 'user',
        content: 'User interruption',
      });

      const state = getChatState();
      const conversation = state.conversations.find(c => c.id === conversationId);
      expect(conversation?.messages).toHaveLength(1);
      expect(conversation?.messages[0].content).toBe('User interruption');

      // Streaming state should be unaffected
      expect(state.streamingMessage).toBe('Streaming...');
    });
  });

  describe('Edge Cases', () => {
    it('should handle rapid streaming calls', async () => {
      const conversationId = setupWithConversation();
      const chatStore = useChatStore.getState();

      chatStore.startStreaming(conversationId);

      // Rapid fire tokens
      const tokens = Array.from({ length: 100 }, (_, i) => `token${i} `);
      for (const token of tokens) {
        chatStore.appendToStreamingMessage(token);
      }

      const state = getChatState();
      expect(state.streamingMessage).toContain('token0');
      expect(state.streamingMessage).toContain('token99');
    });

    it('should handle empty token', () => {
      const conversationId = setupWithConversation();
      const chatStore = useChatStore.getState();

      chatStore.startStreaming(conversationId);
      chatStore.appendToStreamingMessage('Hello');
      chatStore.appendToStreamingMessage('');
      chatStore.appendToStreamingMessage(' world');

      expect(getChatState().streamingMessage).toBe('Hello world');
    });

    it('should handle whitespace-only content on finalize', () => {
      const conversationId = setupWithConversation();
      const chatStore = useChatStore.getState();

      chatStore.startStreaming(conversationId);
      chatStore.appendToStreamingMessage('   ');
      chatStore.appendToStreamingMessage('\n\n');
      chatStore.finalizeStreamingMessage(conversationId, 1000);

      // Whitespace-only should not create a message (trim() leaves empty string)
      const state = getChatState();
      const conversation = state.conversations.find(c => c.id === conversationId);
      expect(conversation?.messages).toHaveLength(0);
    });

    it('should create conversation and preserve streaming state', () => {
      const conversationId = setupWithConversation();
      const chatStore = useChatStore.getState();

      // Start streaming
      chatStore.startStreaming(conversationId);
      chatStore.appendToStreamingMessage('Content');

      // Create new conversation (streaming state preserved — scoped by streamingForConversationId)
      const newConvId = chatStore.createConversation('model-id', 'New Conv');

      const state = getChatState();
      expect(state.activeConversationId).toBe(newConvId);
      // Streaming state is preserved — UI uses streamingForConversationId to scope display
      expect(state.streamingMessage).toBe('Content');
      expect(state.isStreaming).toBe(true);
    });
  });
});
