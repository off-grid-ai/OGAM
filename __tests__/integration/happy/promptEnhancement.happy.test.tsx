/**
 * HAPPY-PATH (integration) — image prompt enhancement: with enhancement ON, the active TEXT engine rewrites
 * the raw prompt and the ENHANCED prompt is what reaches the native image generator.
 *
 * Real imageGenerationService + real engines.generateStandalone (LiteRT) + real cleanEnhancedPrompt; only
 * the native LiteRT + diffusion leaves are faked. Green complement to Q8 (enhancement skipped for a remote
 * model). We assert the native generateImage received the enhanced text, not the raw 'a cat'.
 */
import { installNativeBoundary, GB, requireRTL } from '../../harness/nativeBoundary';
import { createONNXImageModel, createDownloadedModel } from '../../utils/factories';

describe('happy — image prompt enhancement rewrites the prompt via the text engine', () => {
  it('sends the enhanced prompt (not the raw one) to the native image generator', async () => {
    const boundary = installNativeBoundary({ llama: true, fs: true, ram: { platform: 'android', totalBytes: 12 * GB, availBytes: 8 * GB } });
    /* eslint-disable @typescript-eslint/no-var-requires */
    requireRTL();
    const { llmService } = require('../../../src/services/llm');
    const { hardwareService } = require('../../../src/services/hardware');
    const { imageGenerationService } = require('../../../src/services/imageGenerationService');
    const { localDreamGeneratorService } = require('../../../src/services/localDreamGenerator');
    const { useAppStore, useChatStore } = require('../../../src/stores');
    /* eslint-enable @typescript-eslint/no-var-requires */

    // A llama.cpp text engine is active + loaded (it runs the enhancement via generateResponse).
    boundary.fs!.seedFile('/models/small.gguf', 500 * 1024 * 1024);
    await hardwareService.refreshMemoryInfo();
    await llmService.loadModel('/models/small.gguf');
    const textModel = createDownloadedModel({ id: 'llm', engine: 'llama', filePath: '/models/small.gguf' });
    const imageModel = createONNXImageModel({ id: 'sd', name: 'SD', modelPath: '/models/sd', backend: 'mnn' });
    useAppStore.setState({ downloadedModels: [textModel], activeModelId: 'llm', downloadedImageModels: [imageModel], activeImageModelId: 'sd' });
    useAppStore.getState().updateSettings({ imageThreads: 4, imageUseOpenCL: false, enhanceImagePrompts: true, imageSteps: 8 });

    // The text engine's enhancement output.
    boundary.llama!.scriptCompletion({ text: 'a photorealistic tabby cat, studio lighting, ultra detailed' });

    // Pre-load the image model (skip FS integrity; the GENERATE path stays real).
    boundary.diffusion.module.getLoadedModelPath.mockResolvedValue(imageModel.modelPath);
    await localDreamGeneratorService.loadModel(imageModel.modelPath, 4, {});

    const conversationId = useChatStore.getState().createConversation('lrt');
    await imageGenerationService.generateImage({ prompt: 'a cat', conversationId });

    // The enhanced prompt (from the real text engine) is what the native image generator received.
    const nativePrompt = String(boundary.diffusion.calls.generateImage[0].prompt);
    expect(nativePrompt).toMatch(/photorealistic tabby cat/);
    expect(nativePrompt).not.toBe('a cat');
  });
});
