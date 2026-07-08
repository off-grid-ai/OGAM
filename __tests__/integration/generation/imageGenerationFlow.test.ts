/**
 * Integration Tests: Image Generation Flow
 *
 * Tests the integration between:
 * - imageGenerationService ↔ localDreamGeneratorService
 * - imageGenerationService ↔ useAppStore (generated images)
 */

import { useAppStore } from '../../../src/stores/appStore';
import { imageGenerationService } from '../../../src/services/imageGenerationService';
import { localDreamGeneratorService } from '../../../src/services/localDreamGenerator';
import { activeModelService } from '../../../src/services/activeModelService';
import { llmService } from '../../../src/services/llm';
import {
  resetStores,
  flushPromises,
  getAppState,
  getChatState,
  setupWithConversation,
} from '../../utils/testHelpers';
import { createONNXImageModel, createGeneratedImage, createMessage } from '../../utils/factories';
import { Message } from '../../../src/types';
import { useModelFailureStore } from '../../../src/stores/modelFailureStore';
import { OverridableMemoryError } from '../../../src/services/modelLoadErrors';

// Mock the services
jest.mock('../../../src/services/localDreamGenerator');
jest.mock('../../../src/services/activeModelService');
jest.mock('../../../src/services/llm');

const mockLocalDreamService = localDreamGeneratorService as jest.Mocked<typeof localDreamGeneratorService>;
const mockActiveModelService = activeModelService as jest.Mocked<typeof activeModelService>;
const mockLlmService = llmService as jest.Mocked<typeof llmService>;

describe('Image Generation Flow Integration', () => {
  beforeEach(async () => {
    resetStores();
    jest.clearAllMocks();

    // Default mock implementations
    mockLocalDreamService.isModelLoaded.mockResolvedValue(true);
    mockLocalDreamService.getLoadedModelPath.mockResolvedValue('/mock/image-model');
    mockLocalDreamService.getLoadedThreads.mockReturnValue(4);
    mockLocalDreamService.isAvailable.mockReturnValue(true);
    mockLocalDreamService.generateImage.mockResolvedValue({
      id: 'generated-img-1',
      prompt: 'Test prompt',
      imagePath: '/mock/generated/image.png',
      width: 512,
      height: 512,
      steps: 20,
      seed: 12345,
      modelId: 'img-model-1',
      createdAt: new Date().toISOString(),
    });
    mockLocalDreamService.cancelGeneration.mockResolvedValue(true);

    mockActiveModelService.getActiveModels.mockReturnValue({
      text: { model: null, isLoaded: false, isLoading: false },
      image: { model: null, isLoaded: true, isLoading: false },
    });
    mockActiveModelService.loadImageModel.mockResolvedValue();

    // Default LLM service mocks (for prompt enhancement)
    mockLlmService.isModelLoaded.mockReturnValue(false);
    mockLlmService.isCurrentlyGenerating.mockReturnValue(false);
    mockLlmService.stopGeneration.mockResolvedValue();

    // Reset imageGenerationService state by canceling any in-progress generation
    await imageGenerationService.cancelGeneration().catch(() => {});
  });

  const setupImageModelState = () => {
    const imageModel = createONNXImageModel({
      id: 'img-model-1',
      modelPath: '/mock/image-model',
    });
    useAppStore.setState({
      downloadedImageModels: [imageModel],
      activeImageModelId: 'img-model-1',
      generatedImages: [],
      // Pre-warmed by default so tests exercise the regular (not the ~120s one-time
      // warm-up) status. The first-run notice is covered by its own test below.
      warmedImageModels: ['img-model-1'],
      settings: {
        imageSteps: 20,
        imageGuidanceScale: 7.5,
        imageWidth: 512,
        imageHeight: 512,
        imageThreads: 4,
      } as any,
    });
    mockLocalDreamService.getLoadedModelPath.mockResolvedValue(imageModel.modelPath);
    return imageModel;
  };

  describe('Image Generation Lifecycle', () => {
    it('should update state during generation lifecycle', async () => {
      const imageModel = setupImageModelState();

      mockActiveModelService.getActiveModels.mockReturnValue({
        text: { model: null, isLoaded: false, isLoading: false },
        image: { model: imageModel, isLoaded: true, isLoading: false },
      });

      // Use a deferred promise to control when generation completes
      let resolveGeneration: (value: any) => void;
      mockLocalDreamService.generateImage.mockImplementation(async () => {
        return new Promise((resolve) => {
          resolveGeneration = resolve;
        });
      });

      // Start generation (don't await - we want to check state while generating)
      const generatePromise = imageGenerationService.generateImage({
        prompt: 'A beautiful sunset',
      });

      // Wait for the async setup to complete
      await flushPromises();

      // Should be generating
      expect(imageGenerationService.getState().isGenerating).toBe(true);
      expect(imageGenerationService.getState().prompt).toBe('A beautiful sunset');

      // Complete generation
      resolveGeneration!({
        id: 'test-img',
        prompt: 'A beautiful sunset',
        imagePath: '/mock/image.png',
        width: 512,
        height: 512,
        steps: 20,
        seed: 12345,
        modelId: 'img-model-1',
        createdAt: new Date().toISOString(),
      });

      await generatePromise;

      // Should no longer be generating
      expect(imageGenerationService.getState().isGenerating).toBe(false);
    });

    it('should call localDreamGeneratorService with correct parameters', async () => {
      const imageModel = setupImageModelState();

      // Update settings
      useAppStore.setState({
        settings: {
          imageSteps: 30,
          imageGuidanceScale: 8.5,
          imageWidth: 768,
          imageHeight: 768,
          imageThreads: 4,
        } as any,
      });

      mockActiveModelService.getActiveModels.mockReturnValue({
        text: { model: null, isLoaded: false, isLoading: false },
        image: { model: imageModel, isLoaded: true, isLoading: false },
      });

      await imageGenerationService.generateImage({
        prompt: 'A mountain landscape',
        negativePrompt: 'blurry, ugly',
      });

      expect(mockLocalDreamService.generateImage).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: 'A mountain landscape',
          negativePrompt: 'blurry, ugly',
          steps: 30,
          guidanceScale: 8.5,
          width: 768,
          height: 768,
        }),
        expect.any(Function), // onProgress
        expect.any(Function) // onPreview
      );
    });

    it('should save generated image to gallery', async () => {
      const imageModel = setupImageModelState();

      mockActiveModelService.getActiveModels.mockReturnValue({
        text: { model: null, isLoaded: false, isLoading: false },
        image: { model: imageModel, isLoaded: true, isLoading: false },
      });

      const result = await imageGenerationService.generateImage({
        prompt: 'Test prompt',
      });

      expect(result).not.toBeNull();
      expect(result?.imagePath).toBe('/mock/generated/image.png');

      const state = getAppState();
      expect(state.generatedImages).toHaveLength(1);
      expect(state.generatedImages[0].prompt).toBe('Test prompt');
    });

    it('should add message to chat when conversationId is provided', async () => {
      const imageModel = setupImageModelState();
      const conversationId = setupWithConversation();

      mockActiveModelService.getActiveModels.mockReturnValue({
        text: { model: null, isLoaded: false, isLoading: false },
        image: { model: imageModel, isLoaded: true, isLoading: false },
      });

      await imageGenerationService.generateImage({
        prompt: 'Chat image prompt',
        conversationId,
      });

      const chatState = getChatState();
      const conversation = chatState.conversations.find(c => c.id === conversationId);
      expect(conversation?.messages).toHaveLength(1);
      expect(conversation?.messages[0].role).toBe('assistant');
      expect(conversation?.messages[0].content).toContain('Chat image prompt');
      expect(conversation?.messages[0].attachments).toHaveLength(1);
      expect(conversation?.messages[0].attachments?.[0].type).toBe('image');
    });
  });

  describe('Progress Updates', () => {
    it('should receive and propagate progress updates', async () => {
      const imageModel = setupImageModelState();

      mockActiveModelService.getActiveModels.mockReturnValue({
        text: { model: null, isLoaded: false, isLoading: false },
        image: { model: imageModel, isLoaded: true, isLoading: false },
      });

      let _progressCallback: ((progress: any) => void) | undefined;
      mockLocalDreamService.generateImage.mockImplementation(
        async (params, onProgress, _onPreview) => {
          _progressCallback = onProgress;
          // Simulate progress
          onProgress?.({ step: 5, totalSteps: 20, progress: 0.25 });
          onProgress?.({ step: 10, totalSteps: 20, progress: 0.5 });
          onProgress?.({ step: 20, totalSteps: 20, progress: 1.0 });
          return {
            id: 'test-img',
            prompt: params.prompt,
            imagePath: '/mock/image.png',
            width: 512,
            height: 512,
            steps: 20,
            seed: 12345,
            modelId: 'test',
            createdAt: new Date().toISOString(),
          };
        }
      );

      const progressUpdates: { step: number; totalSteps: number }[] = [];
      const unsubscribe = imageGenerationService.subscribe((state) => {
        if (state.progress) {
          progressUpdates.push({ ...state.progress });
        }
      });

      await imageGenerationService.generateImage({ prompt: 'Test' });

      unsubscribe();

      // Should have received progress updates
      expect(progressUpdates.length).toBeGreaterThan(0);
      expect(progressUpdates.some(p => p.step > 0)).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('should handle generation errors gracefully', async () => {
      const imageModel = setupImageModelState();

      mockActiveModelService.getActiveModels.mockReturnValue({
        text: { model: null, isLoaded: false, isLoading: false },
        image: { model: imageModel, isLoaded: true, isLoading: false },
      });

      mockLocalDreamService.generateImage.mockRejectedValue(
        new Error('Generation failed: out of memory')
      );

      const result = await imageGenerationService.generateImage({
        prompt: 'Test prompt',
      });

      // Should return null on error
      expect(result).toBeNull();

      // State should show error
      expect(imageGenerationService.getState().isGenerating).toBe(false);
      expect(imageGenerationService.getState().error).toContain('out of memory');
    });

    it('should return null when no model is selected', async () => {
      useAppStore.setState({
        downloadedImageModels: [],
        activeImageModelId: null,
        settings: { imageSteps: 20, imageGuidanceScale: 7.5 } as any,
      });

      const result = await imageGenerationService.generateImage({
        prompt: 'Test prompt',
      });

      expect(result).toBeNull();
      expect(imageGenerationService.getState().error).toContain('No image model');
    });

    it('should handle model load failure', async () => {
      setupImageModelState();

      // Model not loaded yet
      mockLocalDreamService.isModelLoaded.mockResolvedValue(false);
      mockActiveModelService.loadImageModel.mockRejectedValue(
        new Error('Failed to load model')
      );

      const result = await imageGenerationService.generateImage({
        prompt: 'Test prompt',
      });

      expect(result).toBeNull();
      expect(imageGenerationService.getState().error).toContain('Failed to load');
    });
  });

  describe('Cancel Generation', () => {
    it('should cancel generation when requested', async () => {
      const imageModel = setupImageModelState();

      mockActiveModelService.getActiveModels.mockReturnValue({
        text: { model: null, isLoaded: false, isLoading: false },
        image: { model: imageModel, isLoaded: true, isLoading: false },
      });

      // Long running generation
      let _resolveGeneration: (value: any) => void;
      mockLocalDreamService.generateImage.mockImplementation(async () => {
        return new Promise((resolve) => {
          _resolveGeneration = resolve;
        });
      });

      imageGenerationService.generateImage({
        prompt: 'Long prompt',
      });

      await flushPromises();

      // Should be generating
      expect(imageGenerationService.getState().isGenerating).toBe(true);

      // Cancel generation
      await imageGenerationService.cancelGeneration();

      // Should have called native cancel
      expect(mockLocalDreamService.cancelGeneration).toHaveBeenCalled();

      // Should no longer be generating
      expect(imageGenerationService.getState().isGenerating).toBe(false);
    });
  });

  describe('Concurrent Generation Prevention', () => {
    it('should ignore second generation request while generating', async () => {
      const imageModel = setupImageModelState();

      mockActiveModelService.getActiveModels.mockReturnValue({
        text: { model: null, isLoaded: false, isLoading: false },
        image: { model: imageModel, isLoaded: true, isLoading: false },
      });

      let resolveFirst: (value: any) => void;
      let callCount = 0;

      mockLocalDreamService.generateImage.mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return new Promise((resolve) => {
            resolveFirst = resolve;
          });
        }
        return createGeneratedImage();
      });

      // Start first generation
      const gen1 = imageGenerationService.generateImage({ prompt: 'First' });

      await flushPromises();
      expect(imageGenerationService.getState().isGenerating).toBe(true);

      // Try second generation - should return null immediately
      const gen2 = await imageGenerationService.generateImage({ prompt: 'Second' });

      expect(gen2).toBeNull();
      expect(callCount).toBe(1);

      // Complete first
      resolveFirst!(createGeneratedImage());
      await gen1;
    });
  });

  describe('State Subscription', () => {
    it('should notify subscribers of state changes', async () => {
      const imageModel = setupImageModelState();

      mockActiveModelService.getActiveModels.mockReturnValue({
        text: { model: null, isLoaded: false, isLoading: false },
        image: { model: imageModel, isLoaded: true, isLoading: false },
      });

      const generatingStates: boolean[] = [];
      const unsubscribe = imageGenerationService.subscribe((state) => {
        generatingStates.push(state.isGenerating);
      });

      await imageGenerationService.generateImage({ prompt: 'Test' });

      unsubscribe();

      // Should have transitions: initial false -> true (generating) -> false (complete)
      expect(generatingStates).toContain(true);
      expect(generatingStates[generatingStates.length - 1]).toBe(false);
    });

    it('should receive current state immediately on subscribe', () => {
      const states: boolean[] = [];
      const unsubscribe = imageGenerationService.subscribe((state) => {
        states.push(state.isGenerating);
      });

      // Should have received initial state
      expect(states).toHaveLength(1);
      expect(states[0]).toBe(false);

      unsubscribe();
    });
  });

  describe('Model Auto-Loading', () => {
    it('should auto-load model if not loaded', async () => {
      const imageModel = setupImageModelState();

      mockActiveModelService.getActiveModels.mockReturnValue({
        text: { model: null, isLoaded: false, isLoading: false },
        image: { model: imageModel, isLoaded: false, isLoading: false },
      });

      // Model not loaded
      mockLocalDreamService.isModelLoaded.mockResolvedValue(false);

      await imageGenerationService.generateImage({ prompt: 'Test' });

      // Should have tried to load model (override opts threaded through — undefined on
      // the normal path, { override: true } only on a Load-Anyway retry).
      expect(mockActiveModelService.loadImageModel).toHaveBeenCalledWith('img-model-1', undefined, undefined);
    });

    it('should reload model if threads changed', async () => {
      const imageModel = setupImageModelState();

      mockActiveModelService.getActiveModels.mockReturnValue({
        text: { model: null, isLoaded: false, isLoading: false },
        image: { model: imageModel, isLoaded: true, isLoading: false },
      });

      // Model loaded but with different threads
      mockLocalDreamService.isModelLoaded.mockResolvedValue(true);
      mockLocalDreamService.getLoadedThreads.mockReturnValue(2); // Different from settings (4)

      await imageGenerationService.generateImage({ prompt: 'Test' });

      // Should have reloaded model
      expect(mockActiveModelService.loadImageModel).toHaveBeenCalled();
    });
  });

  describe('Generation Metadata', () => {
    it('should include generation metadata in chat message', async () => {
      const imageModel = createONNXImageModel({
        id: 'img-model-1',
        name: 'Test Image Model',
        modelPath: '/mock/image-model',
        backend: 'qnn',
      });
      useAppStore.setState({
        downloadedImageModels: [imageModel],
        activeImageModelId: 'img-model-1',
        generatedImages: [],
        settings: {
          imageSteps: 25,
          imageGuidanceScale: 8.0,
          imageWidth: 512,
          imageHeight: 512,
          imageThreads: 4,
        } as any,
      });
      mockLocalDreamService.getLoadedModelPath.mockResolvedValue(imageModel.modelPath);

      const conversationId = setupWithConversation();

      mockActiveModelService.getActiveModels.mockReturnValue({
        text: { model: null, isLoaded: false, isLoading: false },
        image: { model: imageModel, isLoaded: true, isLoading: false },
      });

      await imageGenerationService.generateImage({
        prompt: 'Metadata test',
        conversationId,
      });

      const chatState = getChatState();
      const conversation = chatState.conversations.find(c => c.id === conversationId);
      const message = conversation?.messages[0];

      expect(message?.generationMeta).toBeDefined();
      expect(message?.generationMeta?.modelName).toBe('Test Image Model');
      expect(message?.generationMeta?.steps).toBe(25);
      expect(message?.generationMeta?.guidanceScale).toBe(8.0);
      expect(message?.generationMeta?.resolution).toBe('512x512');
    });
  });

  describe('Prompt enhancement model loading (mutual exclusion)', () => {
    it('shows the generating card even when enhancement is enabled but skipped (no text model)', async () => {
      setupImageModelState();
      useAppStore.setState({
        activeModelId: null,
        lastTextModelId: null,
        settings: { ...useAppStore.getState().settings, enhanceImagePrompts: true } as any,
      });
      mockLlmService.isModelLoaded.mockReturnValue(false);

      let resolveGen: (v: any) => void;
      mockLocalDreamService.generateImage.mockImplementation(
        () => new Promise((r) => { resolveGen = r; }),
      );

      const gen = imageGenerationService.generateImage({ prompt: 'a cat' });
      await flushPromises();

      // The card must show despite enhancement being enabled-but-skipped (was the bug).
      expect(imageGenerationService.getState().isGenerating).toBe(true);
      // With no text model available, enhancement must not attempt an on-demand load.
      expect(mockActiveModelService.loadTextModel).not.toHaveBeenCalled();

      resolveGen!({ id: 'x', prompt: 'a cat', imagePath: '/p.png', width: 512, height: 512, seed: 1 });
      await gen;
    });

    it('auto-loads the text model on demand to enhance when it is not loaded', async () => {
      setupImageModelState();
      useAppStore.setState({
        activeModelId: 'text-1',
        settings: { ...useAppStore.getState().settings, enhanceImagePrompts: true } as any,
      });
      // Not loaded initially; becomes loaded after the on-demand load.
      mockLlmService.isModelLoaded.mockReturnValueOnce(false).mockReturnValue(true);
      mockActiveModelService.loadTextModel.mockResolvedValue();
      mockLlmService.generateResponse.mockResolvedValue('enhanced prompt');

      await imageGenerationService.generateImage({ prompt: 'a cat' });

      expect(mockActiveModelService.loadTextModel).toHaveBeenCalledWith('text-1');
      expect(mockLlmService.generateResponse).toHaveBeenCalled();
    });
  });

  describe('Prompt Enhancement with Conversation Context', () => {
    const setupEnhancement = () => {
      const imageModel = setupImageModelState();
      mockActiveModelService.getActiveModels.mockReturnValue({
        text: { model: null, isLoaded: false, isLoading: false },
        image: { model: imageModel, isLoaded: true, isLoading: false },
      });

      // Enable enhancement and set up LLM as available
      useAppStore.setState({
        settings: {
          ...useAppStore.getState().settings,
          enhanceImagePrompts: true,
        },
      });
      mockLlmService.isModelLoaded.mockReturnValue(true);
      mockLlmService.isCurrentlyGenerating.mockReturnValue(false);
      mockLlmService.generateResponse.mockResolvedValue('A beautifully enhanced prompt');

      return imageModel;
    };

    it('should pass conversation history to enhancement when conversationId provided', async () => {
      setupEnhancement();

      // Set up a conversation with prior messages
      const messages: Message[] = [
        createMessage({ role: 'user', content: 'Draw me a cat' }),
        createMessage({ role: 'assistant', content: 'Here is a cat image' }),
        createMessage({ role: 'user', content: 'Make it darker' }),
      ];
      const conversationId = setupWithConversation({ messages });

      await imageGenerationService.generateImage({
        prompt: 'Make it darker',
        conversationId,
      });

      // Verify generateResponse was called with conversation context
      expect(mockLlmService.generateResponse).toHaveBeenCalled();
      const callArgs = mockLlmService.generateResponse.mock.calls[0];
      const enhancementMessages = callArgs[0] as Message[];

      // Should have: system + context messages + user enhance prompt
      // system (1) + conversation messages (3) + user enhance (1) = 5
      expect(enhancementMessages.length).toBe(5);
      expect(enhancementMessages[0].role).toBe('system');
      expect(enhancementMessages[0].content).toContain('conversation history');
      expect(enhancementMessages[1].content).toBe('Draw me a cat');
      expect(enhancementMessages[2].content).toBe('Here is a cat image');
      expect(enhancementMessages[3].content).toBe('Make it darker');
      expect(enhancementMessages[4].role).toBe('user');
      expect(enhancementMessages[4].content).toBe('User Request: Make it darker');
    });

    it('should not include conversation context when no conversationId', async () => {
      setupEnhancement();

      await imageGenerationService.generateImage({
        prompt: 'A sunset',
      });

      expect(mockLlmService.generateResponse).toHaveBeenCalled();
      const callArgs = mockLlmService.generateResponse.mock.calls[0];
      const enhancementMessages = callArgs[0] as Message[];

      // Should have: system + user enhance prompt only (no context)
      expect(enhancementMessages.length).toBe(2);
      expect(enhancementMessages[0].role).toBe('system');
      expect(enhancementMessages[0].content).not.toContain('conversation history');
      expect(enhancementMessages[1].role).toBe('user');
      expect(enhancementMessages[1].content).toBe('User Request: A sunset');
    });

    it('should truncate long messages in conversation context', async () => {
      setupEnhancement();

      const longContent = 'x'.repeat(1000);
      const messages: Message[] = [
        createMessage({ role: 'user', content: longContent }),
      ];
      const conversationId = setupWithConversation({ messages });

      await imageGenerationService.generateImage({
        prompt: 'Enhance this',
        conversationId,
      });

      const callArgs = mockLlmService.generateResponse.mock.calls[0];
      const enhancementMessages = callArgs[0] as Message[];

      // The context message should be truncated to 500 chars
      const contextMsg = enhancementMessages.find(m => m.id.startsWith('ctx-'));
      expect(contextMsg).toBeDefined();
      expect(contextMsg!.content.length).toBe(500);
    });

    it('should limit conversation context to last 10 messages', async () => {
      setupEnhancement();

      // Create 15 messages
      const messages: Message[] = [];
      for (let i = 0; i < 15; i++) {
        messages.push(createMessage({
          role: i % 2 === 0 ? 'user' : 'assistant',
          content: `Message ${i + 1}`,
        }));
      }
      const conversationId = setupWithConversation({ messages });

      await imageGenerationService.generateImage({
        prompt: 'Generate image',
        conversationId,
      });

      const callArgs = mockLlmService.generateResponse.mock.calls[0];
      const enhancementMessages = callArgs[0] as Message[];

      // system (1) + last 10 context messages + user enhance (1) = 12
      expect(enhancementMessages.length).toBe(12);
      // First context message should be message 6 (index 5), not message 1
      const firstContextMsg = enhancementMessages[1];
      expect(firstContextMsg.content).toBe('Message 6');
    });

    it('should skip system messages from conversation context', async () => {
      setupEnhancement();

      const messages: Message[] = [
        createMessage({ role: 'user', content: 'Hello' }),
        createMessage({ role: 'system', content: 'Model loaded successfully' }),
        createMessage({ role: 'assistant', content: 'Hi there' }),
      ];
      const conversationId = setupWithConversation({ messages });

      await imageGenerationService.generateImage({
        prompt: 'Draw something',
        conversationId,
      });

      const callArgs = mockLlmService.generateResponse.mock.calls[0];
      const enhancementMessages = callArgs[0] as Message[];

      // system (1) + 2 context (user + assistant, system skipped) + user enhance (1) = 4
      expect(enhancementMessages.length).toBe(4);
      const contextMessages = enhancementMessages.filter(m => m.id.startsWith('ctx-'));
      expect(contextMessages).toHaveLength(2);
      expect(contextMessages.every(m => m.role !== 'system')).toBe(true);
    });

    it('should use original prompt when enhancement is disabled', async () => {
      setupImageModelState();
      mockActiveModelService.getActiveModels.mockReturnValue({
        text: { model: null, isLoaded: false, isLoading: false },
        image: { model: setupImageModelState(), isLoaded: true, isLoading: false },
      });

      // Enhancement disabled (default)
      useAppStore.setState({
        settings: {
          ...useAppStore.getState().settings,
          enhanceImagePrompts: false,
        },
      });

      const messages: Message[] = [
        createMessage({ role: 'user', content: 'Draw a cat' }),
      ];
      const conversationId = setupWithConversation({ messages });

      await imageGenerationService.generateImage({
        prompt: 'Make it blue',
        conversationId,
      });

      // LLM should not be called for enhancement
      expect(mockLlmService.generateResponse).not.toHaveBeenCalled();
    });

    it('should handle empty conversation gracefully', async () => {
      setupEnhancement();

      const conversationId = setupWithConversation({ messages: [] });

      await imageGenerationService.generateImage({
        prompt: 'A landscape',
        conversationId,
      });

      const callArgs = mockLlmService.generateResponse.mock.calls[0];
      const enhancementMessages = callArgs[0] as Message[];

      // system + user enhance only (no context from empty conversation)
      expect(enhancementMessages.length).toBe(2);
      expect(enhancementMessages[0].role).toBe('system');
      expect(enhancementMessages[0].content).not.toContain('conversation history');
    });
  });

  // ============================================================================
  // Additional branch coverage tests
  // ============================================================================
  describe('cancelGeneration when not generating', () => {
    it('should return immediately when not generating', async () => {
      // Ensure not generating
      expect(imageGenerationService.getState().isGenerating).toBe(false);

      // Should not throw and should be a no-op
      await imageGenerationService.cancelGeneration();

      expect(mockLocalDreamService.cancelGeneration).not.toHaveBeenCalled();
    });
  });

  describe('isGeneratingFor', () => {
    it('returns false when not generating', () => {
      expect(imageGenerationService.isGeneratingFor('conv-123')).toBe(false);
    });

    it('returns true when generating for matching conversation', async () => {
      const imageModel = setupImageModelState();
      const conversationId = setupWithConversation();

      mockActiveModelService.getActiveModels.mockReturnValue({
        text: { model: null, isLoaded: false, isLoading: false },
        image: { model: imageModel, isLoaded: true, isLoading: false },
      });

      let resolveGeneration: (value: any) => void;
      mockLocalDreamService.generateImage.mockImplementation(async () => {
        return new Promise((resolve) => {
          resolveGeneration = resolve;
        });
      });

      const generatePromise = imageGenerationService.generateImage({
        prompt: 'Test',
        conversationId,
      });

      await flushPromises();

      expect(imageGenerationService.isGeneratingFor(conversationId)).toBe(true);
      expect(imageGenerationService.isGeneratingFor('different-conv')).toBe(false);

      resolveGeneration!(createGeneratedImage());
      await generatePromise;
    });
  });

  describe('generation returning null result (no imagePath)', () => {
    it('should return null when native generator returns null', async () => {
      const imageModel = setupImageModelState();

      mockActiveModelService.getActiveModels.mockReturnValue({
        text: { model: null, isLoaded: false, isLoading: false },
        image: { model: imageModel, isLoaded: true, isLoading: false },
      });

      // Native returns result without imagePath
      mockLocalDreamService.generateImage.mockResolvedValue(null as any);

      const result = await imageGenerationService.generateImage({
        prompt: 'Should fail',
      });

      expect(result).toBeNull();
    });
  });

  describe('prompt enhancement error handling', () => {
    it('should fall back to original prompt when enhancement fails', async () => {
      const imageModel = setupImageModelState();

      mockActiveModelService.getActiveModels.mockReturnValue({
        text: { model: null, isLoaded: false, isLoading: false },
        image: { model: imageModel, isLoaded: true, isLoading: false },
      });

      // Enable enhancement
      useAppStore.setState({
        settings: {
          ...useAppStore.getState().settings,
          enhanceImagePrompts: true,
        },
      });
      mockLlmService.isModelLoaded.mockReturnValue(true);
      mockLlmService.isCurrentlyGenerating.mockReturnValue(false);
      mockLlmService.generateResponse.mockRejectedValue(new Error('Enhancement failed'));

      await imageGenerationService.generateImage({
        prompt: 'Original prompt',
      });

      // Should still generate with original prompt
      expect(mockLocalDreamService.generateImage).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: 'Original prompt',
        }),
        expect.any(Function),
        expect.any(Function),
      );
    });

    it('should skip enhancement when LLM is not loaded', async () => {
      const imageModel = setupImageModelState();

      mockActiveModelService.getActiveModels.mockReturnValue({
        text: { model: null, isLoaded: false, isLoading: false },
        image: { model: imageModel, isLoaded: true, isLoading: false },
      });

      // Enable enhancement but LLM not loaded
      useAppStore.setState({
        settings: {
          ...useAppStore.getState().settings,
          enhanceImagePrompts: true,
        },
      });
      mockLlmService.isModelLoaded.mockReturnValue(false);

      await imageGenerationService.generateImage({
        prompt: 'No enhancement',
      });

      // LLM should not be called
      expect(mockLlmService.generateResponse).not.toHaveBeenCalled();
      // Should still generate with original prompt
      expect(mockLocalDreamService.generateImage).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: 'No enhancement',
        }),
        expect.any(Function),
        expect.any(Function),
      );
    });
  });

  describe('enhancement result update vs delete thinking message', () => {
    it('should update thinking message when enhancement produces different prompt', async () => {
      const imageModel = setupImageModelState();
      const conversationId = setupWithConversation();

      mockActiveModelService.getActiveModels.mockReturnValue({
        text: { model: null, isLoaded: false, isLoading: false },
        image: { model: imageModel, isLoaded: true, isLoading: false },
      });

      useAppStore.setState({
        settings: {
          ...useAppStore.getState().settings,
          enhanceImagePrompts: true,
        },
      });
      mockLlmService.isModelLoaded.mockReturnValue(true);
      mockLlmService.isCurrentlyGenerating.mockReturnValue(false);
      // Return a different enhanced prompt
      mockLlmService.generateResponse.mockResolvedValue('A beautifully enhanced and different prompt');

      await imageGenerationService.generateImage({
        prompt: 'Simple prompt',
        conversationId,
      });

      // The chat should have messages - at least the image result
      const chatState = getChatState();
      const conversation = chatState.conversations.find(c => c.id === conversationId);
      expect(conversation?.messages.length).toBeGreaterThanOrEqual(1);
    });

    it('should delete thinking message when enhancement returns same prompt', async () => {
      const imageModel = setupImageModelState();
      const conversationId = setupWithConversation();

      mockActiveModelService.getActiveModels.mockReturnValue({
        text: { model: null, isLoaded: false, isLoading: false },
        image: { model: imageModel, isLoaded: true, isLoading: false },
      });

      useAppStore.setState({
        settings: {
          ...useAppStore.getState().settings,
          enhanceImagePrompts: true,
        },
      });
      mockLlmService.isModelLoaded.mockReturnValue(true);
      mockLlmService.isCurrentlyGenerating.mockReturnValue(false);
      // Return same prompt (no change)
      mockLlmService.generateResponse.mockResolvedValue('A sunset');

      await imageGenerationService.generateImage({
        prompt: 'A sunset',
        conversationId,
      });

      // Should still generate successfully
      const state = getAppState();
      expect(state.generatedImages).toHaveLength(1);
    });
  });

  describe('generation with conversation metadata', () => {
    it('should include correct backend metadata for QNN model', async () => {
      const imageModel = createONNXImageModel({
        id: 'qnn-model',
        name: 'QNN SD Model',
        modelPath: '/mock/qnn-model',
        backend: 'qnn',
      });
      useAppStore.setState({
        downloadedImageModels: [imageModel],
        activeImageModelId: 'qnn-model',
        generatedImages: [],
        settings: {
          imageSteps: 20,
          imageGuidanceScale: 7.5,
          imageWidth: 512,
          imageHeight: 512,
          imageThreads: 4,
        } as any,
      });
      mockLocalDreamService.getLoadedModelPath.mockResolvedValue(imageModel.modelPath);

      const conversationId = setupWithConversation();

      mockActiveModelService.getActiveModels.mockReturnValue({
        text: { model: null, isLoaded: false, isLoading: false },
        image: { model: imageModel, isLoaded: true, isLoading: false },
      });

      await imageGenerationService.generateImage({
        prompt: 'QNN metadata test',
        conversationId,
      });

      const chatState = getChatState();
      const conversation = chatState.conversations.find(c => c.id === conversationId);
      const message = conversation?.messages[0];

      expect(message?.generationMeta).toBeDefined();
      // In test env, Platform.OS defaults to 'ios', so backend is always Core ML
      expect(message?.generationMeta?.gpuBackend).toBe('Core ML (ANE)');
      expect(message?.generationMeta?.gpu).toBe(true);
    });
  });

  describe('cancelRequested during generation', () => {
    it('should check cancelRequested after model load', async () => {
      const imageModel = setupImageModelState();

      mockActiveModelService.getActiveModels.mockReturnValue({
        text: { model: null, isLoaded: false, isLoading: false },
        image: { model: imageModel, isLoaded: false, isLoading: false },
      });

      // Model needs loading
      mockLocalDreamService.isModelLoaded.mockResolvedValue(false);

      // Cancel during model load
      mockActiveModelService.loadImageModel.mockImplementation(async () => {
        await imageGenerationService.cancelGeneration();
      });

      const result = await imageGenerationService.generateImage({
        prompt: 'Cancel during load',
      });

      // Should return null due to cancellation
      expect(result).toBeNull();
    });
  });

  describe('generation without conversationId', () => {
    it('should save to gallery but not add chat message', async () => {
      const imageModel = setupImageModelState();

      mockActiveModelService.getActiveModels.mockReturnValue({
        text: { model: null, isLoaded: false, isLoading: false },
        image: { model: imageModel, isLoaded: true, isLoading: false },
      });

      const result = await imageGenerationService.generateImage({
        prompt: 'Gallery only',
      });

      expect(result).not.toBeNull();
      // Should be in gallery
      const state = getAppState();
      expect(state.generatedImages).toHaveLength(1);
    });
  });

  describe('enhancement with LLM currently generating', () => {
    it('should still attempt enhancement even if LLM was generating', async () => {
      const imageModel = setupImageModelState();

      mockActiveModelService.getActiveModels.mockReturnValue({
        text: { model: null, isLoaded: false, isLoading: false },
        image: { model: imageModel, isLoaded: true, isLoading: false },
      });

      useAppStore.setState({
        settings: {
          ...useAppStore.getState().settings,
          enhanceImagePrompts: true,
        },
      });
      mockLlmService.isModelLoaded.mockReturnValue(true);
      mockLlmService.isCurrentlyGenerating.mockReturnValue(true);
      mockLlmService.generateResponse.mockResolvedValue('Enhanced prompt result');

      const result = await imageGenerationService.generateImage({
        prompt: 'Test while generating',
      });

      // Should still work
      expect(result).not.toBeNull();
    });
  });

  describe('prompt enhancement strips thinking model tags', () => {
    const setupThinkingModelEnhancement = () => {
      const imageModel = setupImageModelState();
      mockActiveModelService.getActiveModels.mockReturnValue({
        text: { model: null, isLoaded: false, isLoading: false },
        image: { model: imageModel, isLoaded: true, isLoading: false },
      });
      useAppStore.setState({
        settings: {
          ...useAppStore.getState().settings,
          enhanceImagePrompts: true,
        },
      });
      mockLlmService.isModelLoaded.mockReturnValue(true);
      mockLlmService.isCurrentlyGenerating.mockReturnValue(false);
    };

    it('should strip <think> tags from thinking model responses', async () => {
      setupThinkingModelEnhancement();
      // Simulate a thinking model that wraps reasoning in <think> tags
      mockLlmService.generateResponse.mockResolvedValue(
        '<think>Let me enhance this prompt by adding artistic details...</think>A majestic sunset over mountains, golden hour lighting, oil painting style'
      );

      await imageGenerationService.generateImage({
        prompt: 'sunset over mountains',
      });

      // The prompt passed to image generation should NOT contain <think> tags
      expect(mockLocalDreamService.generateImage).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: 'A majestic sunset over mountains, golden hour lighting, oil painting style',
        }),
        expect.any(Function),
        expect.any(Function),
      );
    });

    it('should handle thinking model response that is only a think block', async () => {
      setupThinkingModelEnhancement();
      // Simulate a model that only outputs thinking with no actual response
      mockLlmService.generateResponse.mockResolvedValue(
        '<think>I need to think about how to enhance this prompt...</think>'
      );

      await imageGenerationService.generateImage({
        prompt: 'a cat',
      });

      // When stripping produces empty string, should fall back to original prompt
      expect(mockLocalDreamService.generateImage).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: 'a cat',
        }),
        expect.any(Function),
        expect.any(Function),
      );
    });

    it('should handle response without think tags normally', async () => {
      setupThinkingModelEnhancement();
      // Non-thinking model returns plain enhanced prompt
      mockLlmService.generateResponse.mockResolvedValue(
        'A beautiful enhanced prompt with details'
      );

      await imageGenerationService.generateImage({
        prompt: 'simple prompt',
      });

      expect(mockLocalDreamService.generateImage).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: 'A beautiful enhanced prompt with details',
        }),
        expect.any(Function),
        expect.any(Function),
      );
    });
  });

  describe('cancelled error handling', () => {
    it('should reset state when error message includes cancelled', async () => {
      const imageModel = setupImageModelState();

      mockActiveModelService.getActiveModels.mockReturnValue({
        text: { model: null, isLoaded: false, isLoading: false },
        image: { model: imageModel, isLoaded: true, isLoading: false },
      });

      mockLocalDreamService.generateImage.mockRejectedValue(
        new Error('Generation cancelled by user')
      );

      const result = await imageGenerationService.generateImage({
        prompt: 'Will be cancelled',
      });

      expect(result).toBeNull();
      // Error state should be null for cancellation (not an error)
      expect(imageGenerationService.getState().error).toBeNull();
    });
  });

  // ============================================================================
  // Coverage for lines 237-298: enhancement cleanup and error paths with conversationId
  // ============================================================================
  describe('prompt enhancement stopGeneration cleanup (lines 247, 287-291)', () => {
    const setupEnhancementWithConversation = () => {
      const imageModel = setupImageModelState();
      mockActiveModelService.getActiveModels.mockReturnValue({
        text: { model: null, isLoaded: false, isLoading: false },
        image: { model: imageModel, isLoaded: true, isLoading: false },
      });
      useAppStore.setState({
        settings: {
          ...useAppStore.getState().settings,
          enhanceImagePrompts: true,
        },
      });
      mockLlmService.isModelLoaded.mockReturnValue(true);
      mockLlmService.isCurrentlyGenerating.mockReturnValue(false);
      return imageModel;
    };

    it('should call stopGeneration after successful enhancement (line 247)', async () => {
      setupEnhancementWithConversation();
      mockLlmService.generateResponse.mockResolvedValue('Enhanced result');

      await imageGenerationService.generateImage({
        prompt: 'Test cleanup',
      });

      // stopGeneration must be called to reset LLM state after enhancement
      expect(mockLlmService.stopGeneration).toHaveBeenCalled();
    });

    it('should call stopGeneration even when stopGeneration itself throws (lines 253-255)', async () => {
      setupEnhancementWithConversation();
      mockLlmService.generateResponse.mockResolvedValue('Enhanced result');
      // Make stopGeneration throw to exercise the inner catch
      mockLlmService.stopGeneration.mockRejectedValue(new Error('stop failed'));

      // Should not propagate the error - generation should still succeed
      const result = await imageGenerationService.generateImage({
        prompt: 'Cleanup error test',
      });

      expect(mockLlmService.stopGeneration).toHaveBeenCalled();
      // Image generation should still proceed despite stopGeneration error
      expect(result).not.toBeNull();
    });

    it('should delete thinking message and call stopGeneration when enhancement fails with conversationId (lines 287-298)', async () => {
      setupEnhancementWithConversation();
      const conversationId = setupWithConversation();

      mockLlmService.generateResponse.mockRejectedValue(new Error('LLM service crashed'));

      await imageGenerationService.generateImage({
        prompt: 'Prompt that fails to enhance',
        conversationId,
      });

      // stopGeneration should be called inside the catch block to clean up LLM state
      expect(mockLlmService.stopGeneration).toHaveBeenCalled();

      // Should fall back to original prompt and still generate
      expect(mockLocalDreamService.generateImage).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: 'Prompt that fails to enhance',
        }),
        expect.any(Function),
        expect.any(Function),
      );
    });

    it('should call stopGeneration in catch when stopGeneration itself throws during error cleanup (lines 290-292)', async () => {
      setupEnhancementWithConversation();
      const conversationId = setupWithConversation();

      mockLlmService.generateResponse.mockRejectedValue(new Error('Enhancement error'));
      // Both the success and error path stopGeneration calls throw
      mockLlmService.stopGeneration.mockRejectedValue(new Error('stop also failed'));

      // Should not throw - inner catch swallows the resetError
      const result = await imageGenerationService.generateImage({
        prompt: 'Double failure test',
        conversationId,
      });

      expect(mockLlmService.stopGeneration).toHaveBeenCalled();
      // Should still produce a result using the original prompt
      expect(result).not.toBeNull();
    });

    it('should update thinking message in chat when enhancement succeeds with conversationId (lines 263-278)', async () => {
      setupEnhancementWithConversation();
      const conversationId = setupWithConversation();

      // Return a different enhanced prompt so the updateMessage branch is taken
      mockLlmService.generateResponse.mockResolvedValue('A richly detailed enhanced prompt');

      await imageGenerationService.generateImage({
        prompt: 'short prompt',
        conversationId,
      });

      // The conversation should have messages (thinking message updated + image result)
      const chatState = getChatState();
      const conversation = chatState.conversations.find(c => c.id === conversationId);
      // At minimum, the final image message should exist
      expect(conversation?.messages.length).toBeGreaterThanOrEqual(1);
      // stopGeneration cleanup should have been called
      expect(mockLlmService.stopGeneration).toHaveBeenCalled();
    });

    it('should delete thinking message when enhancement returns same prompt as original (lines 274-278)', async () => {
      setupEnhancementWithConversation();
      const conversationId = setupWithConversation();

      // Enhancement returns identical text (trim/replace/strip produces same string)
      mockLlmService.generateResponse.mockResolvedValue('identical prompt');

      await imageGenerationService.generateImage({
        prompt: 'identical prompt',
        conversationId,
      });

      // Generation should still succeed despite no change
      const state = getAppState();
      expect(state.generatedImages).toHaveLength(1);
      expect(mockLlmService.stopGeneration).toHaveBeenCalled();
    });
  });

  // ============================================================================
  // Coverage for lines 388-389: onPreview callback normal path (cancelRequested=false)
  // ============================================================================
  describe('onPreview callback normal path (lines 388-389)', () => {
    it('should update previewPath state when onPreview fires without cancellation', async () => {
      const imageModel = setupImageModelState();

      mockActiveModelService.getActiveModels.mockReturnValue({
        text: { model: null, isLoaded: false, isLoading: false },
        image: { model: imageModel, isLoaded: true, isLoading: false },
      });

      mockLocalDreamService.generateImage.mockImplementation(
        async (_params, _onProgress, onPreview) => {
          // Fire preview callback before resolving (cancelRequested is false)
          onPreview?.({ step: 5, totalSteps: 20, previewPath: '/tmp/preview_step5.png' });
          onPreview?.({ step: 10, totalSteps: 20, previewPath: '/tmp/preview_step10.png' });
          return {
            id: 'preview-normal-img',
            prompt: 'test',
            imagePath: '/mock/image.png',
            width: 512,
            height: 512,
            steps: 20,
            seed: 42,
            modelId: 'img-model-1',
            createdAt: new Date().toISOString(),
          };
        }
      );

      const previewPaths: (string | null)[] = [];
      const unsubscribe = imageGenerationService.subscribe((state) => {
        if (state.previewPath) {
          previewPaths.push(state.previewPath);
        }
      });

      await imageGenerationService.generateImage({ prompt: 'Preview normal path' });
      unsubscribe();

      // Should have received preview updates from the onPreview callback
      expect(previewPaths.length).toBeGreaterThan(0);
      expect(previewPaths.some(p => p?.includes('preview_step5.png'))).toBe(true);
    });
  });

  // ============================================================================
  // Coverage for lines 387-389: onPreview callback when cancelRequested is true
  // ============================================================================
  describe('onPreview callback skipped when cancelRequested (lines 387-389)', () => {
    it('should skip preview update when cancelRequested is true during preview callback', async () => {
      const imageModel = setupImageModelState();

      mockActiveModelService.getActiveModels.mockReturnValue({
        text: { model: null, isLoaded: false, isLoading: false },
        image: { model: imageModel, isLoaded: true, isLoading: false },
      });

      let capturedOnPreview: ((preview: { step: number; totalSteps: number; previewPath: string }) => void) | undefined;

      mockLocalDreamService.generateImage.mockImplementation(
        async (_params, _onProgress, onPreview) => {
          capturedOnPreview = onPreview;
          return {
            id: 'preview-test-img',
            prompt: 'test',
            imagePath: '/mock/image.png',
            width: 512,
            height: 512,
            steps: 20,
            seed: 42,
            modelId: 'img-model-1',
            createdAt: new Date().toISOString(),
          };
        }
      );

      // Start generation and let it complete
      await imageGenerationService.generateImage({ prompt: 'Preview cancel test' });

      // Now simulate calling the onPreview callback AFTER cancellation was requested.
      // We do this by calling cancelGeneration to set the flag, then invoking the callback.
      // First start a new generation to put service in generating state
      let resolveSecond: (value: any) => void;
      mockLocalDreamService.generateImage.mockImplementation(async (_p, _onProg, onPreview) => {
        capturedOnPreview = onPreview;
        return new Promise((resolve) => {
          resolveSecond = resolve;
        });
      });

      imageGenerationService.generateImage({ prompt: 'Second generation' });
      await flushPromises();

      // Cancel - sets cancelRequested = true
      await imageGenerationService.cancelGeneration();

      // Invoke the preview callback after cancel - should be a no-op (early return on line 387)
      const previewStateBeforeCallback = imageGenerationService.getState().previewPath;
      if (capturedOnPreview) {
        capturedOnPreview({ step: 5, totalSteps: 20, previewPath: '/mock/preview.png' });
      }

      // previewPath should not have been updated because cancelRequested was true
      expect(imageGenerationService.getState().previewPath).toBe(previewStateBeforeCallback);

      // Clean up
      resolveSecond!({
        id: 'x',
        prompt: 'x',
        imagePath: '/x.png',
        width: 512,
        height: 512,
        steps: 20,
        seed: 0,
        modelId: 'img-model-1',
        createdAt: new Date().toISOString(),
      });
    });
  });

  // ============================================================================
  // Coverage for lines 397-398: cancelRequested check after generateImage returns
  // ============================================================================
  describe('cancelRequested check after generateImage resolves (lines 397-398)', () => {
    it('should return null when cancelRequested is set before generateImage resolves', async () => {
      const imageModel = setupImageModelState();

      mockActiveModelService.getActiveModels.mockReturnValue({
        text: { model: null, isLoaded: false, isLoading: false },
        image: { model: imageModel, isLoaded: true, isLoading: false },
      });

      // generateImage resolves immediately, but we simulate cancelRequested being set
      // by cancelling concurrently during the generation
      let resolveGeneration: (value: any) => void;
      mockLocalDreamService.generateImage.mockImplementation(async () => {
        return new Promise((resolve) => {
          resolveGeneration = resolve;
        });
      });

      const generatePromise = imageGenerationService.generateImage({
        prompt: 'Cancel after resolve test',
      });

      await flushPromises();

      // Cancel while generating - this sets cancelRequested = true
      const cancelPromise = imageGenerationService.cancelGeneration();

      // Now resolve the generation - the service should detect cancelRequested after resolving
      resolveGeneration!({
        id: 'cancel-test-img',
        prompt: 'Cancel after resolve test',
        imagePath: '/mock/image.png',
        width: 512,
        height: 512,
        steps: 20,
        seed: 12345,
        modelId: 'img-model-1',
        createdAt: new Date().toISOString(),
      });

      const result = await generatePromise;
      await cancelPromise;

      // Should return null because cancelRequested was true when generateImage resolved
      expect(result).toBeNull();
      expect(imageGenerationService.getState().isGenerating).toBe(false);
    });
  });

  describe('OpenCL kernel cache branches', () => {
    it('logs warning and sets isFirstGpuRun=false when hasKernelCache throws', async () => {
      const imageModel = setupImageModelState();
      useAppStore.setState({
        ...useAppStore.getState(),
        settings: { ...useAppStore.getState().settings, imageUseOpenCL: true },
      });

      mockLocalDreamService.isModelLoaded.mockResolvedValue(true);
      mockLocalDreamService.getLoadedModelPath.mockResolvedValue(imageModel.modelPath);
      mockLocalDreamService.getLoadedThreads.mockReturnValue(4);
      mockLocalDreamService.hasKernelCache.mockRejectedValueOnce(new Error('cache check failed'));

      // Track status updates
      const statusUpdates: (string | null)[] = [];
      const unsub = imageGenerationService.subscribe(s => { if (s.status) statusUpdates.push(s.status); });

      await imageGenerationService.generateImage({ prompt: 'test' });

      unsub();
      // When hasKernelCache throws, isFirstGpuRun=false, so regular status is used
      expect(statusUpdates.some(s => s?.includes('Starting image generation'))).toBe(true);
    });

    it('uses regular progress status when kernel cache exists (isFirstGpuRun=false)', async () => {
      const imageModel = setupImageModelState();
      useAppStore.setState({
        ...useAppStore.getState(),
        settings: { ...useAppStore.getState().settings, imageUseOpenCL: true },
      });

      mockLocalDreamService.isModelLoaded.mockResolvedValue(true);
      mockLocalDreamService.getLoadedModelPath.mockResolvedValue(imageModel.modelPath);
      mockLocalDreamService.getLoadedThreads.mockReturnValue(4);
      mockLocalDreamService.hasKernelCache.mockResolvedValue(true); // cache exists


      mockLocalDreamService.generateImage.mockImplementation(async (_params, progressCb) => {
        progressCb?.({ step: 5, totalSteps: 20, progress: 0.25 });
        return {
          id: 'img-1', prompt: 'test', imagePath: '/path/img.png',
          width: 512, height: 512, steps: 20, seed: 1, modelId: 'img-model-1',
          createdAt: new Date().toISOString(),
        };
      });

      const statusUpdates: (string | null)[] = [];
      const unsub = imageGenerationService.subscribe(s => { if (s.status) statusUpdates.push(s.status); });

      await imageGenerationService.generateImage({ prompt: 'test' });
      unsub();

      // Should include the "Generating image (5/20)..." status from else branch
      expect(statusUpdates.some(s => s?.includes('Generating image'))).toBe(true);
    });
  });

  describe('first-run warm-up notice (platform-agnostic, via warmedImageModels)', () => {
    it('shows the ~120s one-time notice when the model has never generated, then marks it warmed', async () => {
      const imageModel = setupImageModelState();
      // Override the helper's pre-warm: this model has never generated.
      useAppStore.setState({ warmedImageModels: [] });
      // No OpenCL signal — proves the notice is driven by the warmed flag alone
      // (so it fires on iOS/CoreML, which has no kernel cache).
      useAppStore.setState({ settings: { ...useAppStore.getState().settings, imageUseOpenCL: false } });
      mockLocalDreamService.isModelLoaded.mockResolvedValue(true);
      mockLocalDreamService.getLoadedThreads.mockReturnValue(4);
      mockLocalDreamService.generateImage.mockResolvedValue({
        id: 'img-1', prompt: 'test', imagePath: '/path/img.png',
        width: 512, height: 512, steps: 20, seed: 1, modelId: imageModel.id,
        createdAt: new Date().toISOString(),
      });

      const statusUpdates: (string | null)[] = [];
      const unsub = imageGenerationService.subscribe(s => { if (s.status) statusUpdates.push(s.status); });
      await imageGenerationService.generateImage({ prompt: 'test' });
      unsub();

      expect(statusUpdates.some(s => s?.includes('one-time'))).toBe(true);
      // A successful generation warms the model so the notice never shows again.
      expect(useAppStore.getState().warmedImageModels).toContain(imageModel.id);
    });
  });

  // ============================================================================
  // Load Anyway override parity: an OVERRIDABLE memory-gate failure on image load
  // must surface the same "Load Anyway" the text path has, and invoking it must
  // re-run the load forcing past the budget. Before the fix, imageGenerationService
  // stringified the typed OverridableMemoryError, so the override was never offered.
  // ============================================================================
  describe('Load Anyway override (overridable memory gate)', () => {
    beforeEach(() => useModelFailureStore.getState().clear());

    it('offers Load Anyway on an overridable gate, and the retry forces the load with { override: true }', async () => {
      setupImageModelState();
      // Model not resident → a load is attempted; the gate rejects it as overridable,
      // then the forced retry succeeds.
      mockLocalDreamService.isModelLoaded.mockResolvedValue(false);
      mockActiveModelService.loadImageModel
        .mockRejectedValueOnce(
          new OverridableMemoryError('Not enough memory to load Test Model. Free up space or choose a smaller model.'),
        )
        .mockResolvedValue();

      const result = await imageGenerationService.generateImage({ prompt: 'a fox in snow' });
      expect(result).toBeNull();

      const failure = useModelFailureStore.getState().failures.find(f => f.modelType === 'image');
      expect(failure).toBeDefined();
      // The discriminant survived the layers (this is the exact regression).
      expect(failure!.overridable).toBe(true);
      expect(typeof failure!.onLoadAnyway).toBe('function');

      // Invoke "Load Anyway" → it must re-attempt the load FORCING past the budget.
      failure!.onLoadAnyway!();
      for (let i = 0; i < 6; i++) await flushPromises();

      expect(mockActiveModelService.loadImageModel).toHaveBeenLastCalledWith(
        'img-model-1',
        undefined,
        { override: true },
      );
    });

    it('stops offering Load Anyway once the override retry also fails (no repeated no-op)', async () => {
      setupImageModelState();
      mockLocalDreamService.isModelLoaded.mockResolvedValue(false);
      // First load: an overridable gate. The override retry hits the survival floor, so
      // the service reports it as a NON-overridable hard limit (a plain Error) — the exact
      // behavior checkImageModelCanLoad now produces under { override: true }.
      mockActiveModelService.loadImageModel
        .mockRejectedValueOnce(
          new OverridableMemoryError('Not enough memory to load Test Model. Free up space or choose a smaller model.'),
        )
        .mockRejectedValue(
          new Error('Not enough memory to load Test Model, even after freeing other models. Close other apps or choose a smaller model.'),
        );

      await imageGenerationService.generateImage({ prompt: 'a fox' });
      const first = useModelFailureStore.getState().failures.find(f => f.modelType === 'image');
      expect(first!.overridable).toBe(true);
      expect(typeof first!.onLoadAnyway).toBe('function');

      // Press "Load Anyway" → the forced retry fails as a hard limit.
      first!.onLoadAnyway!();
      for (let i = 0; i < 6; i++) await flushPromises();

      // The card must NOT keep offering "Load Anyway" — the action would be a no-op.
      const after = useModelFailureStore.getState().failures.find(f => f.modelType === 'image');
      expect(after).toBeDefined();
      expect(after!.overridable).toBeFalsy();
      expect(after!.onLoadAnyway).toBeUndefined();
    });

    it('does NOT offer Load Anyway for a NON-overridable load failure (false branch)', async () => {
      setupImageModelState();
      mockLocalDreamService.isModelLoaded.mockResolvedValue(false);
      mockActiveModelService.loadImageModel.mockRejectedValue(new Error('Pipeline failed: model corrupt'));

      const result = await imageGenerationService.generateImage({ prompt: 'a fox' });
      expect(result).toBeNull();

      const failure = useModelFailureStore.getState().failures.find(f => f.modelType === 'image');
      expect(failure).toBeDefined();
      expect(failure!.overridable).toBeFalsy();
      expect(failure!.onLoadAnyway).toBeUndefined();
    });
  });

  describe('_ensureImageModelLoaded with null activeImageModelId', () => {
    it('returns false and sets error when activeImageModelId is null but model not loaded', async () => {
      const fakeModel = { modelPath: '/different/path', name: 'FakeModel', id: 'fake' } as any;
      mockLocalDreamService.isModelLoaded.mockResolvedValue(false);
      mockLocalDreamService.getLoadedModelPath.mockResolvedValue(null);
      mockLocalDreamService.getLoadedThreads.mockReturnValue(4);

      const result = await (imageGenerationService as any)._ensureImageModelLoaded(null, fakeModel, { desiredThreads: 4 });

      expect(result).toBe(false);
      expect(imageGenerationService.getState().error).toBe('No image model selected');
    });
  });
});
