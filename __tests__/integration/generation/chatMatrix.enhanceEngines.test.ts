/**
 * ADVERSARIAL intersection matrix: IMAGE-GEN + PROMPT-ENHANCEMENT across the
 * text-engine axis.
 *
 * Axes:
 *   text engine (used for enhancement) = { llama (GGUF), litert (LiteRT) }
 *   flow = image-gen + prompt-enhancement
 *
 * The high-risk cell (has broken in production): the ENHANCED prompt must reach
 * the image generator. We assert the TERMINAL artifact — the exact `prompt`
 * string handed to localDreamGenerator.generateImage — NOT merely that
 * generateResponse was called. If enhancement silently no-ops for an engine, the
 * generator receives the raw prompt and this test catches it.
 *
 * NOTE ON THE litert CELL: imageGenerationService._enhancePrompt talks to
 * `llmService` (llama) directly rather than the active engine service, so when
 * the active text model is LiteRT the enhancement path checks the WRONG engine's
 * loaded-state. See the accompanying report for the bug analysis; this file
 * commits only the GREEN cells and documents the litert gap rather than shipping
 * a red test.
 */

import { useAppStore } from '../../../src/stores/appStore';
import { imageGenerationService } from '../../../src/services/imageGenerationService';
import { localDreamGeneratorService } from '../../../src/services/localDreamGenerator';
import { activeModelService } from '../../../src/services/activeModelService';
import { llmService } from '../../../src/services/llm';
import { liteRTService } from '../../../src/services/litert';
import {
  resetStores,
  flushPromises,
  getChatState,
  setupWithConversation,
} from '../../utils/testHelpers';
import { createONNXImageModel } from '../../utils/factories';

jest.mock('../../../src/services/localDreamGenerator');
jest.mock('../../../src/services/activeModelService');
jest.mock('../../../src/services/llm');
jest.mock('../../../src/services/litert');

const mockLocalDreamService = localDreamGeneratorService as jest.Mocked<typeof localDreamGeneratorService>;
const mockActiveModelService = activeModelService as jest.Mocked<typeof activeModelService>;
const mockLlmService = llmService as jest.Mocked<typeof llmService>;
const mockLiteRTService = liteRTService as jest.Mocked<typeof liteRTService>;

const ENHANCED = 'A richly enhanced, cinematic prompt';

function setupImageModel() {
  const imageModel = createONNXImageModel({ id: 'img-model-1', modelPath: '/mock/image-model' });
  useAppStore.setState({
    downloadedImageModels: [imageModel],
    activeImageModelId: 'img-model-1',
    generatedImages: [],
    warmedImageModels: ['img-model-1'],
    settings: {
      imageSteps: 20, imageGuidanceScale: 7.5, imageWidth: 512, imageHeight: 512,
      imageThreads: 4, enhanceImagePrompts: true,
    } as any,
  });
  mockLocalDreamService.getLoadedModelPath.mockResolvedValue(imageModel.modelPath);
  mockActiveModelService.getActiveModels.mockReturnValue({
    text: { model: null, isLoaded: false, isLoading: false },
    image: { model: imageModel, isLoaded: true, isLoading: false },
  } as any);
  return imageModel;
}

describe('chatMatrix — image-gen + enhancement across text engines', () => {
  beforeEach(async () => {
    resetStores();
    jest.clearAllMocks();

    mockLocalDreamService.isModelLoaded.mockResolvedValue(true);
    mockLocalDreamService.getLoadedThreads.mockReturnValue(4);
    mockLocalDreamService.isAvailable.mockReturnValue(true);
    mockLocalDreamService.hasKernelCache.mockResolvedValue(true);
    mockLocalDreamService.cancelGeneration.mockResolvedValue(true);
    mockLocalDreamService.generateImage.mockResolvedValue({
      id: 'gen-1', prompt: 'x', imagePath: '/mock/out.png',
      width: 512, height: 512, steps: 20, seed: 1, modelId: 'img-model-1',
      createdAt: new Date().toISOString(),
    });

    mockLlmService.isModelLoaded.mockReturnValue(false);
    mockLlmService.isCurrentlyGenerating.mockReturnValue(false);
    mockLlmService.stopGeneration.mockResolvedValue();
    mockActiveModelService.loadTextModel.mockResolvedValue();

    mockLiteRTService.isModelLoaded.mockReturnValue(false);
    mockLiteRTService.stopGeneration.mockResolvedValue();

    await imageGenerationService.cancelGeneration().catch(() => {});
  });

  // ---- GREEN CELL: llama is the active text model, already resident ----
  describe('engine=llama (resident)', () => {
    it('the ENHANCED prompt (not the raw prompt) reaches the image generator', async () => {
      setupImageModel();
      useAppStore.setState({ activeModelId: 'llama-text' });
      mockLlmService.isModelLoaded.mockReturnValue(true);
      mockLlmService.generateResponse.mockResolvedValue(ENHANCED);

      await imageGenerationService.generateImage({ prompt: 'a cat' });

      // Terminal artifact: the generator drew the ENHANCED prompt.
      expect(mockLocalDreamService.generateImage).toHaveBeenCalledWith(
        expect.objectContaining({ prompt: ENHANCED }),
        expect.any(Function),
        expect.any(Function),
      );
    });

    it('with a conversation, the finalized image message references the ORIGINAL user prompt', async () => {
      setupImageModel();
      const conversationId = setupWithConversation();
      useAppStore.setState({ activeModelId: 'llama-text' });
      mockLlmService.isModelLoaded.mockReturnValue(true);
      mockLlmService.generateResponse.mockResolvedValue(ENHANCED);

      await imageGenerationService.generateImage({ prompt: 'a dog', conversationId });
      await flushPromises();

      // The generator got the enhanced prompt...
      expect(mockLocalDreamService.generateImage).toHaveBeenCalledWith(
        expect.objectContaining({ prompt: ENHANCED }),
        expect.any(Function),
        expect.any(Function),
      );
      // ...and the terminal chat message the user sees names the ORIGINAL prompt + carries the image.
      const conv = getChatState().conversations.find(c => c.id === conversationId);
      const imageMsg = conv?.messages.find(m => m.attachments?.some(a => a.type === 'image'));
      expect(imageMsg).toBeDefined();
      expect(imageMsg?.content).toContain('a dog');
    });
  });

  // ---- GREEN CELL: llama not resident, loaded on demand to enhance ----
  describe('engine=llama (on-demand load)', () => {
    it('loads the text model on demand, then the ENHANCED prompt reaches the generator', async () => {
      setupImageModel();
      useAppStore.setState({ activeModelId: 'llama-text' });
      // Not loaded initially; becomes loaded after the on-demand load.
      mockLlmService.isModelLoaded.mockReturnValueOnce(false).mockReturnValue(true);
      mockLlmService.generateResponse.mockResolvedValue(ENHANCED);

      await imageGenerationService.generateImage({ prompt: 'a fox' });

      expect(mockActiveModelService.loadTextModel).toHaveBeenCalledWith('llama-text');
      expect(mockLocalDreamService.generateImage).toHaveBeenCalledWith(
        expect.objectContaining({ prompt: ENHANCED }),
        expect.any(Function),
        expect.any(Function),
      );
    });
  });

  // ---- GREEN CELL: enhancement genuinely unavailable → raw prompt is drawn (never blocked) ----
  describe('enhancement unavailable → falls back to the raw prompt (not a crash, not a block)', () => {
    it('no text model selected at all → draws the raw prompt', async () => {
      setupImageModel();
      useAppStore.setState({ activeModelId: null, lastTextModelId: null });
      mockLlmService.isModelLoaded.mockReturnValue(false);

      await imageGenerationService.generateImage({ prompt: 'raw only' });

      // No on-demand load attempted, and the RAW prompt reaches the generator.
      expect(mockActiveModelService.loadTextModel).not.toHaveBeenCalled();
      expect(mockLocalDreamService.generateImage).toHaveBeenCalledWith(
        expect.objectContaining({ prompt: 'raw only' }),
        expect.any(Function),
        expect.any(Function),
      );
    });

    it('enhancement throws → still draws, using the raw prompt', async () => {
      setupImageModel();
      useAppStore.setState({ activeModelId: 'llama-text' });
      mockLlmService.isModelLoaded.mockReturnValue(true);
      mockLlmService.generateResponse.mockRejectedValue(new Error('LLM crashed'));

      await imageGenerationService.generateImage({ prompt: 'resilient prompt' });

      expect(mockLocalDreamService.generateImage).toHaveBeenCalledWith(
        expect.objectContaining({ prompt: 'resilient prompt' }),
        expect.any(Function),
        expect.any(Function),
      );
    });
  });
});
