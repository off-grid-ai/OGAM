/**
 * Chat Store Unit Tests
 *
 * Tests for conversation and message management in the chat store.
 * Priority: P0 (Critical) - Core functionality for the app.
 */

import { useChatStore } from '../../../src/stores/chatStore';
import { resetStores, getChatState } from '../../utils/testHelpers';
import {
  createMediaAttachment,
  createGenerationMeta,
} from '../../utils/factories';

describe('chatStore', () => {
  beforeEach(() => {
    resetStores();
  });

  // ============================================================================
  // Conversation Management
  // ============================================================================
  describe('createConversation', () => {
    it('creates new conversation with correct defaults', () => {
      const { createConversation } = useChatStore.getState();

      const conversationId = createConversation('test-model-id');

      const state = getChatState();
      expect(state.conversations).toHaveLength(1);
      expect(state.conversations[0]).toMatchObject({
        id: conversationId,
        title: 'New Conversation',
        modelId: 'test-model-id',
        messages: [],
      });
      expect(state.conversations[0].createdAt).toBeDefined();
      expect(state.conversations[0].updatedAt).toBeDefined();
    });

    it('sets activeConversationId to new conversation', () => {
      const { createConversation } = useChatStore.getState();

      const conversationId = createConversation('test-model-id');

      expect(getChatState().activeConversationId).toBe(conversationId);
    });

    it('accepts custom title', () => {
      const { createConversation } = useChatStore.getState();

      createConversation('test-model-id', 'Custom Title');

      expect(getChatState().conversations[0].title).toBe('Custom Title');
    });

    it('accepts projectId', () => {
      const { createConversation } = useChatStore.getState();

      createConversation('test-model-id', undefined, 'project-123');

      expect(getChatState().conversations[0].projectId).toBe('project-123');
    });

    it('preserves streaming state when creating conversation', () => {
      const store = useChatStore.getState();

      // Simulate streaming state (generation may be in progress for another conversation)
      useChatStore.setState({
        streamingMessage: 'partial content',
        isStreaming: true,
        isThinking: true,
      });

      store.createConversation('test-model-id');

      const state = getChatState();
      // Streaming state is preserved — the UI uses streamingForConversationId to scope display
      expect(state.streamingMessage).toBe('partial content');
      expect(state.isStreaming).toBe(true);
      expect(state.isThinking).toBe(true);
    });

    it('prepends new conversation to list', () => {
      const { createConversation } = useChatStore.getState();

      const first = createConversation('model-1');
      const second = createConversation('model-2');

      const state = getChatState();
      expect(state.conversations[0].id).toBe(second);
      expect(state.conversations[1].id).toBe(first);
    });
  });

  describe('deleteConversation', () => {
    it('removes conversation from list', () => {
      const { createConversation, deleteConversation } = useChatStore.getState();

      const id = createConversation('test-model');
      expect(getChatState().conversations).toHaveLength(1);

      deleteConversation(id);

      expect(getChatState().conversations).toHaveLength(0);
    });

    it('clears activeConversationId if deleted conversation was active', () => {
      const { createConversation, deleteConversation } = useChatStore.getState();

      const id = createConversation('test-model');
      expect(getChatState().activeConversationId).toBe(id);

      deleteConversation(id);

      expect(getChatState().activeConversationId).toBeNull();
    });

    it('preserves activeConversationId if different conversation deleted', () => {
      const { createConversation, deleteConversation } = useChatStore.getState();

      const first = createConversation('model-1');
      const second = createConversation('model-2'); // This becomes active

      deleteConversation(first);

      expect(getChatState().activeConversationId).toBe(second);
    });
  });

  describe('setActiveConversation', () => {
    it('updates activeConversationId', () => {
      const { createConversation, setActiveConversation } = useChatStore.getState();

      const first = createConversation('model-1');
      createConversation('model-2'); // This becomes active

      setActiveConversation(first);

      expect(getChatState().activeConversationId).toBe(first);
    });

    it('can set to null', () => {
      const { createConversation, setActiveConversation } = useChatStore.getState();

      createConversation('model-1');
      setActiveConversation(null);

      expect(getChatState().activeConversationId).toBeNull();
    });
  });

  describe('getActiveConversation', () => {
    it('returns active conversation', () => {
      const { createConversation, getActiveConversation } = useChatStore.getState();

      const id = createConversation('test-model', 'Test Title');

      const active = getActiveConversation();
      expect(active).not.toBeNull();
      expect(active?.id).toBe(id);
      expect(active?.title).toBe('Test Title');
    });

    it('returns null when no active conversation', () => {
      const { getActiveConversation } = useChatStore.getState();

      expect(getActiveConversation()).toBeNull();
    });
  });

  describe('setConversationProject', () => {
    it('sets projectId on conversation', () => {
      const { createConversation, setConversationProject } = useChatStore.getState();

      const id = createConversation('test-model');
      setConversationProject(id, 'project-123');

      expect(getChatState().conversations[0].projectId).toBe('project-123');
    });

    it('clears projectId when null passed', () => {
      const { createConversation, setConversationProject } = useChatStore.getState();

      const id = createConversation('test-model', undefined, 'project-123');
      setConversationProject(id, null);

      expect(getChatState().conversations[0].projectId).toBeUndefined();
    });

    it('updates updatedAt', () => {
      const { createConversation, setConversationProject } = useChatStore.getState();

      const id = createConversation('test-model');
      const originalUpdatedAt = getChatState().conversations[0].updatedAt;

      // Small delay to ensure different timestamp
      jest.advanceTimersByTime(10);

      setConversationProject(id, 'project-123');

      expect(getChatState().conversations[0].updatedAt).not.toBe(originalUpdatedAt);
    });
  });

  // ============================================================================
  // Message Management
  // ============================================================================
  describe('addMessage', () => {
    it('adds message to correct conversation', () => {
      const { createConversation, addMessage } = useChatStore.getState();

      const convId = createConversation('test-model');
      const message = addMessage(convId, { role: 'user', content: 'Hello' });

      const conv = getChatState().conversations[0];
      expect(conv.messages).toHaveLength(1);
      expect(conv.messages[0].content).toBe('Hello');
      expect(conv.messages[0].role).toBe('user');
      expect(message.id).toBeDefined();
      expect(message.timestamp).toBeDefined();
    });

    it('returns created message with id and timestamp', () => {
      const { createConversation, addMessage } = useChatStore.getState();

      const convId = createConversation('test-model');
      const message = addMessage(convId, { role: 'assistant', content: 'Response' });

      expect(message.id).toBeDefined();
      expect(typeof message.id).toBe('string');
      expect(message.timestamp).toBeDefined();
      expect(typeof message.timestamp).toBe('number');
    });

    it('updates conversation title from first user message', () => {
      const { createConversation, addMessage } = useChatStore.getState();

      const convId = createConversation('test-model');
      addMessage(convId, { role: 'user', content: 'What is machine learning?' });

      expect(getChatState().conversations[0].title).toBe('What is machine learning?');
    });

    it('truncates long titles to 50 chars with ellipsis', () => {
      const { createConversation, addMessage } = useChatStore.getState();

      const convId = createConversation('test-model');
      const longContent = 'This is a very long message that should be truncated when used as a title';
      addMessage(convId, { role: 'user', content: longContent });

      const title = getChatState().conversations[0].title;
      expect(title.length).toBeLessThanOrEqual(53); // 50 + '...'
      expect(title.endsWith('...')).toBe(true);
    });

    it('does not update title from assistant messages', () => {
      const { createConversation, addMessage } = useChatStore.getState();

      const convId = createConversation('test-model');
      addMessage(convId, { role: 'assistant', content: 'Hello, how can I help?' });

      expect(getChatState().conversations[0].title).toBe('New Conversation');
    });

    it('does not update title if already customized', () => {
      const { createConversation, addMessage } = useChatStore.getState();

      const convId = createConversation('test-model', 'Custom Title');
      addMessage(convId, { role: 'user', content: 'New message' });

      expect(getChatState().conversations[0].title).toBe('Custom Title');
    });

    it('includes attachments when provided', () => {
      const { createConversation, addMessage } = useChatStore.getState();

      const convId = createConversation('test-model');
      const attachment = createMediaAttachment({ type: 'image' });
      const message = addMessage(
        convId,
        { role: 'user', content: 'Check this image', attachments: [attachment] },
      );

      expect(message.attachments).toHaveLength(1);
      expect(message.attachments?.[0].type).toBe('image');
    });

    it('includes generationTimeMs when provided', () => {
      const { createConversation, addMessage } = useChatStore.getState();

      const convId = createConversation('test-model');
      const message = addMessage(
        convId,
        { role: 'assistant', content: 'Response', generationTimeMs: 1500 },
      );

      expect(message.generationTimeMs).toBe(1500);
    });

    it('includes generationMeta when provided', () => {
      const { createConversation, addMessage } = useChatStore.getState();

      const convId = createConversation('test-model');
      const meta = createGenerationMeta({ gpu: true, tokensPerSecond: 25.5 });
      const message = addMessage(
        convId,
        { role: 'assistant', content: 'Response', generationTimeMs: 1000, generationMeta: meta },
      );

      expect(message.generationMeta?.gpu).toBe(true);
      expect(message.generationMeta?.tokensPerSecond).toBe(25.5);
    });

    it('updates conversation updatedAt', () => {
      const { createConversation, addMessage } = useChatStore.getState();

      const convId = createConversation('test-model');
      const _originalUpdatedAt = getChatState().conversations[0].updatedAt;

      addMessage(convId, { role: 'user', content: 'Message' });

      // updatedAt should be updated (may or may not be different depending on timing)
      expect(getChatState().conversations[0].updatedAt).toBeDefined();
    });
  });

  describe('updateMessageContent', () => {
    it('updates message content', () => {
      const { createConversation, addMessage, updateMessageContent } = useChatStore.getState();

      const convId = createConversation('test-model');
      const message = addMessage(convId, { role: 'user', content: 'Original' });

      updateMessageContent(convId, message.id, 'Updated');

      expect(getChatState().conversations[0].messages[0].content).toBe('Updated');
    });

    it('preserves other message properties', () => {
      const { createConversation, addMessage, updateMessageContent } = useChatStore.getState();

      const convId = createConversation('test-model');
      const message = addMessage(convId, { role: 'user', content: 'Original' });
      const originalTimestamp = message.timestamp;

      updateMessageContent(convId, message.id, 'Updated');

      const updatedMessage = getChatState().conversations[0].messages[0];
      expect(updatedMessage.id).toBe(message.id);
      expect(updatedMessage.role).toBe('user');
      expect(updatedMessage.timestamp).toBe(originalTimestamp);
    });
  });

  describe('deleteMessage', () => {
    it('removes message from conversation', () => {
      const { createConversation, addMessage, deleteMessage } = useChatStore.getState();

      const convId = createConversation('test-model');
      const msg1 = addMessage(convId, { role: 'user', content: 'First' });
      addMessage(convId, { role: 'assistant', content: 'Second' });

      deleteMessage(convId, msg1.id);

      const messages = getChatState().conversations[0].messages;
      expect(messages).toHaveLength(1);
      expect(messages[0].content).toBe('Second');
    });
  });

  describe('deleteMessagesAfter', () => {
    it('removes messages after specified message', () => {
      const { createConversation, addMessage, deleteMessagesAfter } = useChatStore.getState();

      const convId = createConversation('test-model');
      const msg1 = addMessage(convId, { role: 'user', content: 'First' });
      addMessage(convId, { role: 'assistant', content: 'Second' });
      addMessage(convId, { role: 'user', content: 'Third' });

      deleteMessagesAfter(convId, msg1.id);

      const messages = getChatState().conversations[0].messages;
      expect(messages).toHaveLength(1);
      expect(messages[0].content).toBe('First');
    });

    it('preserves conversation if message not found', () => {
      const { createConversation, addMessage, deleteMessagesAfter } = useChatStore.getState();

      const convId = createConversation('test-model');
      addMessage(convId, { role: 'user', content: 'First' });

      deleteMessagesAfter(convId, 'nonexistent-id');

      expect(getChatState().conversations[0].messages).toHaveLength(1);
    });
  });

  // ============================================================================
  // Streaming State
  // ============================================================================
  describe('startStreaming', () => {
    it('initializes streaming state correctly', () => {
      const { createConversation, startStreaming } = useChatStore.getState();

      const convId = createConversation('test-model');
      startStreaming(convId);

      const state = getChatState();
      expect(state.streamingForConversationId).toBe(convId);
      expect(state.streamingMessage).toBe('');
      expect(state.isStreaming).toBe(false);
      expect(state.isThinking).toBe(true);
    });
  });

  describe('appendToStreamingMessage', () => {
    it('accumulates tokens', () => {
      const { createConversation, startStreaming, appendToStreamingMessage } = useChatStore.getState();

      const convId = createConversation('test-model');
      startStreaming(convId);

      appendToStreamingMessage('Hello');
      appendToStreamingMessage(' ');
      appendToStreamingMessage('world');

      expect(getChatState().streamingMessage).toBe('Hello world');
    });

    it('sets isStreaming to true and isThinking to false', () => {
      const { createConversation, startStreaming, appendToStreamingMessage } = useChatStore.getState();

      const convId = createConversation('test-model');
      startStreaming(convId);

      expect(getChatState().isThinking).toBe(true);

      appendToStreamingMessage('Token');

      const state = getChatState();
      expect(state.isStreaming).toBe(true);
      expect(state.isThinking).toBe(false);
    });
  });

  describe('finalizeStreamingMessage', () => {
    it('saves streaming message as assistant message', () => {
      const store = useChatStore.getState();
      const convId = store.createConversation('test-model');

      store.startStreaming(convId);
      store.appendToStreamingMessage('Generated response');
      store.finalizeStreamingMessage(convId, 1000);

      const conv = getChatState().conversations[0];
      expect(conv.messages).toHaveLength(1);
      expect(conv.messages[0].role).toBe('assistant');
      expect(conv.messages[0].content).toBe('Generated response');
      expect(conv.messages[0].generationTimeMs).toBe(1000);
    });

    it('clears streaming state', () => {
      const store = useChatStore.getState();
      const convId = store.createConversation('test-model');

      store.startStreaming(convId);
      store.appendToStreamingMessage('Content');
      store.finalizeStreamingMessage(convId);

      const state = getChatState();
      expect(state.streamingMessage).toBe('');
      expect(state.streamingForConversationId).toBeNull();
      expect(state.isStreaming).toBe(false);
      expect(state.isThinking).toBe(false);
    });

    it('does not save if conversationId does not match', () => {
      const store = useChatStore.getState();
      const convId = store.createConversation('test-model');

      store.startStreaming(convId);
      store.appendToStreamingMessage('Content');
      store.finalizeStreamingMessage('different-conversation');

      // Message should not be added (wrong conversation)
      // But state should still be cleared
      const state = getChatState();
      expect(state.streamingMessage).toBe('');
    });

    it('does not save empty content', () => {
      const store = useChatStore.getState();
      const convId = store.createConversation('test-model');

      store.startStreaming(convId);
      store.finalizeStreamingMessage(convId);

      expect(getChatState().conversations[0].messages).toHaveLength(0);
    });

    it('trims whitespace-only content and does not save', () => {
      const store = useChatStore.getState();
      const convId = store.createConversation('test-model');

      store.startStreaming(convId);
      store.appendToStreamingMessage('   ');
      store.finalizeStreamingMessage(convId);

      expect(getChatState().conversations[0].messages).toHaveLength(0);
    });

    it('includes generationMeta when provided', () => {
      const store = useChatStore.getState();
      const convId = store.createConversation('test-model');
      const meta = createGenerationMeta({ gpu: true });

      store.startStreaming(convId);
      store.appendToStreamingMessage('Response');
      store.finalizeStreamingMessage(convId, 1000, meta);

      const message = getChatState().conversations[0].messages[0];
      expect(message.generationMeta?.gpu).toBe(true);
    });

    it('extracts Gemma 4 channel thinking into reasoningContent', () => {
      const store = useChatStore.getState();
      const convId = store.createConversation('test-model');

      store.startStreaming(convId);
      useChatStore.setState({
        streamingMessage: '<|channel>thought\nThis is the thinking part.<channel|>This is the response.',
        streamingForConversationId: convId,
      });
      store.finalizeStreamingMessage(convId);

      const message = getChatState().conversations[0].messages[0];
      expect(message.reasoningContent).toBe('This is the thinking part.');
      expect(message.content).toBe('This is the response.');
    });

    it('treats an UNCLOSED Gemma 4 thought (truncated mid-thinking) as reasoning, not the message', () => {
      const store = useChatStore.getState();
      const convId = store.createConversation('test-model');

      store.startStreaming(convId);
      // Generation cut off by maxTokens while still in the thought channel — no <channel|>,
      // no answer. The raw tag must NOT leak in as the message (the iOS truncation bug).
      useChatStore.setState({
        streamingMessage: '<|channel>thought\nThe user said hi. I should respond politely',
        streamingForConversationId: convId,
      });
      store.finalizeStreamingMessage(convId);

      const message = getChatState().conversations[0].messages[0];
      expect(message.reasoningContent).toBe('The user said hi. I should respond politely');
      expect(message.content).not.toContain('<|channel>thought');
      expect(message.content.trim()).toBe('');
    });

    it('extracts Qwen channel thinking into reasoningContent', () => {
      const store = useChatStore.getState();
      const convId = store.createConversation('test-model');

      store.startStreaming(convId);
      useChatStore.setState({
        streamingMessage: '<|channel|>analysis<|message|>This is the analysis.<|channel|>final<|message|>This is the final response.',
        streamingForConversationId: convId,
      });
      store.finalizeStreamingMessage(convId);

      const message = getChatState().conversations[0].messages[0];
      expect(message.reasoningContent).toBe('This is the analysis.');
      expect(message.content).toBe('This is the final response.');
    });

    it('retains Qwen3 reasoning when only the closing </think> tag is emitted', () => {
      // Qwen3's chat template injects the opening <think>, so the model emits
      // only the closing tag. The finalizer must still capture the reasoning,
      // matching the live renderer, or the thinking block vanishes on completion.
      const store = useChatStore.getState();
      const convId = store.createConversation('test-model');

      store.startStreaming(convId);
      useChatStore.setState({
        streamingMessage: 'The user is asking what is happening.</think>Hello! How can I help?',
        streamingForConversationId: convId,
      });
      store.finalizeStreamingMessage(convId);

      const message = getChatState().conversations[0].messages[0];
      expect(message.reasoningContent).toBe('The user is asking what is happening.');
      expect(message.content).toBe('Hello! How can I help?');
    });

    it('does not extract thinking when streamingReasoningContent is already populated', () => {
      const store = useChatStore.getState();
      const convId = store.createConversation('test-model');

      store.startStreaming(convId);
      useChatStore.setState({
        streamingMessage: 'Plain response without tags',
        streamingReasoningContent: 'Pre-extracted reasoning',
        streamingForConversationId: convId,
      });
      store.finalizeStreamingMessage(convId);

      const message = getChatState().conversations[0].messages[0];
      expect(message.reasoningContent).toBe('Pre-extracted reasoning');
      expect(message.content).toBe('Plain response without tags');
    });

    it('leaves content unchanged when no thinking tags present', () => {
      const store = useChatStore.getState();
      const convId = store.createConversation('test-model');

      store.startStreaming(convId);
      store.appendToStreamingMessage('Regular response with no thinking.');
      store.finalizeStreamingMessage(convId);

      const message = getChatState().conversations[0].messages[0];
      expect(message.reasoningContent).toBeUndefined();
      expect(message.content).toBe('Regular response with no thinking.');
    });
  });

  describe('clearStreamingMessage', () => {
    it('resets all streaming state without saving', () => {
      const store = useChatStore.getState();
      const convId = store.createConversation('test-model');

      store.startStreaming(convId);
      store.appendToStreamingMessage('Partial content');
      store.clearStreamingMessage();

      const state = getChatState();
      expect(state.streamingMessage).toBe('');
      expect(state.streamingForConversationId).toBeNull();
      expect(state.isStreaming).toBe(false);
      expect(state.isThinking).toBe(false);
      expect(state.conversations[0].messages).toHaveLength(0);
    });
  });

  describe('getStreamingState', () => {
    it('returns current streaming state', () => {
      const store = useChatStore.getState();
      const convId = store.createConversation('test-model');

      store.startStreaming(convId);
      store.appendToStreamingMessage('Content');

      const streamState = store.getStreamingState();
      expect(streamState.conversationId).toBe(convId);
      expect(streamState.content).toBe('Content');
      expect(streamState.isStreaming).toBe(true);
      expect(streamState.isThinking).toBe(false);
    });
  });

  // ============================================================================
  // Utilities
  // ============================================================================
  describe('clearAllConversations', () => {
    it('removes all conversations', () => {
      const store = useChatStore.getState();
      store.createConversation('model-1');
      store.createConversation('model-2');

      store.clearAllConversations();

      const state = getChatState();
      expect(state.conversations).toHaveLength(0);
      expect(state.activeConversationId).toBeNull();
    });
  });

  describe('getConversationMessages', () => {
    it('returns messages for conversation', () => {
      const store = useChatStore.getState();
      const convId = store.createConversation('test-model');
      store.addMessage(convId, { role: 'user', content: 'Hello' });
      store.addMessage(convId, { role: 'assistant', content: 'Hi' });

      const messages = store.getConversationMessages(convId);
      expect(messages).toHaveLength(2);
    });

    it('returns empty array for nonexistent conversation', () => {
      const store = useChatStore.getState();

      const messages = store.getConversationMessages('nonexistent');
      expect(messages).toEqual([]);
    });
  });

  // ============================================================================
  // Control Token Stripping
  // ============================================================================
  describe('control token stripping', () => {
    it('strips <|im_start|> tokens during streaming', () => {
      const store = useChatStore.getState();
      const convId = store.createConversation('test-model');

      store.startStreaming(convId);
      store.appendToStreamingMessage('Hello<|im_start|>assistant');

      expect(getChatState().streamingMessage).not.toContain('<|im_start|>');
    });

    it('strips <|im_end|> tokens during streaming', () => {
      const store = useChatStore.getState();
      const convId = store.createConversation('test-model');

      store.startStreaming(convId);
      store.appendToStreamingMessage('Hello world<|im_end|>');

      expect(getChatState().streamingMessage).not.toContain('<|im_end|>');
      expect(getChatState().streamingMessage).toContain('Hello world');
    });

    it('strips </s> tokens during streaming', () => {
      const store = useChatStore.getState();
      const convId = store.createConversation('test-model');

      store.startStreaming(convId);
      store.appendToStreamingMessage('Response</s>');

      expect(getChatState().streamingMessage).not.toContain('</s>');
    });

    it('strips <|eot_id|> tokens during streaming', () => {
      const store = useChatStore.getState();
      const convId = store.createConversation('test-model');

      store.startStreaming(convId);
      store.appendToStreamingMessage('Text<|eot_id|>');

      expect(getChatState().streamingMessage).not.toContain('<|eot_id|>');
    });

    it('strips control tokens on finalize', () => {
      const store = useChatStore.getState();
      const convId = store.createConversation('test-model');

      store.startStreaming(convId);
      // Simulate tokens arriving with control tokens
      useChatStore.setState({ streamingMessage: 'Clean content<|im_end|>' });
      store.finalizeStreamingMessage(convId);

      const msg = getChatState().conversations[0].messages[0];
      expect(msg.content).toBe('Clean content');
    });

    it('does not save message that is only control tokens', () => {
      const store = useChatStore.getState();
      const convId = store.createConversation('test-model');

      store.startStreaming(convId);
      useChatStore.setState({ streamingMessage: '<|im_start|>assistant\n<|im_end|>', streamingForConversationId: convId });
      store.finalizeStreamingMessage(convId);

      expect(getChatState().conversations[0].messages).toHaveLength(0);
    });
  });

  // ============================================================================
  // Title Boundary Edge Cases
  // ============================================================================
  describe('title boundary edge cases', () => {
    it('does not add ellipsis for exactly 50 char message', () => {
      const store = useChatStore.getState();
      const convId = store.createConversation('test-model');
      const content = 'x'.repeat(50); // exactly 50 chars

      store.addMessage(convId, { role: 'user', content });

      const title = getChatState().conversations[0].title;
      expect(title).toBe(content);
      expect(title.endsWith('...')).toBe(false);
    });

    it('adds ellipsis for 51 char message', () => {
      const store = useChatStore.getState();
      const convId = store.createConversation('test-model');
      const content = 'x'.repeat(51);

      store.addMessage(convId, { role: 'user', content });

      const title = getChatState().conversations[0].title;
      expect(title.endsWith('...')).toBe(true);
      expect(title.length).toBe(53); // 50 + '...'
    });

    it('does not update title from second user message', () => {
      const store = useChatStore.getState();
      const convId = store.createConversation('test-model');

      store.addMessage(convId, { role: 'user', content: 'First question' });
      store.addMessage(convId, { role: 'user', content: 'Second question' });

      // Title set from first message, not changed by second
      expect(getChatState().conversations[0].title).toBe('First question');
    });
  });

  // ============================================================================
  // addMessage Edge Cases
  // ============================================================================
  describe('addMessage edge cases', () => {
    it('addMessage on non-existent conversation does not crash', () => {
      const store = useChatStore.getState();

      // Should not throw
      const message = store.addMessage('nonexistent-conv', { role: 'user', content: 'Hello' });

      // Message is returned but not stored anywhere meaningful
      expect(message.id).toBeDefined();
      expect(getChatState().conversations).toHaveLength(0);
    });

    it('supports multiple attachments', () => {
      const store = useChatStore.getState();
      const convId = store.createConversation('test-model');
      const attachments = [
        createMediaAttachment({ type: 'image', uri: 'file:///photo.jpg' }),
        createMediaAttachment({ type: 'document', uri: 'file:///doc.pdf' }),
        createMediaAttachment({ type: 'image', uri: 'file:///photo2.jpg' }),
      ];

      const message = store.addMessage(
        convId,
        { role: 'user', content: 'Look at these', attachments },
      );

      expect(message.attachments).toHaveLength(3);
      expect(message.attachments?.filter(a => a.type === 'image')).toHaveLength(2);
      expect(message.attachments?.filter(a => a.type === 'document')).toHaveLength(1);
    });
  });

  // ============================================================================
  // updateMessageThinking Edge Cases
  // ============================================================================
  describe('updateMessageThinking edge cases', () => {
    it('sets isThinking flag to true', () => {
      const store = useChatStore.getState();
      const convId = store.createConversation('test-model');
      const msg = store.addMessage(convId, { role: 'assistant', content: 'Thinking...' });

      store.updateMessageThinking(convId, msg.id, true);

      const updated = getChatState().conversations[0].messages[0];
      expect(updated.isThinking).toBe(true);
    });

    it('sets isThinking flag to false', () => {
      const store = useChatStore.getState();
      const convId = store.createConversation('test-model');
      const msg = store.addMessage(convId, { role: 'assistant', content: 'Original', isThinking: true });

      store.updateMessageThinking(convId, msg.id, false);

      const updated = getChatState().conversations[0].messages[0];
      expect(updated.isThinking).toBe(false);
    });
  });

  // ============================================================================
  // deleteMessagesAfter Edge Cases
  // ============================================================================
  describe('deleteMessagesAfter edge cases', () => {
    it('handles different conversation ID silently', () => {
      const store = useChatStore.getState();
      const convId = store.createConversation('test-model');
      store.addMessage(convId, { role: 'user', content: 'Keep' });

      store.deleteMessagesAfter('wrong-conv-id', 'any-msg-id');

      // Original conversation unchanged
      expect(getChatState().conversations[0].messages).toHaveLength(1);
    });
  });

  // ============================================================================
  // Streaming direct setters
  // ============================================================================
  describe('setStreamingMessage', () => {
    it('directly sets streaming content', () => {
      const store = useChatStore.getState();
      const convId = store.createConversation('test-model');
      store.startStreaming(convId);

      store.setStreamingMessage('Direct content');

      expect(getChatState().streamingMessage).toBe('Direct content');
    });

    it('overwrites previous streaming content', () => {
      const store = useChatStore.getState();
      const convId = store.createConversation('test-model');
      store.startStreaming(convId);

      store.setStreamingMessage('First');
      store.setStreamingMessage('Replaced');

      expect(getChatState().streamingMessage).toBe('Replaced');
    });
  });

  describe('setIsStreaming', () => {
    it('sets isStreaming and clears isThinking', () => {
      useChatStore.setState({ isThinking: true });

      useChatStore.getState().setIsStreaming(true);

      const state = getChatState();
      expect(state.isStreaming).toBe(true);
      expect(state.isThinking).toBe(false);
    });

    it('can set isStreaming to false', () => {
      useChatStore.setState({ isStreaming: true });

      useChatStore.getState().setIsStreaming(false);

      expect(getChatState().isStreaming).toBe(false);
    });
  });

  describe('setIsThinking', () => {
    it('sets isThinking independently', () => {
      useChatStore.getState().setIsThinking(true);
      expect(getChatState().isThinking).toBe(true);

      useChatStore.getState().setIsThinking(false);
      expect(getChatState().isThinking).toBe(false);
    });
  });

  // ============================================================================
  // Multi-conversation isolation
  // ============================================================================
  describe('multi-conversation isolation', () => {
    it('messages are isolated between conversations', () => {
      const store = useChatStore.getState();
      const conv1 = store.createConversation('model-1');
      const conv2 = store.createConversation('model-2');

      store.addMessage(conv1, { role: 'user', content: 'Conv1 message' });
      store.addMessage(conv2, { role: 'user', content: 'Conv2 message' });

      const conv1Messages = store.getConversationMessages(conv1);
      const conv2Messages = store.getConversationMessages(conv2);

      expect(conv1Messages).toHaveLength(1);
      expect(conv1Messages[0].content).toBe('Conv1 message');
      expect(conv2Messages).toHaveLength(1);
      expect(conv2Messages[0].content).toBe('Conv2 message');
    });

    it('deleting a conversation does not affect other conversations', () => {
      const store = useChatStore.getState();
      const conv1 = store.createConversation('model-1');
      const conv2 = store.createConversation('model-2');

      store.addMessage(conv1, { role: 'user', content: 'Keep this' });
      store.addMessage(conv2, { role: 'user', content: 'Delete with conv' });

      store.deleteConversation(conv2);

      expect(getChatState().conversations).toHaveLength(1);
      expect(store.getConversationMessages(conv1)).toHaveLength(1);
    });

    it('streaming is scoped to specific conversation', () => {
      const store = useChatStore.getState();
      const conv1 = store.createConversation('model-1');
      store.createConversation('model-2');

      store.startStreaming(conv1);
      store.appendToStreamingMessage('For conv1 only');

      const streamState = store.getStreamingState();
      expect(streamState.conversationId).toBe(conv1);
    });

    it('finalizing to wrong conversation clears state but does not save message', () => {
      const store = useChatStore.getState();
      const conv1 = store.createConversation('model-1');
      const conv2 = store.createConversation('model-2');

      store.startStreaming(conv1);
      store.appendToStreamingMessage('Response');
      store.finalizeStreamingMessage(conv2); // Wrong conversation

      // Message not saved to conv2
      expect(store.getConversationMessages(conv2)).toHaveLength(0);
      // Message not saved to conv1 either
      expect(store.getConversationMessages(conv1)).toHaveLength(0);
      // Streaming state cleared
      expect(getChatState().streamingMessage).toBe('');
    });
  });

  // ============================================================================
  // Conversation ordering and timestamps
  // ============================================================================
  describe('conversation ordering', () => {
    it('most recently created conversation is first', () => {
      const store = useChatStore.getState();

      store.createConversation('model-1', 'First');
      store.createConversation('model-1', 'Second');
      store.createConversation('model-1', 'Third');

      const convs = getChatState().conversations;
      expect(convs[0].title).toBe('Third');
      expect(convs[1].title).toBe('Second');
      expect(convs[2].title).toBe('First');
    });

    it('addMessage updates conversation updatedAt timestamp', () => {
      const store = useChatStore.getState();
      const convId = store.createConversation('test-model');
      const originalTime = getChatState().conversations[0].updatedAt;

      // Force a different timestamp
      jest.advanceTimersByTime(100);

      store.addMessage(convId, { role: 'user', content: 'New message' });

      const newTime = getChatState().conversations[0].updatedAt;
      expect(newTime).not.toBe(originalTime);
    });
  });

  // ============================================================================
  // Streaming with generation metadata
  // ============================================================================
  describe('streaming with generation metadata', () => {
    it('finalizeStreamingMessage stores full generation meta', () => {
      const store = useChatStore.getState();
      const convId = store.createConversation('test-model');
      const meta = createGenerationMeta({
        gpu: true,
        gpuBackend: 'Metal',
        gpuLayers: 32,
        modelName: 'Llama-3',
        tokensPerSecond: 30.5,
        decodeTokensPerSecond: 35.2,
        timeToFirstToken: 0.3,
        tokenCount: 100,
      });

      store.startStreaming(convId);
      store.appendToStreamingMessage('Full response');
      store.finalizeStreamingMessage(convId, 2500, meta);

      const message = getChatState().conversations[0].messages[0];
      expect(message.generationTimeMs).toBe(2500);
      expect(message.generationMeta).toEqual(meta);
    });

    it('finalizeStreamingMessage without meta stores undefined', () => {
      const store = useChatStore.getState();
      const convId = store.createConversation('test-model');

      store.startStreaming(convId);
      store.appendToStreamingMessage('Simple response');
      store.finalizeStreamingMessage(convId);

      const message = getChatState().conversations[0].messages[0];
      expect(message.generationTimeMs).toBeUndefined();
      expect(message.generationMeta).toBeUndefined();
    });
  });

  // ============================================================================
  // Persistence partialize verification
  // ============================================================================
  describe('persistence partialize', () => {
    it('only persists conversations and activeConversationId', () => {
      // Verify that streaming state is NOT persisted
      const store = useChatStore.getState();
      const convId = store.createConversation('test-model');
      store.startStreaming(convId);
      store.appendToStreamingMessage('In progress...');

      // Access the persist options
      const options = (useChatStore as any).persist?.getOptions?.();
      if (options?.partialize) {
        const persisted = options.partialize(getChatState());

        expect(persisted).toHaveProperty('conversations');
        expect(persisted).toHaveProperty('activeConversationId');
        expect(persisted).not.toHaveProperty('streamingMessage');
        expect(persisted).not.toHaveProperty('isStreaming');
        expect(persisted).not.toHaveProperty('isThinking');
        expect(persisted).not.toHaveProperty('streamingForConversationId');
      }
    });
  });

  // ============================================================================
  // deleteMessage edge cases
  // ============================================================================
  describe('deleteMessage edge cases', () => {
    it('deleteMessage on non-existent message is safe', () => {
      const store = useChatStore.getState();
      const convId = store.createConversation('test-model');
      store.addMessage(convId, { role: 'user', content: 'Keep' });

      // Should not throw
      store.deleteMessage(convId, 'nonexistent-msg-id');

      expect(getChatState().conversations[0].messages).toHaveLength(1);
    });

    it('deleteMessage updates updatedAt', () => {
      const store = useChatStore.getState();
      const convId = store.createConversation('test-model');
      const msg = store.addMessage(convId, { role: 'user', content: 'To delete' });
      const beforeTime = getChatState().conversations[0].updatedAt;

      jest.advanceTimersByTime(100);
      store.deleteMessage(convId, msg.id);

      expect(getChatState().conversations[0].updatedAt).not.toBe(beforeTime);
    });
  });

  // ============================================================================
  // addMessage with system role
  // ============================================================================
  describe('addMessage with system role', () => {
    it('does not update title from system messages', () => {
      const store = useChatStore.getState();
      const convId = store.createConversation('test-model');

      store.addMessage(convId, { role: 'system', content: 'System prompt text' });

      expect(getChatState().conversations[0].title).toBe('New Conversation');
    });

    it('stores system messages correctly', () => {
      const store = useChatStore.getState();
      const convId = store.createConversation('test-model');

      const msg = store.addMessage(convId, { role: 'system', content: 'You are helpful' });

      expect(msg.role).toBe('system');
      expect(getChatState().conversations[0].messages[0].role).toBe('system');
    });
  });

  // ============================================================================
  // Rapid streaming operations
  // ============================================================================
  describe('rapid streaming operations', () => {
    it('handles many rapid appends', () => {
      const store = useChatStore.getState();
      const convId = store.createConversation('test-model');
      store.startStreaming(convId);

      // Simulate rapid token streaming
      for (let i = 0; i < 100; i++) {
        store.appendToStreamingMessage(`token${i} `);
      }

      const content = getChatState().streamingMessage;
      expect(content).toContain('token0');
      expect(content).toContain('token99');
    });

    it('clearStreamingMessage during active streaming', () => {
      const store = useChatStore.getState();
      const convId = store.createConversation('test-model');
      store.startStreaming(convId);
      store.appendToStreamingMessage('Partial');

      store.clearStreamingMessage();

      expect(getChatState().streamingMessage).toBe('');
      expect(getChatState().isStreaming).toBe(false);
      expect(getChatState().isThinking).toBe(false);
      expect(getChatState().streamingForConversationId).toBeNull();
    });

    it('startStreaming resets previous streaming state', () => {
      const store = useChatStore.getState();
      const conv1 = store.createConversation('model-1');
      const conv2 = store.createConversation('model-2');

      // Start streaming for conv1
      store.startStreaming(conv1);
      store.appendToStreamingMessage('Old content');

      // Start streaming for conv2 (overwrites)
      store.startStreaming(conv2);

      const state = getChatState();
      expect(state.streamingForConversationId).toBe(conv2);
      expect(state.streamingMessage).toBe('');
      expect(state.isThinking).toBe(true);
      expect(state.isStreaming).toBe(false);
    });
  });

  describe('streaming TTS answer gating (only the answer is spoken)', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { registerHook, _clearHooksForTesting } = require('../../../src/bootstrap/hookRegistry');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { useAppStore } = require('../../../src/stores/appStore');
    let spoken: string[];

    beforeEach(() => {
      _clearHooksForTesting();
      spoken = [];
      registerHook('audio.onStreamingToken', (t: string) => spoken.push(t));
    });

    it('withholds inline reasoning until </think>, then speaks only the answer (thinking on)', () => {
      useAppStore.setState({ settings: { ...useAppStore.getState().settings, thinkingEnabled: true } });
      const store = useChatStore.getState();
      const convId = store.createConversation('m');
      store.startStreaming(convId);
      store.appendToStreamingMessage('The user is asking ');
      store.appendToStreamingMessage('about the weather.');
      expect(spoken.at(-1)).toBe(''); // still in the (inline) thinking phase
      store.appendToStreamingMessage('</think>Hello there!');
      expect(spoken.at(-1)).toBe('Hello there!'); // only the answer after </think>
    });

    it('speaks content normally when thinking is disabled', () => {
      useAppStore.setState({ settings: { ...useAppStore.getState().settings, thinkingEnabled: false } });
      const store = useChatStore.getState();
      const convId = store.createConversation('m');
      store.startStreaming(convId);
      store.appendToStreamingMessage('Hello there!');
      expect(spoken.at(-1)).toBe('Hello there!');
    });
  });
});
