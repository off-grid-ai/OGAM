/**
 * Integration Tests: Generation Flow
 *
 * Tests the integration between:
 * - generationService ↔ llmService (token callbacks, generation lifecycle)
 * - generationService ↔ useChatStore (streaming message updates)
 *
 * These tests verify that the services work together correctly,
 * not just that they work in isolation.
 */

import { useAppStore } from '../../../src/stores/appStore';
import { generationService } from '../../../src/services/generationService';
import { llmService } from '../../../src/services/llm';
import { liteRTService } from '../../../src/services/litert';
import { activeModelService } from '../../../src/services/activeModelService';
import {
  resetStores,
  setupWithActiveModel,
  setupWithConversation,
  flushPromises,
  wait,
  getChatState,
  collectSubscriptionValues,
} from '../../utils/testHelpers';
import { createMessage, createDownloadedModel } from '../../utils/factories';

// Mock the services
jest.mock('../../../src/services/llm');
jest.mock('../../../src/services/litert');
jest.mock('../../../src/services/activeModelService');

const mockLlmService = llmService as jest.Mocked<typeof llmService>;
const mockLiteRTService = liteRTService as jest.Mocked<typeof liteRTService>;
const mockActiveModelService = activeModelService as jest.Mocked<typeof activeModelService>;

describe('Generation Flow Integration', () => {
  beforeEach(async () => {
    resetStores();
    jest.clearAllMocks();

    // Setup default mock implementations
    mockLlmService.isModelLoaded.mockReturnValue(true);
    mockLlmService.getLoadedModelPath.mockReturnValue('/mock/path/model.gguf');
    mockLlmService.getGpuInfo.mockReturnValue({
      gpu: false,
      gpuBackend: 'CPU',
      gpuLayers: 0,
      reasonNoGPU: '',
    });
    mockLlmService.getPerformanceStats.mockReturnValue({
      lastTokensPerSecond: 15.5,
      lastDecodeTokensPerSecond: 18.2,
      lastTimeToFirstToken: 0.5,
      lastGenerationTime: 5.0,
      lastTokenCount: 100,
    });
    mockLlmService.stopGeneration.mockResolvedValue();
    mockLiteRTService.isModelLoaded.mockReturnValue(false);
    mockLiteRTService.stopGeneration.mockResolvedValue();
    mockLiteRTService.sendMessage.mockResolvedValue();

    mockActiveModelService.getActiveModels.mockReturnValue({
      text: { model: null, isLoaded: true, isLoading: false },
      image: { model: null, isLoaded: false, isLoading: false },
    });

    // Reset generationService state by stopping any in-progress generation
    // This ensures clean state between tests
    await generationService.stopGeneration().catch(() => {});
  });

  describe('generationService → llmService Token Flow', () => {
    it('should stream tokens from llmService to generationService state', async () => {
      const modelId = setupWithActiveModel();
      const conversationId = setupWithConversation({ modelId });

      const tokens = ['Hello', ' ', 'world', '!'];
      let streamCallback: any = null;
      let completeCallback: any = null;

      mockLlmService.generateResponse.mockImplementation(
        async (_messages, onStream, onComplete) => {
          streamCallback = onStream!;
          completeCallback = onComplete!;
          return 'Hello world!';
        }
      );

      // Start generation
      const messages = [createMessage({ role: 'user', content: 'Hi' })];
      const generatePromise = generationService.generateResponse(conversationId, messages);

      // Give time for setup
      await flushPromises();

      // Verify generation started
      expect(generationService.getState().isGenerating).toBe(true);
      expect(generationService.getState().conversationId).toBe(conversationId);

      // Stream tokens
      for (const token of tokens) {
        streamCallback?.(token);
        await flushPromises();
      }

      // Verify streaming content accumulated
      expect(generationService.getState().streamingContent).toBe('Hello world!');

      // Complete generation
      completeCallback?.('');
      await generatePromise;

      // Verify state reset
      expect(generationService.getState().isGenerating).toBe(false);
      expect(generationService.getState().streamingContent).toBe('');
    });

    it('should call onFirstToken callback when first token arrives', async () => {
      const modelId = setupWithActiveModel();
      const conversationId = setupWithConversation({ modelId });

      let streamCallback: any = null;
      let completeCallback: any = null;

      mockLlmService.generateResponse.mockImplementation(
        async (_messages, onStream, onComplete) => {
          streamCallback = onStream!;
          completeCallback = onComplete!;
          return 'Test';
        }
      );

      const onFirstToken = jest.fn();
      const messages = [createMessage({ role: 'user', content: 'Hi' })];
      const generatePromise = generationService.generateResponse(conversationId, messages, onFirstToken);

      await flushPromises();

      // First token should trigger callback
      streamCallback?.('First');
      await flushPromises();
      expect(onFirstToken).toHaveBeenCalledTimes(1);

      // Second token should not trigger callback again
      streamCallback?.(' token');
      await flushPromises();
      expect(onFirstToken).toHaveBeenCalledTimes(1);

      completeCallback?.('');
      await generatePromise;
    });

    it('should transition isThinking from true to false on first token', async () => {
      const modelId = setupWithActiveModel();
      const conversationId = setupWithConversation({ modelId });

      let streamCallback: any = null;
      let completeCallback: any = null;

      mockLlmService.generateResponse.mockImplementation(
        async (_messages, onStream, onComplete) => {
          streamCallback = onStream!;
          completeCallback = onComplete!;
          return 'Test';
        }
      );

      const messages = [createMessage({ role: 'user', content: 'Hi' })];
      const generatePromise = generationService.generateResponse(conversationId, messages);

      await flushPromises();

      // Initially should be thinking
      expect(generationService.getState().isThinking).toBe(true);

      // First token should stop thinking
      streamCallback?.('Hello');
      await flushPromises();
      expect(generationService.getState().isThinking).toBe(false);

      completeCallback?.('');
      await generatePromise;
    });
  });

  describe('generationService → chatStore Streaming Updates', () => {
    it('should update chatStore streaming state when generation starts', async () => {
      const modelId = setupWithActiveModel();
      const conversationId = setupWithConversation({ modelId });

      let completeCallback: any = null;

      mockLlmService.generateResponse.mockImplementation(
        async (_messages, _onStream, onComplete) => {
          completeCallback = onComplete!;
          return 'Test';
        }
      );

      const messages = [createMessage({ role: 'user', content: 'Hi' })];
      const generatePromise = generationService.generateResponse(conversationId, messages);

      await flushPromises();

      // Check chatStore streaming state
      const chatState = getChatState();
      expect(chatState.streamingForConversationId).toBe(conversationId);
      expect(chatState.isThinking).toBe(true);

      completeCallback?.('');
      await generatePromise;
    });

    it('should append tokens to chatStore streamingMessage', async () => {
      const modelId = setupWithActiveModel();
      const conversationId = setupWithConversation({ modelId });

      let streamCallback: any = null;
      let completeCallback: any = null;

      mockLlmService.generateResponse.mockImplementation(
        async (_messages, onStream, onComplete) => {
          streamCallback = onStream!;
          completeCallback = onComplete!;
          return 'Hello world';
        }
      );

      const messages = [createMessage({ role: 'user', content: 'Hi' })];
      const generatePromise = generationService.generateResponse(conversationId, messages);

      await flushPromises();

      // Stream tokens (need wait(60) to allow 50ms token buffer flush)
      streamCallback?.('Hello');
      await wait(60);
      expect(getChatState().streamingMessage).toBe('Hello');

      streamCallback?.(' world');
      await wait(60);
      expect(getChatState().streamingMessage).toBe('Hello world');

      completeCallback?.('');
      await generatePromise;
    });

    it('should finalize message in chatStore when generation completes', async () => {
      const modelId = setupWithActiveModel();
      const conversationId = setupWithConversation({ modelId });

      // Setup app store with the model for metadata
      const model = createDownloadedModel({ id: modelId, name: 'Test Model' });
      useAppStore.setState({
        downloadedModels: [model],
        activeModelId: modelId,
      });

      let streamCallback: any = null;
      let completeCallback: any = null;

      mockLlmService.generateResponse.mockImplementation(
        async (_messages, onStream, onComplete) => {
          streamCallback = onStream!;
          completeCallback = onComplete!;
          return 'Complete response';
        }
      );

      const messages = [createMessage({ role: 'user', content: 'Hi' })];
      const generatePromise = generationService.generateResponse(conversationId, messages);

      await flushPromises();

      // Stream complete response
      streamCallback?.('Complete response');
      await flushPromises();

      // Complete generation
      completeCallback?.('');
      await generatePromise;

      // Verify message was finalized
      const chatState = getChatState();
      expect(chatState.streamingMessage).toBe('');
      expect(chatState.streamingForConversationId).toBe(null);
      expect(chatState.isStreaming).toBe(false);

      // Verify assistant message was added
      const conversation = chatState.conversations.find(c => c.id === conversationId);
      expect(conversation?.messages).toHaveLength(1);
      expect(conversation?.messages[0].role).toBe('assistant');
      expect(conversation?.messages[0].content).toBe('Complete response');
    });

    it('should include generation metadata when finalizing message', async () => {
      const modelId = setupWithActiveModel();
      const conversationId = setupWithConversation({ modelId });

      const model = createDownloadedModel({ id: modelId, name: 'Test Model' });
      useAppStore.setState({
        downloadedModels: [model],
        activeModelId: modelId,
      });

      mockLlmService.getGpuInfo.mockReturnValue({
        gpu: true,
        gpuBackend: 'Metal',
        gpuLayers: 32,
        reasonNoGPU: '',
      });

      mockLlmService.getPerformanceStats.mockReturnValue({
        lastTokensPerSecond: 25.5,
        lastDecodeTokensPerSecond: 30.2,
        lastTimeToFirstToken: 0.3,
        lastGenerationTime: 3.0,
        lastTokenCount: 75,
      });

      let streamCallback: any = null;
      let completeCallback: any = null;

      mockLlmService.generateResponse.mockImplementation(
        async (_messages, onStream, onComplete) => {
          streamCallback = onStream!;
          completeCallback = onComplete!;
          return 'Response';
        }
      );

      const messages = [createMessage({ role: 'user', content: 'Hi' })];
      const generatePromise = generationService.generateResponse(conversationId, messages);

      await flushPromises();
      streamCallback?.('Response');
      await flushPromises();
      completeCallback?.('');
      await generatePromise;

      const chatState = getChatState();
      const conversation = chatState.conversations.find(c => c.id === conversationId);
      const assistantMessage = conversation?.messages[0];

      expect(assistantMessage?.generationMeta).toBeDefined();
      expect(assistantMessage?.generationMeta?.gpu).toBe(true);
      expect(assistantMessage?.generationMeta?.gpuBackend).toBe('Metal');
      expect(assistantMessage?.generationMeta?.tokensPerSecond).toBe(25.5);
      expect(assistantMessage?.generationMeta?.modelName).toBe('Test Model');
    });

    it('should clear streaming message on error', async () => {
      const modelId = setupWithActiveModel();
      const conversationId = setupWithConversation({ modelId });

      mockLlmService.generateResponse.mockImplementation(
        async (_messages, _onStream, _onComplete) => {
          throw new Error('Generation failed');
        }
      );

      const messages = [createMessage({ role: 'user', content: 'Hi' })];

      await expect(
        generationService.generateResponse(conversationId, messages)
      ).rejects.toThrow('Generation failed');

      // Verify streaming state was cleared
      const chatState = getChatState();
      expect(chatState.streamingMessage).toBe('');
      expect(chatState.streamingForConversationId).toBe(null);
      expect(chatState.isStreaming).toBe(false);
    });
  });

  describe('generationService → LiteRT image flow', () => {
    it('passes multiple image attachments to LiteRT for LiteRT models', async () => {
      const model = {
        id: 'litert-1',
        name: 'LiteRT Model',
        author: 'Test',
        filePath: '/mock/path/model.litertlm',
        fileName: 'model.litertlm',
        fileSize: 1024,
        quantization: 'mixed',
        downloadedAt: '2026-01-01T00:00:00.000Z',
        engine: 'litert' as const,
        liteRTVision: true,
      };
      const conversationId = setupWithConversation({ modelId: model.id });
      useAppStore.setState({
        downloadedModels: [model],
        activeModelId: model.id,
      });

      mockLlmService.isModelLoaded.mockReturnValue(false);
      mockLiteRTService.isModelLoaded.mockReturnValue(true);

      const messages = [createMessage({
        role: 'user',
        content: 'What is different?',
        attachments: [
          { id: 'img-1', type: 'image', uri: 'file:///one.png' },
          { id: 'img-2', type: 'image', uri: 'file:///two.png' },
        ],
      } as any)];

      const generatePromise = generationService.generateResponse(conversationId, messages);
      await flushPromises();

      expect(mockLiteRTService.sendMessage).toHaveBeenCalledWith(
        'What is different?',
        expect.objectContaining({
          onToken: expect.any(Function),
          onReasoning: expect.any(Function),
          onComplete: expect.any(Function),
          onError: expect.any(Function),
        }),
        { imageUris: ['file:///one.png', 'file:///two.png'], audioUris: [] },
      );

      const [, callbacks] = mockLiteRTService.sendMessage.mock.calls[0];
      (callbacks as any).onComplete('Done', '', undefined);
      await generatePromise;
    });
  });

  describe('Generation Lifecycle', () => {
    it('should prevent concurrent generations by returning early', async () => {
      const modelId = setupWithActiveModel();
      const conversationId = setupWithConversation({ modelId });

      mockLlmService.generateResponse.mockImplementation(
        async (_messages) => {
          // Never complete automatically - simulates ongoing generation
          return new Promise(() => {});
        }
      );

      const messages = [createMessage({ role: 'user', content: 'Hi' })];

      // Start first generation
      generationService.generateResponse(conversationId, messages);
      await flushPromises();

      // Verify first generation is running
      expect(generationService.getState().isGenerating).toBe(true);

      // Try to start second generation - should return immediately without error
      const secondResult = await generationService.generateResponse(conversationId, messages);

      // Second call should resolve with undefined (silent no-op)
      expect(secondResult).toBeUndefined();

      // llmService.generateResponse should only be called once
      expect(mockLlmService.generateResponse).toHaveBeenCalledTimes(1);

      // First generation should still be running unaffected
      expect(generationService.getState().isGenerating).toBe(true);
      expect(generationService.getState().conversationId).toBe(conversationId);
    });

    it('should throw if no model is loaded', async () => {
      const conversationId = setupWithConversation();

      // Model is not loaded
      mockLlmService.isModelLoaded.mockReturnValue(false);

      const messages = [createMessage({ role: 'user', content: 'Hi' })];

      // The service checks isModelLoaded and throws if false
      let thrownError: Error | null = null;
      try {
        await generationService.generateResponse(conversationId, messages);
      } catch (error) {
        thrownError = error as Error;
      }

      expect(thrownError).not.toBeNull();
      expect(thrownError?.message).toBe('No model loaded');
    });

    it('should handle stopGeneration correctly', async () => {
      const modelId = setupWithActiveModel();
      const conversationId = setupWithConversation({ modelId });

      let streamCallback: any = null;

      mockLlmService.generateResponse.mockImplementation(
        async (_messages, onStream) => {
          streamCallback = onStream!;
          // Simulate long running generation by returning a never-resolving promise
          await new Promise(() => {});
          return 'never reached';
        }
      );

      const messages = [createMessage({ role: 'user', content: 'Hi' })];

      // Start generation (don't await - it never completes)
      generationService.generateResponse(conversationId, messages);

      // Wait for generation to start
      await flushPromises();

      // Verify generation started
      expect(generationService.getState().isGenerating).toBe(true);

      // Stream some content - this updates the service's internal streamingContent
      streamCallback?.('Partial');
      await flushPromises();
      streamCallback?.(' response');
      await flushPromises();

      // Verify content was streamed
      expect(generationService.getState().streamingContent).toBe('Partial response');

      // Stop generation - should return the accumulated content
      const partialContent = await generationService.stopGeneration();

      expect(partialContent).toBe('Partial response');
      expect(mockLlmService.stopGeneration).toHaveBeenCalled();
      expect(generationService.getState().isGenerating).toBe(false);
    });

    it('should save partial response when stopped with content', async () => {
      const modelId = setupWithActiveModel();
      const conversationId = setupWithConversation({ modelId });

      const model = createDownloadedModel({ id: modelId, name: 'Test Model' });
      useAppStore.setState({
        downloadedModels: [model],
        activeModelId: modelId,
      });

      let streamCallback: any = null;

      mockLlmService.generateResponse.mockImplementation(
        async (_messages, onStream) => {
          streamCallback = onStream!;
          return new Promise(() => {});
        }
      );

      const messages = [createMessage({ role: 'user', content: 'Hi' })];
      generationService.generateResponse(conversationId, messages);

      await flushPromises();

      // Stream some content
      streamCallback?.('Partial response here');
      await flushPromises();

      // Stop generation
      await generationService.stopGeneration();

      // Verify partial response was saved
      const chatState = getChatState();
      const conversation = chatState.conversations.find(c => c.id === conversationId);
      expect(conversation?.messages).toHaveLength(1);
      expect(conversation?.messages[0].content).toBe('Partial response here');
    });

    it('should not save message when stopped with empty content', async () => {
      const modelId = setupWithActiveModel();
      const conversationId = setupWithConversation({ modelId });

      mockLlmService.generateResponse.mockImplementation(
        async (_messages) => {
          return new Promise(() => {});
        }
      );

      const messages = [createMessage({ role: 'user', content: 'Hi' })];
      generationService.generateResponse(conversationId, messages);

      await flushPromises();

      // Stop without any tokens streamed
      await generationService.stopGeneration();

      // Verify no message was saved
      const chatState = getChatState();
      const conversation = chatState.conversations.find(c => c.id === conversationId);
      expect(conversation?.messages).toHaveLength(0);
    });
  });

  describe('State Subscription', () => {
    it('should notify subscribers of state changes', async () => {
      const modelId = setupWithActiveModel();
      const conversationId = setupWithConversation({ modelId });

      let streamCallback: any = null;
      let completeCallback: any = null;

      mockLlmService.generateResponse.mockImplementation(
        async (_messages, onStream, onComplete) => {
          streamCallback = onStream!;
          completeCallback = onComplete!;
          return 'Test';
        }
      );

      const { values, unsubscribe } = collectSubscriptionValues(
        (listener) => generationService.subscribe(listener)
      );

      const messages = [createMessage({ role: 'user', content: 'Hi' })];
      const generatePromise = generationService.generateResponse(conversationId, messages);

      await flushPromises();
      streamCallback?.('Token');
      await wait(60);
      completeCallback?.('');
      await generatePromise;

      unsubscribe();

      // Should have received multiple state updates
      expect(values.length).toBeGreaterThan(1);

      // First update after initial state should show generating
      const generatingState = values.find((v: any) => v.isGenerating);
      expect(generatingState).toBeDefined();

      // Tokens are accumulated internally without notifying subscribers
      // (by design, to avoid flooding the JS thread). Verify that
      // the thinking→streaming transition was notified instead.
      const streamingState = values.find((v: any) => v.isGenerating && !v.isThinking);
      expect(streamingState).toBeDefined();

      // Last state should be idle
      const lastState: any = values[values.length - 1];
      expect(lastState.isGenerating).toBe(false);
    });
  });
});
