/**
 * Integration Tests: Share Prompt Flow
 *
 * Tests the integration between:
 * - generationService → appStore (text generation count increment)
 * - imageGenerationService → appStore (image generation count increment)
 * - sharePrompt pub/sub (emit/subscribe lifecycle)
 * - shouldShowSharePrompt trigger logic at correct milestones
 *
 * Verifies that the share prompt is emitted at the right times
 * (1st gen, every 10th gen) and not emitted on failed/aborted generations.
 */

import { useAppStore } from '../../../src/stores/appStore';
import { generationService } from '../../../src/services/generationService';
import { imageGenerationService } from '../../../src/services/imageGenerationService';
import { llmService } from '../../../src/services/llm';
import { localDreamGeneratorService } from '../../../src/services/localDreamGenerator';
import { activeModelService } from '../../../src/services/activeModelService';
import { subscribeSharePrompt, resetSharePromptSession } from '../../../src/utils/sharePrompt';
import {
  resetStores,
  setupWithActiveModel,
  setupWithConversation,
  flushPromises,
  getAppState,
  wait,
} from '../../utils/testHelpers';
import { createMessage, createONNXImageModel } from '../../utils/factories';

jest.mock('../../../src/services/llm');
jest.mock('../../../src/services/localDreamGenerator');
jest.mock('../../../src/services/activeModelService');

const mockLlmService = llmService as jest.Mocked<typeof llmService>;
const mockLocalDreamService = localDreamGeneratorService as jest.Mocked<typeof localDreamGeneratorService>;
const mockActiveModelService = activeModelService as jest.Mocked<typeof activeModelService>;

describe('Share Prompt Flow Integration', () => {
  let shareListener: jest.Mock;
  let unsubscribe: () => void;

  beforeEach(async () => {
    resetStores();
    jest.clearAllMocks();
    resetSharePromptSession(); // fresh app session per test (the sheet is once-per-session)

    shareListener = jest.fn();
    unsubscribe = subscribeSharePrompt(shareListener);

    // Default LLM mocks
    mockLlmService.isModelLoaded.mockReturnValue(true);
    mockLlmService.isCurrentlyGenerating.mockReturnValue(false);
    mockLlmService.getGpuInfo.mockReturnValue({
      gpu: false, gpuBackend: 'CPU', gpuLayers: 0, reasonNoGPU: '',
    });
    mockLlmService.getPerformanceStats.mockReturnValue({
      lastTokensPerSecond: 15, lastDecodeTokensPerSecond: 18,
      lastTimeToFirstToken: 0.5, lastGenerationTime: 5, lastTokenCount: 100,
    });
    mockLlmService.stopGeneration.mockResolvedValue();

    mockActiveModelService.getActiveModels.mockReturnValue({
      text: { model: null, isLoaded: true, isLoading: false },
      image: { model: null, isLoaded: false, isLoading: false },
    });

    await generationService.stopGeneration().catch(() => {});
  });

  afterEach(() => {
    unsubscribe();
  });

  // ============================================================================
  // Text Generation → Share Prompt
  // ============================================================================
  describe('text generation triggers share prompt', () => {
    const runTextGeneration = async () => {
      const modelId = setupWithActiveModel();
      const conversationId = setupWithConversation({ modelId });

      let streamCallback: any;
      let completeCallback: any;

      mockLlmService.generateResponse.mockImplementation(
        async (_messages, { onStream, onComplete } = {}) => {
          streamCallback = onStream!;
          completeCallback = onComplete!;
          return 'Response';
        },
      );

      const messages = [createMessage({ role: 'user', content: 'Hi' })];
      const promise = generationService.generateResponse(conversationId, messages);
      await flushPromises();

      streamCallback?.('Hello');
      await flushPromises();
      completeCallback?.('');
      await promise;
    };

    it('increments textGenerationCount on successful generation', async () => {
      await runTextGeneration();
      expect(getAppState().textGenerationCount).toBe(1);
    });

    it('does not emit share prompt on the first text generation (avoids first-run stacking)', async () => {
      await runTextGeneration();

      expect(shareListener).not.toHaveBeenCalled();
      await wait(1600);
      expect(shareListener).not.toHaveBeenCalled();
    });

    it('emits the share prompt on the 2nd text generation (after delay)', async () => {
      useAppStore.setState({ textGenerationCount: 1 });

      await runTextGeneration();
      expect(shareListener).not.toHaveBeenCalled();
      await wait(1600);
      expect(shareListener).toHaveBeenCalledWith('text');
      expect(getAppState().textGenerationCount).toBe(2);
    });

    it('emits AT MOST ONCE per session across many generations (no 2/10/20 re-show)', async () => {
      // Second generation triggers it once; later generations in the SAME session must
      // NOT re-show it (the old cadence re-showed at 10, 20, …).
      useAppStore.setState({ textGenerationCount: 1 });
      await runTextGeneration(); // count → 2, fires
      await wait(1600);
      expect(shareListener).toHaveBeenCalledTimes(1);

      await runTextGeneration(); // → 3, same session
      await runTextGeneration(); // → 4, same session
      await wait(1600);
      expect(shareListener).toHaveBeenCalledTimes(1); // still exactly once
    });
  });

  // ============================================================================
  // Text Generation Error → No Share Prompt
  // ============================================================================
  describe('failed text generation does not trigger share prompt', () => {
    it('does not increment count when generation throws', async () => {
      const modelId = setupWithActiveModel();
      const conversationId = setupWithConversation({ modelId });

      mockLlmService.generateResponse.mockRejectedValue(new Error('Generation failed'));

      const messages = [createMessage({ role: 'user', content: 'Hi' })];
      await expect(
        generationService.generateResponse(conversationId, messages),
      ).rejects.toThrow('Generation failed');

      expect(getAppState().textGenerationCount).toBe(0);
      await wait(1600);
      expect(shareListener).not.toHaveBeenCalled();
    });
  });

  // ============================================================================
  // Stop Generation → Share Prompt (when content exists)
  // ============================================================================
  describe('stopped generation with content triggers share prompt', () => {
    it('increments count when stopped with partial content', async () => {
      const modelId = setupWithActiveModel();
      const conversationId = setupWithConversation({ modelId });

      let streamCallback: any;

      mockLlmService.generateResponse.mockImplementation(
        async (_messages, { onStream } = {}) => {
          streamCallback = onStream!;
          // Never call onComplete — simulates long-running gen
          await new Promise(() => {}); // hang forever
          return '';
        },
      );

      const messages = [createMessage({ role: 'user', content: 'Hi' })];
      generationService.generateResponse(conversationId, messages);
      await flushPromises();

      // Stream some content
      streamCallback?.('Partial response');
      await flushPromises();

      // Stop with content
      await generationService.stopGeneration();

      expect(getAppState().textGenerationCount).toBe(1);
      // First generation doesn't trigger share prompt (skipped until 2nd)
      await wait(1600);
      expect(shareListener).not.toHaveBeenCalled();
    });
  });

  // ============================================================================
  // Image Generation → Share Prompt
  // ============================================================================
  describe('image generation triggers share prompt', () => {
    const setupImageModel = () => {
      const imageModel = createONNXImageModel({
        id: 'img-model-1',
        modelPath: '/mock/image-model',
      });
      useAppStore.setState({
        downloadedImageModels: [imageModel],
        activeImageModelId: 'img-model-1',
        generatedImages: [],
        settings: {
          imageSteps: 20, imageGuidanceScale: 7.5,
          imageWidth: 512, imageHeight: 512, imageThreads: 4,
          enhanceImagePrompts: false,
        } as any,
      });
      mockLocalDreamService.isModelLoaded.mockResolvedValue(true);
      mockLocalDreamService.getLoadedModelPath.mockResolvedValue('/mock/image-model');
      mockLocalDreamService.getLoadedThreads.mockReturnValue(4);
      mockLocalDreamService.generateImage.mockResolvedValue({
        id: 'gen-img-1', prompt: 'sunset', imagePath: '/mock/image.png',
        width: 512, height: 512, steps: 20, seed: 12345,
        modelId: 'img-model-1', createdAt: new Date().toISOString(),
      });
    };

    it('increments imageGenerationCount on successful generation', async () => {
      setupImageModel();
      await imageGenerationService.generateImage({ prompt: 'sunset' });
      expect(getAppState().imageGenerationCount).toBe(1);
    });

    it('does not emit share prompt on first image generation (delayed to 2nd)', async () => {
      setupImageModel();
      await imageGenerationService.generateImage({ prompt: 'sunset' });

      expect(shareListener).not.toHaveBeenCalled();
      await wait(2100);
      expect(shareListener).not.toHaveBeenCalled();
    });

    it('emits share prompt on 2nd image generation (after delay)', async () => {
      setupImageModel();
      useAppStore.setState({ imageGenerationCount: 1 });

      await imageGenerationService.generateImage({ prompt: 'sunset' });
      expect(shareListener).not.toHaveBeenCalled();
      await wait(2100);
      expect(shareListener).toHaveBeenCalledWith('image');
      expect(getAppState().imageGenerationCount).toBe(2);
    });

    it('emits AT MOST ONCE per session across image generations (no 20th re-show)', async () => {
      setupImageModel();
      useAppStore.setState({ imageGenerationCount: 1 });

      await imageGenerationService.generateImage({ prompt: 'sunset' }); // → 2, fires
      await wait(2100);
      expect(shareListener).toHaveBeenCalledTimes(1);

      await imageGenerationService.generateImage({ prompt: 'sunset' }); // → 3, same session
      await imageGenerationService.generateImage({ prompt: 'sunset' }); // → 4, same session
      await wait(2100);
      expect(shareListener).toHaveBeenCalledTimes(1); // still exactly once
    });

    it('does not increment count when image generation fails', async () => {
      setupImageModel();
      mockLocalDreamService.generateImage.mockRejectedValue(new Error('GPU error'));

      await imageGenerationService.generateImage({ prompt: 'sunset' });

      expect(getAppState().imageGenerationCount).toBe(0);
      await wait(2100);
      expect(shareListener).not.toHaveBeenCalled();
    });

    it('does not increment count when image generation returns null result', async () => {
      setupImageModel();
      mockLocalDreamService.generateImage.mockResolvedValue(null as any);

      await imageGenerationService.generateImage({ prompt: 'sunset' });

      expect(getAppState().imageGenerationCount).toBe(0);
      await wait(2100);
      expect(shareListener).not.toHaveBeenCalled();
    });
  });
});
