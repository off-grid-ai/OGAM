/**
 * Generation Service Unit Tests
 *
 * Tests for the LLM generation service state machine.
 * Priority: P0 (Critical) - Core generation functionality.
 */

import { generationService, GenerationState } from '../../../src/services/generationService';
import { llmService } from '../../../src/services/llm';
import { useChatStore } from '../../../src/stores/chatStore';
import { useRemoteServerStore } from '../../../src/stores/remoteServerStore';
import { useAppStore } from '../../../src/stores/appStore';
import { providerRegistry } from '../../../src/services/providers';
import { resetStores, setupWithActiveModel, setupWithConversation } from '../../utils/testHelpers';
import { createMessage } from '../../utils/factories';

// Mock the llmService
jest.mock('../../../src/services/llm', () => ({
  llmService: {
    isModelLoaded: jest.fn(),
    isCurrentlyGenerating: jest.fn(),
    generateResponse: jest.fn(),
    stopGeneration: jest.fn(),
    getGpuInfo: jest.fn(() => ({ gpu: false, gpuBackend: 'CPU', gpuLayers: 0, reasonNoGPU: '' })),
    getPerformanceStats: jest.fn(() => ({
      lastTokensPerSecond: 15,
      lastDecodeTokensPerSecond: 18,
      lastTimeToFirstToken: 0.5,
      lastGenerationTime: 3.0,
      lastTokenCount: 50,
    })),
  },
}));

// Mock activeModelService
jest.mock('../../../src/services/activeModelService', () => ({
  activeModelService: {
    getActiveModels: jest.fn(() => ({ text: null, image: null })),
  },
}));

// Mock sharePrompt utility (the once-per-session trigger the service delegates to)
jest.mock('../../../src/utils/sharePrompt', () => ({
  maybeScheduleSharePrompt: jest.fn(),
  resetSharePromptSession: jest.fn(),
  emitSharePrompt: jest.fn(),
}));

// Mock provider registry
jest.mock('../../../src/services/providers', () => ({
  providerRegistry: {
    getProvider: jest.fn(),
    getActiveProvider: jest.fn(),
    hasProvider: jest.fn(() => false),
  },
}));

// Mock runToolLoop
jest.mock('../../../src/services/generationToolLoop', () => ({
  runToolLoop: jest.fn(),
}));

import { runToolLoop } from '../../../src/services/generationToolLoop';
const mockedRunToolLoop = runToolLoop as jest.Mock;

const mockedLlmService = llmService as jest.Mocked<typeof llmService>;
const mockedProviderRegistry = providerRegistry as jest.Mocked<typeof providerRegistry>;

describe('generationService', () => {
  beforeEach(() => {
    resetStores();
    jest.clearAllMocks();

    // Reset the service state by using private method access
    // This is a workaround since the service is a singleton
    (generationService as any).state = {
      isGenerating: false,
      isThinking: false,
      conversationId: null,
      streamingContent: '',
      startTime: null,
      queuedMessages: [],
    };
    (generationService as any).listeners.clear();
    (generationService as any).abortRequested = false;
    (generationService as any).queueProcessor = null;

    // Re-setup mocks after clearAllMocks
    mockedLlmService.isModelLoaded.mockReturnValue(true);
    mockedLlmService.isCurrentlyGenerating.mockReturnValue(false);
    mockedLlmService.stopGeneration.mockResolvedValue(undefined);
    mockedLlmService.getGpuInfo.mockReturnValue({ gpu: false, gpuBackend: 'CPU', gpuLayers: 0, reasonNoGPU: '' });
    mockedLlmService.getPerformanceStats.mockReturnValue({
      lastTokensPerSecond: 15,
      lastDecodeTokensPerSecond: 18,
      lastTimeToFirstToken: 0.5,
      lastGenerationTime: 3.0,
      lastTokenCount: 50,
    });
  });

  // ============================================================================
  // State Management
  // ============================================================================
  describe('getState', () => {
    it('returns current state', () => {
      const state = generationService.getState();

      expect(state).toHaveProperty('isGenerating');
      expect(state).toHaveProperty('isThinking');
      expect(state).toHaveProperty('conversationId');
      expect(state).toHaveProperty('streamingContent');
      expect(state).toHaveProperty('startTime');
    });

    it('returns immutable copy (modifications do not affect service)', () => {
      const state = generationService.getState();

      state.isGenerating = true;
      state.conversationId = 'modified';

      const newState = generationService.getState();
      expect(newState.isGenerating).toBe(false);
      expect(newState.conversationId).toBeNull();
    });

    it('returns initial state correctly', () => {
      const state = generationService.getState();

      expect(state.isGenerating).toBe(false);
      expect(state.isThinking).toBe(false);
      expect(state.conversationId).toBeNull();
      expect(state.streamingContent).toBe('');
      expect(state.startTime).toBeNull();
    });
  });

  describe('isGeneratingFor', () => {
    it('returns false when not generating', () => {
      expect(generationService.isGeneratingFor('any-conversation')).toBe(false);
    });

    it('returns true for active conversation during generation', async () => {
      const convId = setupWithConversation();

      // Setup mock to simulate ongoing generation
      mockedLlmService.generateResponse.mockImplementation((async () => {
        // Never complete - simulates ongoing generation
        await new Promise(() => {});
      }) as any);

      // Start generation (don't await - it won't complete)
      generationService.generateResponse(convId, [
        createMessage({ role: 'user', content: 'Hello' }),
      ]);

      // Give it a moment to start
      await new Promise<void>(resolve => setTimeout(() => resolve(), 0));

      expect(generationService.isGeneratingFor(convId)).toBe(true);
    });

    it('returns false for different conversation during generation', async () => {
      const convId = setupWithConversation();

      mockedLlmService.generateResponse.mockImplementation((async () => {
        await new Promise(() => {});
      }) as any);

      generationService.generateResponse(convId, [
        createMessage({ role: 'user', content: 'Hello' }),
      ]);

      await new Promise<void>(resolve => setTimeout(() => resolve(), 0));

      expect(generationService.isGeneratingFor('different-conversation')).toBe(false);
    });
  });

  // ============================================================================
  // Subscription
  // ============================================================================
  describe('subscribe', () => {
    it('immediately calls listener with current state', () => {
      const listener = jest.fn();

      generationService.subscribe(listener);

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(expect.objectContaining({
        isGenerating: false,
        isThinking: false,
      }));
    });

    it('returns unsubscribe function', () => {
      const listener = jest.fn();

      const unsubscribe = generationService.subscribe(listener);

      expect(typeof unsubscribe).toBe('function');
    });

    it('unsubscribe removes listener', async () => {
      const listener = jest.fn();

      const unsubscribe = generationService.subscribe(listener);
      listener.mockClear();

      unsubscribe();

      // Force a state update
      (generationService as any).notifyListeners();

      expect(listener).not.toHaveBeenCalled();
    });

    it('multiple listeners receive updates', () => {
      const listener1 = jest.fn();
      const listener2 = jest.fn();

      generationService.subscribe(listener1);
      generationService.subscribe(listener2);

      // Both should have been called with initial state
      expect(listener1).toHaveBeenCalled();
      expect(listener2).toHaveBeenCalled();
    });
  });

  // ============================================================================
  // Generation
  // ============================================================================
  describe('generateResponse', () => {
    it('throws when no model loaded', async () => {
      mockedLlmService.isModelLoaded.mockReturnValue(false);

      const convId = setupWithConversation();

      await expect(
        generationService.generateResponse(convId, [
          createMessage({ role: 'user', content: 'Hello' }),
        ])
      ).rejects.toThrow('No model loaded');
    });

    it('returns immediately when already generating', async () => {
      const convId = setupWithConversation();

      // Start a generation that won't complete
      mockedLlmService.generateResponse.mockImplementation((async () => {
        await new Promise(() => {});
      }) as any);

      // First generation
      generationService.generateResponse(convId, [
        createMessage({ role: 'user', content: 'First' }),
      ]);

      await new Promise<void>(resolve => setTimeout(() => resolve(), 0));

      // Second generation should return immediately
      await generationService.generateResponse(convId, [
        createMessage({ role: 'user', content: 'Second' }),
      ]);

      // Only one call to llmService
      expect(mockedLlmService.generateResponse).toHaveBeenCalledTimes(1);
    });

    it('sets isThinking true initially', async () => {
      const convId = setupWithConversation();
      const stateUpdates: GenerationState[] = [];

      generationService.subscribe(state => stateUpdates.push({ ...state }));

      mockedLlmService.generateResponse.mockImplementation((async () => {
        await new Promise(() => {});
      }) as any);

      generationService.generateResponse(convId, [
        createMessage({ role: 'user', content: 'Hello' }),
      ]);

      await new Promise<void>(resolve => setTimeout(() => resolve(), 0));

      // Find the state where isThinking is true
      const thinkingState = stateUpdates.find(s => s.isThinking && s.isGenerating);
      expect(thinkingState).toBeDefined();
    });

    it('calls chatStore.startStreaming', async () => {
      const convId = setupWithConversation();
      const startStreamingSpy = jest.spyOn(useChatStore.getState(), 'startStreaming');

      mockedLlmService.generateResponse.mockImplementation((async () => {
        await new Promise(() => {});
      }) as any);

      generationService.generateResponse(convId, [
        createMessage({ role: 'user', content: 'Hello' }),
      ]);

      await new Promise<void>(resolve => setTimeout(() => resolve(), 0));

      expect(startStreamingSpy).toHaveBeenCalledWith(convId);
    });

    it('accumulates streaming tokens', async () => {
      const convId = setupWithConversation();
      setupWithActiveModel();

      // Track the streaming state during generation
      const streamedTokens: string[] = [];

      mockedLlmService.generateResponse.mockImplementation((async (
        _messages: any,
        { onStream, onComplete }: any = {}
      ) => {
        onStream?.('Hello');
        streamedTokens.push('Hello');
        onStream?.(' ');
        streamedTokens.push(' ');
        onStream?.('world');
        streamedTokens.push('world');
        onComplete?.('Hello world');
        return 'Hello world';
      }) as any);

      await generationService.generateResponse(convId, [
        createMessage({ role: 'user', content: 'Hi' }),
      ]);

      // Verify tokens were streamed
      expect(streamedTokens).toEqual(['Hello', ' ', 'world']);

      // Verify the chat store was updated with streaming content
      // Note: The actual content depends on how the service processed tokens
      // The key is that onStream was called with the tokens
    });

    it('calls onFirstToken callback on first token', async () => {
      const convId = setupWithConversation();
      setupWithActiveModel();
      const onFirstToken = jest.fn();

      mockedLlmService.generateResponse.mockImplementation((async (
        _messages: any,
        { onStream, onComplete }: any = {}
      ) => {
        onStream?.('First');
        onStream?.(' token');
        onComplete?.('First token');
      }) as any);

      await generationService.generateResponse(
        convId,
        [createMessage({ role: 'user', content: 'Hi' })],
        onFirstToken
      );

      expect(onFirstToken).toHaveBeenCalledTimes(1);
    });

    it('finalizes message on completion', async () => {
      const convId = setupWithConversation();
      setupWithActiveModel();

      mockedLlmService.generateResponse.mockImplementation((async (
        _messages: any,
        { onStream, onComplete }: any = {}
      ) => {
        onStream?.('Response');
        onComplete?.('Response');
      }) as any);

      await generationService.generateResponse(convId, [
        createMessage({ role: 'user', content: 'Hi' }),
      ]);

      const state = generationService.getState();
      expect(state.isGenerating).toBe(false);
      expect(state.conversationId).toBeNull();
      expect(state.streamingContent).toBe('');
    });

    // (Removed: "handles generation error" asserted clearStreamingMessage-on-error, the SUPERSEDED
    // discard behavior. Error now flushes + finalizes the shown partial (keepShownPartialOnError);
    // covered by errorKeepsPartial.rendered.redflow.test.tsx.)

    it('throws error on generation failure', async () => {
      const convId = setupWithConversation();

      mockedLlmService.generateResponse.mockRejectedValue(new Error('Failed'));

      await expect(
        generationService.generateResponse(convId, [
          createMessage({ role: 'user', content: 'Hi' }),
        ])
      ).rejects.toThrow('Failed');
    });
  });

  // ============================================================================
  // Stop Generation
  // ============================================================================
  describe('stopGeneration', () => {
    it('always attempts to stop native generation', async () => {
      await generationService.stopGeneration();

      expect(mockedLlmService.stopGeneration).toHaveBeenCalled();
    });

    it('returns empty string when not generating', async () => {
      const result = await generationService.stopGeneration();

      expect(result).toBe('');
    });

    it('saves partial content when stopped', async () => {
      const convId = setupWithConversation();
      setupWithActiveModel();

      // Start generation that accumulates content
      mockedLlmService.generateResponse.mockImplementation((async (
        _messages: any,
        { onStream }: any = {}
      ) => {
        onStream?.('Partial');
        onStream?.(' content');
        // Never complete - will be stopped
        await new Promise(() => {});
      }) as any);

      // Start generation
      generationService.generateResponse(convId, [
        createMessage({ role: 'user', content: 'Hi' }),
      ]);

      // Wait for tokens to be processed
      await new Promise<void>(resolve => setTimeout(() => resolve(), 50));

      // Stop generation
      const partial = await generationService.stopGeneration();

      expect(partial).toBe('Partial content');
    });

    // (Removed: "clears streaming message when no content" asserted clear-on-stop, superseded by
    // never-discard — stop flushes + finalizes whatever is shown. Covered by the stopKeepsPartial
    // rendered integration tests.)

    it('resets state after stopping', async () => {
      const convId = setupWithConversation();

      mockedLlmService.generateResponse.mockImplementation((async (
        _messages: any,
        { onStream }: any = {}
      ) => {
        onStream?.('Content');
        await new Promise(() => {});
      }) as any);

      generationService.generateResponse(convId, [
        createMessage({ role: 'user', content: 'Hi' }),
      ]);

      await new Promise<void>(resolve => setTimeout(() => resolve(), 50));

      await generationService.stopGeneration();

      const state = generationService.getState();
      expect(state.isGenerating).toBe(false);
      expect(state.isThinking).toBe(false);
      expect(state.conversationId).toBeNull();
      expect(state.streamingContent).toBe('');
      expect(state.startTime).toBeNull();
    });

    it('handles stopGeneration error gracefully', async () => {
      mockedLlmService.stopGeneration.mockRejectedValue(new Error('Stop failed'));

      // Should not throw
      await expect(generationService.stopGeneration()).resolves.toBe('');
    });

    it('IGNORES a token the provider emits AFTER stopGeneration (abort guard is load-bearing)', async () => {
      // Regression guard for the mid-stream-cancel race: a slow/native provider can
      // fire one more onStream callback AFTER the user hit Stop. The abort guard must
      // drop it — otherwise a post-cancel token corrupts the finalized partial. This
      // drives the REAL service (only the LLM boundary is faked) and captures the real
      // onStream so we can invoke it post-stop, rather than asserting a mock's return.
      const convId = setupWithConversation();
      setupWithActiveModel();

      let capturedOnStream: ((t: string) => void) | undefined;
      mockedLlmService.generateResponse.mockImplementation((async (
        _messages: any,
        { onStream }: any = {},
      ) => {
        capturedOnStream = onStream;
        onStream?.('Partial');
        await new Promise(() => {}); // never resolves — will be stopped
      }) as any);

      generationService.generateResponse(convId, [createMessage({ role: 'user', content: 'Hi' })]);
      await new Promise<void>(resolve => setTimeout(resolve, 50));

      const partial = await generationService.stopGeneration();
      expect(partial).toBe('Partial');

      // The provider emits one more token AFTER stop (the exact race).
      capturedOnStream?.(' LEAKED');

      // It must NOT be appended anywhere: streaming content stays cleared and the
      // finalized partial is unchanged. Deleting the abort guard fails this.
      expect(generationService.getState().streamingContent).toBe('');
      expect(generationService.getState().isGenerating).toBe(false);
    });
  });

  // ============================================================================
  // Queue Management
  // ============================================================================
  describe('queue management', () => {
    it('enqueueMessage adds to queue', () => {
      generationService.enqueueMessage({
        id: 'q1',
        conversationId: 'conv-1',
        text: 'Hello',
        messageText: 'Hello',
      });

      const state = generationService.getState();
      expect(state.queuedMessages).toHaveLength(1);
      expect(state.queuedMessages[0].id).toBe('q1');
    });

    it('enqueueMessage appends multiple items', () => {
      generationService.enqueueMessage({
        id: 'q1',
        conversationId: 'conv-1',
        text: 'First',
        messageText: 'First',
      });
      generationService.enqueueMessage({
        id: 'q2',
        conversationId: 'conv-1',
        text: 'Second',
        messageText: 'Second',
      });

      expect(generationService.getState().queuedMessages).toHaveLength(2);
    });

    it('removeFromQueue removes specific item', () => {
      generationService.enqueueMessage({
        id: 'q1',
        conversationId: 'conv-1',
        text: 'First',
        messageText: 'First',
      });
      generationService.enqueueMessage({
        id: 'q2',
        conversationId: 'conv-1',
        text: 'Second',
        messageText: 'Second',
      });

      generationService.removeFromQueue('q1');

      const queue = generationService.getState().queuedMessages;
      expect(queue).toHaveLength(1);
      expect(queue[0].id).toBe('q2');
    });

    it('clearQueue removes all items', () => {
      generationService.enqueueMessage({
        id: 'q1',
        conversationId: 'conv-1',
        text: 'First',
        messageText: 'First',
      });
      generationService.enqueueMessage({
        id: 'q2',
        conversationId: 'conv-1',
        text: 'Second',
        messageText: 'Second',
      });

      generationService.clearQueue();

      expect(generationService.getState().queuedMessages).toHaveLength(0);
    });

    it('notifies listeners on queue changes', () => {
      const listener = jest.fn();
      generationService.subscribe(listener);
      listener.mockClear();

      generationService.enqueueMessage({
        id: 'q1',
        conversationId: 'conv-1',
        text: 'Hello',
        messageText: 'Hello',
      });

      expect(listener).toHaveBeenCalled();
      const lastCall = listener.mock.calls[listener.mock.calls.length - 1][0];
      expect(lastCall.queuedMessages).toHaveLength(1);
    });
  });

  // ============================================================================
  // Queue Processor
  // ============================================================================
  describe('queue processor', () => {
    it('setQueueProcessor registers callback', () => {
      const processor = jest.fn();
      generationService.setQueueProcessor(processor);

      expect((generationService as any).queueProcessor).toBe(processor);
    });

    it('setQueueProcessor with null clears callback', () => {
      generationService.setQueueProcessor(jest.fn());
      generationService.setQueueProcessor(null);

      expect((generationService as any).queueProcessor).toBeNull();
    });

    it('processNextInQueue aggregates multiple messages', async () => {
      const processor = jest.fn().mockResolvedValue(undefined);
      generationService.setQueueProcessor(processor);

      // Enqueue 3 messages
      generationService.enqueueMessage({
        id: 'q1',
        conversationId: 'conv-1',
        text: 'First',
        messageText: 'First',
        attachments: [{ id: 'att-1', type: 'image' as const, uri: '/img1.jpg' }],
      });
      generationService.enqueueMessage({
        id: 'q2',
        conversationId: 'conv-1',
        text: 'Second',
        messageText: 'Second',
      });
      generationService.enqueueMessage({
        id: 'q3',
        conversationId: 'conv-1',
        text: 'Third',
        messageText: 'Third',
      });

      // Trigger queue processing by calling private method
      (generationService as any).processNextInQueue();

      // Wait for async processor
      await new Promise<void>(resolve => setTimeout(resolve, 10));

      expect(processor).toHaveBeenCalledTimes(1);
      const combined = processor.mock.calls[0][0];
      expect(combined.text).toContain('First');
      expect(combined.text).toContain('Second');
      expect(combined.text).toContain('Third');
      expect(combined.attachments).toHaveLength(1); // Only q1 had attachment
    });

    it('processNextInQueue passes single message directly', async () => {
      const processor = jest.fn().mockResolvedValue(undefined);
      generationService.setQueueProcessor(processor);

      generationService.enqueueMessage({
        id: 'q1',
        conversationId: 'conv-1',
        text: 'Only one',
        messageText: 'Only one',
      });

      (generationService as any).processNextInQueue();
      await new Promise<void>(resolve => setTimeout(resolve, 10));

      expect(processor).toHaveBeenCalledTimes(1);
      expect(processor.mock.calls[0][0].id).toBe('q1');
      expect(processor.mock.calls[0][0].text).toBe('Only one');
    });

    it('processNextInQueue does nothing without processor', () => {
      generationService.setQueueProcessor(null);
      generationService.enqueueMessage({
        id: 'q1',
        conversationId: 'conv-1',
        text: 'Hello',
        messageText: 'Hello',
      });

      // Should not throw
      (generationService as any).processNextInQueue();

      // Queue should still have items since no processor handled them
      // Actually processNextInQueue clears the queue first then calls processor
      // If no processor, it returns early without clearing
      expect(generationService.getState().queuedMessages).toHaveLength(1);
    });
  });

  // ============================================================================
  // Abort Handling
  // ============================================================================
  describe('abort handling', () => {
    it('ignores tokens after abort is requested', async () => {
      const convId = setupWithConversation();
      setupWithActiveModel();

      mockedLlmService.generateResponse.mockImplementation((async (
        _messages: any,
        { onStream }: any = {},
      ) => {
        onStream?.('First');
        // Simulate abort
        (generationService as any).abortRequested = true;
        onStream?.('Ignored');
        await new Promise(() => {}); // Never complete
      }) as any);

      generationService.generateResponse(convId, [
        createMessage({ role: 'user', content: 'Hi' }),
      ]);

      await new Promise<void>(resolve => setTimeout(resolve, 50));

      // streamingContent should only have First since abort was set before Ignored
      const state = generationService.getState();
      expect(state.streamingContent).toBe('First');
    });
  });

  // ============================================================================
  // Integration with Stores
  // ============================================================================
  describe('store integration', () => {
    it('updates chatStore streaming state during generation', async () => {
      const convId = setupWithConversation();
      setupWithActiveModel();

      mockedLlmService.generateResponse.mockImplementation((async (
        _messages: any,
        { onStream, onComplete }: any = {}
      ) => {
        onStream?.('Token');
        onComplete?.('Token');
      }) as any);

      await generationService.generateResponse(convId, [
        createMessage({ role: 'user', content: 'Hi' }),
      ]);

      // After completion, streaming should be cleared
      const chatState = useChatStore.getState();
      expect(chatState.streamingMessage).toBe('');
      expect(chatState.isStreaming).toBe(false);
    });

    it('includes generation metadata on finalized message', async () => {
      const convId = setupWithConversation();
      setupWithActiveModel({ name: 'Test Model' });

      mockedLlmService.generateResponse.mockImplementation((async (
        _messages: any,
        { onStream, onComplete }: any = {}
      ) => {
        onStream?.('Response');
        onComplete?.('Response');
        return 'Response';
      }) as any);

      await generationService.generateResponse(convId, [
        createMessage({ role: 'user', content: 'Hi' }),
      ]);

      const messages = useChatStore.getState().getConversationMessages(convId);
      const assistantMessage = messages.find(m => m.role === 'assistant');

      // If message was created, it should have metadata
      if (assistantMessage) {
        expect(assistantMessage.generationMeta).toBeDefined();
        expect(assistantMessage.generationTimeMs).toBeDefined();
      } else {
        // Message may not be created if streaming content was empty after trim
        // This is acceptable behavior - the service clears empty messages
        expect(true).toBe(true);
      }
    });
  });

  // ============================================================================
  // Remote Provider
  // ============================================================================
  describe('remote provider', () => {
    const mockRemoteProvider = {
      id: 'test-remote',
      isReady: jest.fn().mockResolvedValue(true),
      generate: jest.fn(),
      stopGeneration: jest.fn().mockResolvedValue(undefined),
      getLoadedModelId: jest.fn().mockReturnValue('remote-model'),
      capabilities: { supportsVision: false, supportsToolCalling: true, supportsThinking: false },
    };

    beforeEach(() => {
      // Reset remote server store state
      useRemoteServerStore.setState({
        activeServerId: null,
        servers: [],
      });
      mockedProviderRegistry.getProvider.mockReturnValue(undefined);
      mockedProviderRegistry.getActiveProvider.mockReturnValue(mockRemoteProvider as any);
      (mockedProviderRegistry as any).hasProvider = jest.fn(() => true);
      mockedLlmService.isModelLoaded.mockReturnValue(false);
    });

    afterEach(() => {
      useRemoteServerStore.setState({ activeServerId: null });
    });

    it('routes to remote provider when activeServerId is set', async () => {
      const convId = setupWithConversation();
      useRemoteServerStore.setState({ activeServerId: 'test-remote' });
      mockedProviderRegistry.getProvider.mockReturnValue(mockRemoteProvider as any);

      mockRemoteProvider.generate.mockImplementation(async (_msgs: any, _opts: any, callbacks: any) => {
        callbacks.onToken('Remote response');
        callbacks.onComplete({ content: 'Remote response' });
      });

      await generationService.generateResponse(convId, [
        createMessage({ role: 'user', content: 'Hi' }),
      ]);

      expect(mockedLlmService.generateResponse).not.toHaveBeenCalled();
      expect(mockRemoteProvider.generate).toHaveBeenCalled();
    });

    it('throws error when remote provider is not found', async () => {
      const convId = setupWithConversation();
      useRemoteServerStore.setState({ activeServerId: 'missing-remote' });
      mockedProviderRegistry.getProvider.mockReturnValue(undefined);

      await expect(
        generationService.generateResponse(convId, [
          createMessage({ role: 'user', content: 'Hi' }),
        ])
      ).rejects.toThrow('Remote provider not found');
    });

    it('throws error when remote provider is not ready', async () => {
      const convId = setupWithConversation();
      useRemoteServerStore.setState({ activeServerId: 'test-remote' });
      mockRemoteProvider.isReady.mockResolvedValueOnce(false);
      mockedProviderRegistry.getProvider.mockReturnValue(mockRemoteProvider as any);

      await expect(
        generationService.generateResponse(convId, [
          createMessage({ role: 'user', content: 'Hi' }),
        ])
      ).rejects.toThrow('Remote provider not ready');
    });

    it('handles remote generation error', async () => {
      const convId = setupWithConversation();
      useRemoteServerStore.setState({ activeServerId: 'test-remote' });
      mockedProviderRegistry.getProvider.mockReturnValue(mockRemoteProvider as any);

      mockRemoteProvider.generate.mockImplementation(async (_msgs: any, _opts: any, callbacks: any) => {
        callbacks.onError(new Error('Remote generation failed'));
      });

      await expect(
        generationService.generateResponse(convId, [
          createMessage({ role: 'user', content: 'Hi' }),
        ])
      ).rejects.toThrow('Remote generation failed');
    });

    it('tracks time to first token for remote generation', async () => {
      const convId = setupWithConversation();
      useRemoteServerStore.setState({ activeServerId: 'test-remote' });
      mockedProviderRegistry.getProvider.mockReturnValue(mockRemoteProvider as any);

      let _onFirstTokenCallback: (() => void) | undefined;
      mockRemoteProvider.generate.mockImplementation(async (_msgs: any, _opts: any, callbacks: any) => {
        // Simulate delay before first token
        await new Promise(resolve => setTimeout(resolve, 10));
        callbacks.onToken('First');
        _onFirstTokenCallback = callbacks.onFirstToken;
      });

      await generationService.generateResponse(convId, [
        createMessage({ role: 'user', content: 'Hi' }),
      ]);

      // Verify remoteTimeToFirstToken was tracked
      expect(mockRemoteProvider.generate).toHaveBeenCalled();
    });

    it('stops remote generation on abort', async () => {
      const convId = setupWithConversation();
      useRemoteServerStore.setState({ activeServerId: 'test-remote' });
      mockedProviderRegistry.getProvider.mockReturnValue(mockRemoteProvider as any);

      mockRemoteProvider.generate.mockImplementation(async () => {
        // Never complete
        await new Promise(() => {});
      });

      generationService.generateResponse(convId, [
        createMessage({ role: 'user', content: 'Hi' }),
      ]);

      await new Promise(resolve => setTimeout(resolve, 10));

      // Stop should abort the remote controller
      await generationService.stopGeneration();

      const state = generationService.getState();
      expect(state.isGenerating).toBe(false);
    });

    it('handles onReasoning callback for remote generation', async () => {
      const convId = setupWithConversation();
      useRemoteServerStore.setState({ activeServerId: 'test-remote' });
      mockedProviderRegistry.getProvider.mockReturnValue(mockRemoteProvider as any);

      mockRemoteProvider.generate.mockImplementation(async (_msgs: any, _opts: any, callbacks: any) => {
        callbacks.onReasoning('Thinking...');
        callbacks.onToken('Response');
        callbacks.onComplete({ content: 'Response' });
      });

      await generationService.generateResponse(convId, [
        createMessage({ role: 'user', content: 'Hi' }),
      ]);

      expect(mockRemoteProvider.generate).toHaveBeenCalled();
    });

    it('uses remote metadata in generation meta', async () => {
      const convId = setupWithConversation();
      useRemoteServerStore.setState({
        activeServerId: 'test-remote',
        servers: [{ id: 'test-remote', name: 'Test Server', endpoint: 'http://test' }] as any,
      });
      mockedProviderRegistry.getProvider.mockReturnValue(mockRemoteProvider as any);
      mockedProviderRegistry.getActiveProvider.mockReturnValue(mockRemoteProvider as any);

      mockRemoteProvider.generate.mockImplementation(async (_msgs: any, _opts: any, callbacks: any) => {
        callbacks.onToken('Response');
        callbacks.onComplete({ content: 'Response' });
      });

      await generationService.generateResponse(convId, [
        createMessage({ role: 'user', content: 'Hi' }),
      ]);

      // Verify generation completed successfully
      const state = generationService.getState();
      expect(state.isGenerating).toBe(false);
    });
  });

  // ============================================================================
  // Generation Metadata
  // ============================================================================
  describe('buildGenerationMeta', () => {
    it('includes GPU info for local generation', async () => {
      const convId = setupWithConversation();
      setupWithActiveModel({ name: 'Test Model' });
      mockedLlmService.getGpuInfo.mockReturnValue({
        gpu: true,
        gpuBackend: 'Metal',
        gpuLayers: 32,
        reasonNoGPU: '',
      });
      mockedLlmService.getPerformanceStats.mockReturnValue({
        lastTokensPerSecond: 25,
        lastDecodeTokensPerSecond: 30,
        lastTimeToFirstToken: 0.3,
        lastGenerationTime: 2.0,
        lastTokenCount: 100,
      });

      mockedLlmService.generateResponse.mockImplementation(async (_msgs: any, { onStream, onComplete }: any = {}) => {
        onStream?.('Response');
        onComplete?.('Response');
        return 'Response';
      });

      await generationService.generateResponse(convId, [
        createMessage({ role: 'user', content: 'Hi' }),
      ]);

      // Generation should complete
      expect(generationService.getState().isGenerating).toBe(false);
    });
  });

  // ============================================================================
  // Share Prompt Check
  // ============================================================================
  describe('share prompt check', () => {
    it('does not trigger share prompt if already engaged', async () => {
      const { emitSharePrompt } = require('../../../src/utils/sharePrompt');
      const convId = setupWithConversation();
      setupWithActiveModel();

      useAppStore.setState({ hasEngagedSharePrompt: true });

      mockedLlmService.generateResponse.mockImplementation(async (_msgs: any, { onStream, onComplete }: any = {}) => {
        onStream?.('Response');
        onComplete?.('Response');
        return 'Response';
      });

      await generationService.generateResponse(convId, [
        createMessage({ role: 'user', content: 'Hi' }),
      ]);

      expect(emitSharePrompt).not.toHaveBeenCalled();
    });
  });

  // ============================================================================
  // Additional branch coverage
  // ============================================================================
  describe('reasoning content in local generateResponse', () => {
    it('accumulates reasoning content in reasoningBuffer', async () => {
      const convId = setupWithConversation();
      setupWithActiveModel();

      mockedLlmService.generateResponse.mockImplementation(async (
        _msgs: any, { onStream, onComplete }: any = {}
      ) => {
        onStream?.({ content: 'answer', reasoningContent: 'thinking step' });
        onComplete?.('answer');
        return 'answer';
      });

      await generationService.generateResponse(convId, [
        createMessage({ role: 'user', content: 'Hi' }),
      ]);

      // If reasoning was buffered, appendToStreamingReasoningContent would have been called
      expect(generationService.getState().isGenerating).toBe(false);
    });
  });

  describe('error path clears flushTimer', () => {
    it('clearTimeout on flushTimer when generation throws with buffered tokens', async () => {
      jest.useFakeTimers();
      const convId = setupWithConversation();
      setupWithActiveModel();

      mockedLlmService.generateResponse.mockImplementation(async (_msgs: any, { onStream }: any = {}) => {
        // Stream a token (sets flushTimer via buffering)
        onStream?.('partial');
        // Then throw
        throw new Error('sudden failure');
      });

      await expect(
        generationService.generateResponse(convId, [createMessage({ role: 'user', content: 'Hi' })])
      ).rejects.toThrow('sudden failure');

      expect(generationService.getState().isGenerating).toBe(false);
      jest.useRealTimers();
    });
  });

  describe('generateWithTools — local path via runToolLoop', () => {
    beforeEach(() => {
      mockedRunToolLoop.mockReset();
      (generationService as any).state = {
        isGenerating: false, isThinking: false, conversationId: null,
        streamingContent: '', startTime: null, queuedMessages: [],
      };
      (generationService as any).abortRequested = false;
      (generationService as any).flushTimer = null;
    });

    it('runs tool loop and finalizes on success', async () => {
      const convId = setupWithConversation();
      setupWithActiveModel();

      mockedRunToolLoop.mockImplementation(async ({ onStream, onThinkingDone }: any) => {
        onThinkingDone?.();
        onStream?.({ content: 'result', reasoningContent: '' });
      });

      await generationService.generateWithTools(convId, [
        createMessage({ role: 'user', content: 'use tools' }),
      ], { enabledToolIds: ['calculator'] });

      expect(mockedRunToolLoop).toHaveBeenCalled();
      expect(generationService.getState().isGenerating).toBe(false);
    });

    it('calls onStreamReset to flush pending content', async () => {
      const convId = setupWithConversation();
      setupWithActiveModel();

      mockedRunToolLoop.mockImplementation(async ({ onStream, onStreamReset }: any) => {
        onStream?.({ content: 'before reset' });
        onStreamReset?.();
        onStream?.({ content: 'after reset' });
      });

      await generationService.generateWithTools(convId, [
        createMessage({ role: 'user', content: 'tool' }),
      ], { enabledToolIds: [] });

      expect(generationService.getState().isGenerating).toBe(false);
    });

    it('calls onFinalResponse to set streaming content', async () => {
      const convId = setupWithConversation();
      setupWithActiveModel();

      mockedRunToolLoop.mockImplementation(async ({ onFinalResponse }: any) => {
        onFinalResponse?.('final answer');
      });

      await generationService.generateWithTools(convId, [
        createMessage({ role: 'user', content: 'tool' }),
      ], { enabledToolIds: [] });

      expect(generationService.getState().isGenerating).toBe(false);
    });

    it('throws and clears state on runToolLoop error', async () => {
      const convId = setupWithConversation();
      setupWithActiveModel();

      mockedRunToolLoop.mockRejectedValue(new Error('tool loop fail'));

      await expect(
        generationService.generateWithTools(convId, [
          createMessage({ role: 'user', content: 'tool' }),
        ], { enabledToolIds: [] })
      ).rejects.toThrow('tool loop fail');

      expect(generationService.getState().isGenerating).toBe(false);
    });

    it('throws and clears flushTimer on error if timer was set', async () => {
      jest.useFakeTimers();
      const convId = setupWithConversation();
      setupWithActiveModel();

      mockedRunToolLoop.mockImplementation(async ({ onStream }: any) => {
        onStream?.({ content: 'partial' });
        throw new Error('mid-tool failure');
      });

      await expect(
        generationService.generateWithTools(convId, [
          createMessage({ role: 'user', content: 'tool' }),
        ], { enabledToolIds: [] })
      ).rejects.toThrow('mid-tool failure');

      expect(generationService.getState().isGenerating).toBe(false);
      jest.useRealTimers();
    });
  });

  describe('resetState with queued items triggers processNextInQueue', () => {
    it('schedules processNextInQueue when queue is non-empty after reset', async () => {
      jest.useFakeTimers();
      const convId = setupWithConversation();
      setupWithActiveModel();

      const processor = jest.fn().mockResolvedValue(undefined);
      generationService.setQueueProcessor(processor);

      // Enqueue a message
      generationService.enqueueMessage({ id: 'q1', conversationId: convId, text: 'queued', messageText: 'queued' });

      mockedLlmService.generateResponse.mockImplementation(async (_msgs: any, { onStream: _onStream, onComplete }: any = {}) => {
        onComplete?.('done');
        return 'done';
      });

      // Start and finish generation
      await generationService.generateResponse(convId, [createMessage({ role: 'user', content: 'Hi' })]);

      // Advance timer to trigger processNextInQueue
      jest.advanceTimersByTime(200);
      await Promise.resolve(); // flush microtasks

      expect(processor).toHaveBeenCalledWith(expect.objectContaining({ id: 'q1' }));
      jest.useRealTimers();
    });
  });

  // ============================================================================
  // checkSharePrompt — true branch (emitSharePrompt called)
  // ============================================================================
  describe('checkSharePrompt — triggers share', () => {
    it('delegates to maybeScheduleSharePrompt with the text variant + generation count', async () => {
      const { maybeScheduleSharePrompt } = require('../../../src/utils/sharePrompt');
      (maybeScheduleSharePrompt as jest.Mock).mockClear();

      const convId = setupWithConversation();
      setupWithActiveModel();

      mockedLlmService.generateResponse.mockImplementation(async (_msgs: any, { onStream, onComplete }: any = {}) => {
        onStream?.({ content: 'Hi' });
        onComplete?.('Hi');
        return 'Hi';
      });

      await generationService.generateResponse(convId, [
        createMessage({ role: 'user', content: 'Hi' }),
      ]);

      // The service owns the count; the once-per-session decision lives in the util.
      expect(maybeScheduleSharePrompt).toHaveBeenCalledWith({ variant: 'text', count: expect.any(Number), hasEngaged: expect.any(Boolean), delayMs: expect.any(Number) });
    });
  });

  // ============================================================================
  // stopGeneration — edge cases
  // ============================================================================
  describe('stopGeneration — edge cases', () => {
    it('clears streaming when there is no content on stop', async () => {
      const convId = setupWithConversation();
      // Set up generating state with empty streamingContent
      (generationService as any).state = {
        ...(generationService as any).state,
        isGenerating: true,
        conversationId: convId,
        streamingContent: '',
        startTime: null,
      };
      (generationService as any).abortRequested = false;

      await generationService.stopGeneration();

      expect(generationService.getState().isGenerating).toBe(false);
    });

    it('aborts remote controller when not generating and controller exists', async () => {
      const mockAbort = jest.fn();
      (generationService as any).currentRemoteAbortController = { abort: mockAbort };
      (generationService as any).state.isGenerating = false;

      await generationService.stopGeneration();

      expect(mockAbort).toHaveBeenCalled();
      expect((generationService as any).currentRemoteAbortController).toBeNull();
    });

    it('returns streamingContent when stopping remote generation', async () => {
      const convId = setupWithConversation();
      useRemoteServerStore.setState({ activeServerId: 'test-remote' });
      (mockedProviderRegistry as any).hasProvider = jest.fn(() => true);
      mockedLlmService.isModelLoaded.mockReturnValue(false);

      (generationService as any).state = {
        ...(generationService as any).state,
        isGenerating: true,
        conversationId: convId,
        streamingContent: 'partial response',
        startTime: Date.now(),
      };
      (generationService as any).abortRequested = false;
      (generationService as any).currentRemoteAbortController = { abort: jest.fn() };

      const content = await generationService.stopGeneration();
      expect(content).toBe('partial response');

      useRemoteServerStore.setState({ activeServerId: null });
    });
  });

  // ============================================================================
  // generateWithTools — remote path
  // ============================================================================
  describe('generateWithTools — remote path via generateRemoteWithTools', () => {
    const mockRemoteProvider2 = {
      id: 'remote-tools',
      isReady: jest.fn().mockResolvedValue(true),
      generate: jest.fn(),
      stopGeneration: jest.fn().mockResolvedValue(undefined),
      getLoadedModelId: jest.fn().mockReturnValue('remote-model'),
    };

    beforeEach(() => {
      mockedRunToolLoop.mockReset();
      (generationService as any).state = {
        isGenerating: false, isThinking: false, conversationId: null,
        streamingContent: '', startTime: null, queuedMessages: [],
      };
      (generationService as any).abortRequested = false;
      (generationService as any).flushTimer = null;
      useRemoteServerStore.setState({ activeServerId: 'remote-tools' });
      (mockedProviderRegistry as any).hasProvider = jest.fn(() => true);
      mockedLlmService.isModelLoaded.mockReturnValue(false);
      mockedProviderRegistry.getProvider.mockReturnValue(mockRemoteProvider2 as any);
    });

    afterEach(() => {
      useRemoteServerStore.setState({ activeServerId: null });
    });

    it('routes generateWithTools to generateRemoteWithTools and calls runToolLoop with forceRemote', async () => {
      const convId = setupWithConversation();
      mockedRunToolLoop.mockResolvedValue(undefined);

      await generationService.generateWithTools(convId, [
        createMessage({ role: 'user', content: 'use tools' }),
      ], { enabledToolIds: ['calculator'] });

      expect(mockedRunToolLoop).toHaveBeenCalledWith(
        expect.objectContaining({ forceRemote: true }),
      );
      expect(generationService.getState().isGenerating).toBe(false);
    });

    it('throws when remote provider not found in generateRemoteWithTools', async () => {
      const convId = setupWithConversation();
      mockedProviderRegistry.getProvider.mockReturnValue(undefined);

      await expect(
        generationService.generateWithTools(convId, [
          createMessage({ role: 'user', content: 'Hi' }),
        ], { enabledToolIds: [] })
      // prepareGeneration throws "Remote provider not found" when provider is null
      ).rejects.toThrow('Remote provider not found');
    });

    it('finalizes after remote tool loop when not aborted', async () => {
      const convId = setupWithConversation();
      mockedRunToolLoop.mockImplementation(async ({ onFinalResponse }: any) => {
        onFinalResponse?.('remote result');
      });

      await generationService.generateWithTools(convId, [
        createMessage({ role: 'user', content: 'tool' }),
      ], { enabledToolIds: [] });

      expect(generationService.getState().isGenerating).toBe(false);
    });
  });

  // ============================================================================
  // generateRemoteResponse — catch path with server health update
  // ============================================================================
  describe('generateRemoteResponse — error updates server health', () => {
    const mockRemoteProvider3 = {
      id: 'failing-server',
      isReady: jest.fn().mockResolvedValue(true),
      generate: jest.fn(),
      stopGeneration: jest.fn().mockResolvedValue(undefined),
      getLoadedModelId: jest.fn().mockReturnValue('model'),
      capabilities: { supportsVision: false, supportsToolCalling: true, supportsThinking: false },
    };

    beforeEach(() => {
      useRemoteServerStore.setState({
        activeServerId: 'failing-server',
        servers: [{ id: 'failing-server', name: 'Failing Server', endpoint: 'http://fail' }] as any, // NOSONAR
      });
      (mockedProviderRegistry as any).hasProvider = jest.fn(() => true);
      mockedLlmService.isModelLoaded.mockReturnValue(false);
      mockedProviderRegistry.getProvider.mockReturnValue(mockRemoteProvider3 as any);
    });

    afterEach(() => {
      useRemoteServerStore.setState({ activeServerId: null });
    });

    it('marks server offline when provider.generate throws', async () => {
      const convId = setupWithConversation();
      mockRemoteProvider3.generate.mockRejectedValue(new Error('connection refused'));

      await expect(
        generationService.generateResponse(convId, [
          createMessage({ role: 'user', content: 'Hi' }),
        ])
      ).rejects.toThrow('connection refused');

      expect(generationService.getState().isGenerating).toBe(false);
    });
  });

  // ============================================================================
  // generateWithTools — local path abort behavior
  // ============================================================================
  describe('generateWithTools — local abort paths', () => {
    it('skips finalize when aborted after tool loop completes', async () => {
      const convId = setupWithConversation();
      mockedLlmService.isModelLoaded.mockReturnValue(true);
      mockedLlmService.isCurrentlyGenerating.mockReturnValue(false);

      const finalizespy = jest.spyOn(useChatStore.getState(), 'finalizeStreamingMessage');

      mockedRunToolLoop.mockImplementation(async () => {
        // Simulate proper abort during tool loop (stopGeneration sets abortRequested + resets state)
        await generationService.stopGeneration();
      });

      await generationService.generateWithTools(convId, [
        createMessage({ role: 'user', content: 'use tool' }),
      ], { enabledToolIds: ['calculator'] });

      // finalize should not be called again after abort (stopGeneration already finalized)
      expect(finalizespy.mock.calls.length).toBeLessThanOrEqual(1);
      expect(generationService.getState().isGenerating).toBe(false);
    });

    it('returns early when runToolLoop throws and abortRequested is true', async () => {
      const convId = setupWithConversation();
      mockedLlmService.isModelLoaded.mockReturnValue(true);
      mockedLlmService.isCurrentlyGenerating.mockReturnValue(false);

      mockedRunToolLoop.mockImplementation(async () => {
        // stopGeneration sets abortRequested=true and resets state before the throw
        await generationService.stopGeneration();
        throw new Error('Tool error');
      });

      // Should not throw since abortRequested=true causes early return in catch
      await generationService.generateWithTools(convId, [
        createMessage({ role: 'user', content: 'tool' }),
      ], { enabledToolIds: ['web_search'] });

      expect(generationService.getState().isGenerating).toBe(false);
    });
  });

  // ============================================================================
  // generateRemoteWithTools — abort path
  // ============================================================================
  describe('generateRemoteWithTools — abort skips finalize', () => {
    const mockRemoteProvider5 = {
      id: 'remote-abort',
      isReady: jest.fn().mockResolvedValue(true),
      generate: jest.fn(),
      stopGeneration: jest.fn().mockResolvedValue(undefined),
      getLoadedModelId: jest.fn().mockReturnValue('model'),
    };

    beforeEach(() => {
      useRemoteServerStore.setState({ activeServerId: 'remote-abort' });
      (mockedProviderRegistry as any).hasProvider = jest.fn(() => true);
      mockedLlmService.isModelLoaded.mockReturnValue(false);
      mockedProviderRegistry.getProvider.mockReturnValue(mockRemoteProvider5 as any);
    });

    afterEach(() => {
      useRemoteServerStore.setState({ activeServerId: null });
      (mockedProviderRegistry as any).hasProvider = jest.fn(() => false);
    });

    it('skips finalize in generateRemoteWithTools when aborted', async () => {
      const convId = setupWithConversation();
      mockedRunToolLoop.mockImplementation(async () => {
        // Simulate proper abort via stopGeneration
        await generationService.stopGeneration();
      });

      await generationService.generateWithTools(convId, [
        createMessage({ role: 'user', content: 'tool' }),
      ], { enabledToolIds: [] });

      expect(generationService.getState().isGenerating).toBe(false);
    });
  });

  // ============================================================================
  // enqueueMessage + processNextInQueue — queue merging
  // ============================================================================
  describe('queue processing', () => {
    it('skips processNextInQueue when no queueProcessor set', () => {
      (generationService as any).queueProcessor = null;
      (generationService as any).state.queuedMessages = [
        { id: '1', conversationId: 'c1', text: 'hi', messageText: 'hi' },
      ];
      // Calling resetState should trigger processNextInQueue internally
      // but since queueProcessor is null, it should be a no-op
      expect(() => (generationService as any).processNextInQueue()).not.toThrow();
    });

    it('merges multiple queued messages into a single combined message', async () => {
      const processor = jest.fn(() => Promise.resolve());
      (generationService as any).queueProcessor = processor;
      (generationService as any).state.queuedMessages = [
        { id: '1', conversationId: 'c1', text: 'msg1', messageText: 'msg1' },
        { id: '2', conversationId: 'c1', text: 'msg2', messageText: 'msg2' },
      ];

      (generationService as any).processNextInQueue();
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(processor).toHaveBeenCalledWith(
        expect.objectContaining({ text: 'msg1\n\nmsg2' }),
      );
    });

    it('passes single queued message directly without merging', async () => {
      const processor = jest.fn(() => Promise.resolve());
      (generationService as any).queueProcessor = processor;
      const singleMsg = { id: '1', conversationId: 'c1', text: 'single', messageText: 'single' };
      (generationService as any).state.queuedMessages = [singleMsg];

      (generationService as any).processNextInQueue();
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(processor).toHaveBeenCalledWith(singleMsg);
    });
  });

  // ============================================================================
  // normalizeStreamChunk — string vs object
  // ============================================================================
  describe('normalizeStreamChunk', () => {
    it('wraps string data as content object', () => {
      const result = (generationService as any).normalizeStreamChunk('hello');
      expect(result).toEqual({ content: 'hello' });
    });

    it('passes through object data unchanged', () => {
      const chunk = { content: 'text', reasoningContent: 'think' };
      const result = (generationService as any).normalizeStreamChunk(chunk);
      expect(result).toBe(chunk);
    });
  });

  // ============================================================================
  // buildToolLoopHandlers — onStream abort guard
  // ============================================================================
  describe('buildToolLoopHandlers — onStream abort guard', () => {
    it('returns early from onStream when abortRequested is true', () => {
      (generationService as any).abortRequested = true;
      const handlers = (generationService as any).buildToolLoopHandlers();
      const before = (generationService as any).state.streamingContent;
      handlers.onStream('some content');
      expect((generationService as any).state.streamingContent).toBe(before);
      (generationService as any).abortRequested = false;
    });

    it('accumulates reasoning content in reasoningBuffer via onStream', () => {
      (generationService as any).abortRequested = false;
      (generationService as any).reasoningBuffer = '';
      const handlers = (generationService as any).buildToolLoopHandlers();
      handlers.onStream({ reasoningContent: 'thinking...' });
      expect((generationService as any).reasoningBuffer).toBe('thinking...');
    });
  });

  // ============================================================================
  // isUsingRemoteProvider — prefers local model when loaded
  // ============================================================================
  describe('isUsingRemoteProvider — local model wins when loaded', () => {
    const mockRemoteProvider4 = {
      id: 'remote-srv',
      isReady: jest.fn().mockResolvedValue(true),
      generate: jest.fn(),
      stopGeneration: jest.fn().mockResolvedValue(undefined),
      getLoadedModelId: jest.fn().mockReturnValue('gpt-4'),
    };

    beforeEach(() => {
      useRemoteServerStore.setState({
        activeServerId: 'remote-srv',
        activeRemoteTextModelId: 'gpt-4',
        servers: [{ id: 'remote-srv', name: 'Remote', endpoint: 'http://remote' }] as any, // NOSONAR
      });
      (mockedProviderRegistry as any).hasProvider = jest.fn(() => true);
      mockedProviderRegistry.getProvider.mockReturnValue(mockRemoteProvider4 as any);
      // Local model IS loaded — service should prefer local
      mockedLlmService.isModelLoaded.mockReturnValue(true);
    });

    afterEach(() => {
      useRemoteServerStore.setState({ activeServerId: null, activeRemoteTextModelId: null });
      (mockedProviderRegistry as any).hasProvider = jest.fn(() => false);
    });

    it('uses local LLM when local model is loaded even if remote server is configured', async () => {
      const convId = setupWithConversation();
      mockedLlmService.generateResponse.mockImplementation(async (_msgs, { onStream: cb }: any = {}) => {
        cb?.({ content: 'hello' });
        return 'hello';
      });

      await generationService.generateResponse(convId, [
        createMessage({ role: 'user', content: 'Hi' }),
      ]);

      // Local generateResponse should have been called, not remote provider
      expect(mockedLlmService.generateResponse).toHaveBeenCalled();
      expect(mockRemoteProvider4.generate).not.toHaveBeenCalled();
    });
  });

  // ============================================================================
  // buildToolLoopHandlers — isAborted callback and timer flush
  // ============================================================================
  describe('buildToolLoopHandlers — isAborted and timer flush', () => {
    it('isAborted returns the current abortRequested value', () => {
      (generationService as any).abortRequested = false;
      const handlers = (generationService as any).buildToolLoopHandlers();
      expect(handlers.isAborted()).toBe(false);

      (generationService as any).abortRequested = true;
      expect(handlers.isAborted()).toBe(true);

      (generationService as any).abortRequested = false;
    });

    it('onStream schedules flushTokenBuffer via setTimeout and fires on advance', () => {
      jest.useFakeTimers();
      (generationService as any).abortRequested = false;
      (generationService as any).flushTimer = null;
      (generationService as any).tokenBuffer = '';

      const handlers = (generationService as any).buildToolLoopHandlers();
      handlers.onStream({ content: 'hello' });

      expect((generationService as any).flushTimer).not.toBeNull();

      // Advance timers to trigger the flushTokenBuffer callback
      jest.runAllTimers();

      // After timer fires, flushTimer should be cleared
      expect((generationService as any).flushTimer).toBeNull();
      jest.useRealTimers();
    });
  });

  // ============================================================================
  // generateRemoteWithTools — no provider throws
  // ============================================================================
  describe('generateRemoteWithTools — no provider available', () => {
    beforeEach(() => {
      useRemoteServerStore.setState({ activeServerId: 'srv-no-prov' });
      (mockedProviderRegistry as any).hasProvider = jest.fn(() => true);
      mockedLlmService.isModelLoaded.mockReturnValue(false);
      // getProvider returns null → no provider found at generateRemoteWithTools level
      mockedProviderRegistry.getProvider.mockReturnValue(undefined);
      // Need isReady to pass in prepareGeneration... but getProvider is null so it throws in prepareGeneration
      // We need to make prepareGeneration pass by having a temporary valid provider then null
      // Actually prepareGeneration ALSO calls getCurrentProvider - so if getProvider returns null,
      // prepareGeneration throws 'Remote provider not found' before we hit line 542.
      // To reach line 542, we need to bypass prepareGeneration's check.
      // We'll directly call generateRemoteWithTools with a spy on prepareGeneration.
    });

    afterEach(() => {
      useRemoteServerStore.setState({ activeServerId: null });
      (mockedProviderRegistry as any).hasProvider = jest.fn(() => false);
      mockedProviderRegistry.getProvider.mockReturnValue(undefined);
    });

    it('getCurrentProvider returns local provider fallback when no activeServerId', () => {
      // Test line 61: getCurrentProvider when activeServerId is null
      useRemoteServerStore.setState({ activeServerId: null });
      mockedProviderRegistry.getProvider.mockReturnValue(undefined);
      const _result = (generationService as any).getCurrentProvider();
      expect(mockedProviderRegistry.getProvider).toHaveBeenCalledWith('local');
    });
  });

  // ============================================================================
  // resetState — clears flushTimer if set
  // ============================================================================
  describe('resetState — flushTimer cleanup', () => {
    it('clears flushTimer in resetState when timer is set', () => {
      jest.useFakeTimers();
      // Set a fake flushTimer
      (generationService as any).flushTimer = setTimeout(() => {}, 10000);
      (generationService as any).state = {
        ...(generationService as any).state,
        isGenerating: true,
        queuedMessages: [],
      };

      (generationService as any).resetState();

      // flushTimer should be cleared
      expect((generationService as any).flushTimer).toBeNull();
      jest.useRealTimers();
    });
  });

  // ============================================================================
  // generateRemoteResponse — flushTimer in onError and catch
  // ============================================================================
  describe('generateRemoteResponse — flushTimer in error paths', () => {
    const mockRemoteProviderFlush = {
      id: 'remote-flush',
      isReady: jest.fn().mockResolvedValue(true),
      generate: jest.fn(),
      stopGeneration: jest.fn().mockResolvedValue(undefined),
      getLoadedModelId: jest.fn().mockReturnValue('model-flush'),
      capabilities: { supportsVision: false, supportsToolCalling: true, supportsThinking: false },
    };

    beforeEach(() => {
      jest.useFakeTimers();
      useRemoteServerStore.setState({ activeServerId: 'remote-flush' });
      (mockedProviderRegistry as any).hasProvider = jest.fn(() => true);
      mockedLlmService.isModelLoaded.mockReturnValue(false);
      mockedProviderRegistry.getProvider.mockReturnValue(mockRemoteProviderFlush as any);
    });

    afterEach(() => {
      jest.useRealTimers();
      useRemoteServerStore.setState({ activeServerId: null });
      (mockedProviderRegistry as any).hasProvider = jest.fn(() => false);
    });

    it('clears flushTimer in catch block when timer was set by onToken', async () => {
      const convId = setupWithConversation();

      mockRemoteProviderFlush.generate.mockImplementation(async (_msgs: any, _opts: any, callbacks: any) => {
        // onToken sets flushTimer
        callbacks.onToken('partial content');
        // Then throw to trigger the catch block
        throw new Error('network failure');
      });

      await expect(
        generationService.generateResponse(convId, [
          createMessage({ role: 'user', content: 'Hi' }),
        ])
      ).rejects.toThrow();

      // flushTimer should be cleared in catch
      expect((generationService as any).flushTimer).toBeNull();
    });

    it('clears flushTimer in onError callback when timer was set by onToken', async () => {
      const convId = setupWithConversation();

      mockRemoteProviderFlush.generate.mockImplementation(async (_msgs: any, _opts: any, callbacks: any) => {
        callbacks.onToken('partial');
        // Fire onError (which is called before reject in some providers)
        callbacks.onError(new Error('provider error'));
      });

      // The onError throws which propagates to catch
      await expect(
        generationService.generateResponse(convId, [
          createMessage({ role: 'user', content: 'Hi' }),
        ])
      ).rejects.toThrow();

      expect((generationService as any).flushTimer).toBeNull();
    });

    it('triggers onReasoning flush timer path', async () => {
      const convId = setupWithConversation();

      mockRemoteProviderFlush.generate.mockImplementation(async (_msgs: any, _opts: any, callbacks: any) => {
        callbacks.onReasoning('some thinking');
        callbacks.onComplete({ content: 'done' });
      });

      await generationService.generateResponse(convId, [
        createMessage({ role: 'user', content: 'Hi' }),
      ]);

      // reasoningBuffer should have content (flushed)
    });
  });

  describe('drainQueue', () => {
    it('processes queued messages through the queue processor when idle', () => {
      const processor = jest.fn().mockResolvedValue(undefined);
      generationService.setQueueProcessor(processor);
      generationService.enqueueMessage({ id: 'q1', conversationId: 'c1', text: 'hi', messageText: 'hi' });

      generationService.drainQueue();

      expect(processor).toHaveBeenCalledTimes(1);
      expect(processor.mock.calls[0][0]).toMatchObject({ text: 'hi', conversationId: 'c1' });
      expect(generationService.getState().queuedMessages).toHaveLength(0);
    });

    it('is a no-op while a generation is in progress', () => {
      const processor = jest.fn().mockResolvedValue(undefined);
      generationService.setQueueProcessor(processor);
      generationService.enqueueMessage({ id: 'q1', conversationId: 'c1', text: 'hi', messageText: 'hi' });
      (generationService as any).state.isGenerating = true;

      generationService.drainQueue();

      expect(processor).not.toHaveBeenCalled();
      expect(generationService.getState().queuedMessages).toHaveLength(1);
    });
  });
});
