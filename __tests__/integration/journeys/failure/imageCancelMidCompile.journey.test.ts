/**
 * FAILURE JOURNEY — cancel an image generation while the model is COMPILING/loading.
 *
 * Cluster D. Drives the REAL imageGenerationService state machine + REAL appStore.
 * Only the native boundaries (localDreamGenerator, activeModelService, engines) are
 * faked. The load boundary is DYNAMIC: loadImageModel HANGS (simulating the ~120s
 * first-run compile) until the test cancels, then resolves — so we exercise the
 * "cancel arrived during compile" ordering, not a load that finished first.
 *
 * Terminal artifacts asserted:
 *   - after cancel the phase returns to 'idle' (isGenerating false, appStore mirror false).
 *   - the compile that finishes AFTER cancel does NOT proceed to generate/save — no
 *     image is added, no assistant message is appended (a cancelled turn produces nothing).
 *   - a fresh generation after the cancel runs to completion (cancelRequested reset).
 */
import { imageGenerationService } from '../../../../src/services/imageGenerationService';
import { localDreamGeneratorService } from '../../../../src/services/localDreamGenerator';
import { activeModelService } from '../../../../src/services/activeModelService';
import { useAppStore } from '../../../../src/stores/appStore';
import { useChatStore } from '../../../../src/stores/chatStore';
import { resetStores, flushPromises } from '../../../utils/testHelpers';
import { createONNXImageModel } from '../../../utils/factories';

jest.mock('../../../../src/services/localDreamGenerator');
jest.mock('../../../../src/services/activeModelService');
jest.mock('../../../../src/services/engines', () => ({
  getActiveEngineService: jest.fn(() => null),
  generateStandalone: jest.fn(async () => ''),
}));
jest.mock('../../../../src/services/proPrompt', () => ({ checkProPromptForImage: jest.fn() }));
jest.mock('../../../../src/services/modelFailureHandler', () => ({ reportModelFailure: jest.fn() }));

const mockDream = localDreamGeneratorService as jest.Mocked<typeof localDreamGeneratorService>;
const mockActive = activeModelService as jest.Mocked<typeof activeModelService>;

describe('failure journey — cancel image generation mid-compile', () => {
  beforeEach(() => {
    resetStores();
    jest.clearAllMocks();
    const model = createONNXImageModel();
    useAppStore.setState({
      downloadedImageModels: [model],
      activeImageModelId: model.id,
      settings: { ...useAppStore.getState().settings, enhanceImagePrompts: false },
      warmedImageModels: [],
    } as any);
    mockDream.isModelLoaded.mockResolvedValue(false);
    mockDream.getLoadedModelPath.mockResolvedValue(null as any);
    mockDream.getLoadedThreads.mockReturnValue(null as any);
    mockDream.cancelGeneration.mockResolvedValue(undefined as any);
    mockDream.generateImage.mockImplementation(async () => ({ id: 'img', imagePath: '/x.png', width: 512, height: 512 } as any));
  });

  it('cancel during compile returns to idle and produces NO image or message', async () => {
    let resolveLoad: (() => void) | null = null;
    // DYNAMIC: loadImageModel hangs (compiling) until we release it post-cancel.
    mockActive.loadImageModel.mockImplementation(() => new Promise<void>((res) => { resolveLoad = res; }));
    mockActive.unloadImageModel.mockResolvedValue(undefined as any);

    const genPromise = imageGenerationService.generateImage({ prompt: 'a cat', conversationId: 'c1' });
    await flushPromises();
    // Mid-compile: the service is in-flight (loading).
    expect(imageGenerationService.getState().isGenerating).toBe(true);
    expect(imageGenerationService.getState().phase).toBe('loading');

    // USER CANCELS during compile.
    await imageGenerationService.cancelGeneration();
    await flushPromises();
    expect(imageGenerationService.getState().phase).toBe('idle');
    expect(imageGenerationService.getState().isGenerating).toBe(false);
    expect(useAppStore.getState().isGeneratingImage).toBe(false);

    // The compile now finishes — but the cancelled turn must NOT proceed to generate.
    resolveLoad!();
    const result = await genPromise;
    await flushPromises();

    expect(result).toBeNull();
    expect(mockDream.generateImage).not.toHaveBeenCalled();
    expect(useAppStore.getState().generatedImages).toHaveLength(0);
    const conv = useChatStore.getState().conversations.find(c => c.id === 'c1');
    expect((conv?.messages ?? []).filter(m => m.role === 'assistant')).toHaveLength(0);
  });

  it('a fresh generation after the cancel completes (cancelRequested was reset)', async () => {
    // First: a clean load so the fresh generation runs end-to-end.
    mockActive.loadImageModel.mockResolvedValue(undefined as any);
    const result = await imageGenerationService.generateImage({ prompt: 'a dog', conversationId: 'c2' });
    await flushPromises();
    expect(result).not.toBeNull();
    expect(mockDream.generateImage).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().generatedImages.length).toBeGreaterThan(0);
    expect(imageGenerationService.getState().phase).toBe('done');
  });
});
