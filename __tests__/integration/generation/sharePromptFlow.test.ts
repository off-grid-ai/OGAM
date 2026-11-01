/**
 * Integration Tests: Share Prompt Flow
 *
 * Tests the integration between:
 * - generationService → appStore (text generation count increment)
 * - imageGenerationService → appStore (image generation count increment)
 * - sharePrompt pub/sub (emit/subscribe lifecycle)
 * - shouldShowSharePrompt trigger logic at correct milestones
 *
 * Verifies that the share prompt is emitted at the right times (the 2nd generation, at most once
 * per session) and not emitted on failed/aborted generations.
 *
 * Real: generationService, imageGenerationService, llmService, activeModelService, the residency
 * manager, sharePrompt, the stores. Faked, because they are the phone: llama.rn and the
 * image-generation native module, the disk and RAM (generationDevice). Earlier generations are
 * run for real rather than seeded into the counters.
 */
import { launchGeneration, type GenerationDevice } from '../../harness/generationDevice';
import { SD_MNN_PACKAGE_FILES } from '../../harness/imageModelPackage';
import { wait } from '../../utils/testHelpers';

let device: GenerationDevice;
let shareListener: jest.Mock;
let unsubscribe: () => void;
let imageGenerationService: any;

const appState = () => device.useAppStore.getState();

beforeEach(async () => {
  device = await launchGeneration({ engine: 'llama' });
  ({ imageGenerationService } = require('../../../src/services/imageGenerationService'));
  const { subscribeSharePrompt, resetSharePromptSession } = require('../../../src/utils/sharePrompt');
  resetSharePromptSession(); // fresh app session per test (the sheet is once-per-session)
  shareListener = jest.fn();
  unsubscribe = subscribeSharePrompt(shareListener);
});

afterEach(() => {
  unsubscribe();
});

/** One text turn the model answers in full. */
async function runTextGeneration(): Promise<void> {
  device.boundary.llama!.scriptCompletion({ text: 'Hello' });
  await device.generationService.generateResponse(device.conversationId, device.ask('Hi'));
}

// ============================================================================
// Text Generation → Share Prompt
// ============================================================================
describe('text generation triggers share prompt', () => {
  it('increments textGenerationCount on successful generation', async () => {
    await runTextGeneration();
    expect(appState().textGenerationCount).toBe(1);
  });

  it('does not emit share prompt on the first text generation (avoids first-run stacking)', async () => {
    await runTextGeneration();

    expect(shareListener).not.toHaveBeenCalled();
    await wait(1600);
    expect(shareListener).not.toHaveBeenCalled();
  });

  it('emits the share prompt on the 2nd text generation (after delay)', async () => {
    await runTextGeneration();
    await runTextGeneration();
    expect(shareListener).not.toHaveBeenCalled();
    await wait(1600);
    expect(shareListener).toHaveBeenCalledWith('text');
    expect(appState().textGenerationCount).toBe(2);
  });

  it('emits AT MOST ONCE per session across many generations (no 2/10/20 re-show)', async () => {
    // Second generation triggers it once; later generations in the SAME session must
    // NOT re-show it (the old cadence re-showed at 10, 20, …).
    await runTextGeneration();
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
    device.boundary.llama!.scriptCompletion({ throwMessage: 'Generation failed' });

    await expect(
      device.generationService.generateResponse(device.conversationId, device.ask('Hi')),
    ).rejects.toThrow('Generation failed');

    expect(appState().textGenerationCount).toBe(0);
    await wait(1600);
    expect(shareListener).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Stop Generation → Share Prompt (when content exists)
// ============================================================================
describe('stopped generation with content triggers share prompt', () => {
  it('increments count when stopped with partial content', async () => {
    // The model streams part of an answer and is still going.
    device.boundary.llama!.scriptCompletion({ text: 'Partial response and more', pauseAfter: 'Partial response' });
    device.generationService.generateResponse(device.conversationId, device.ask('Hi')).catch(() => {});
    const deadline = Date.now() + 4000;
    while (!device.useChatStore.getState().streamingMessage?.includes('Partial') && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }

    // Stop with content
    await device.generationService.stopGeneration();

    expect(appState().textGenerationCount).toBe(1);
    // First generation doesn't trigger share prompt (skipped until 2nd)
    await wait(1600);
    expect(shareListener).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Image Generation → Share Prompt
// ============================================================================
describe('image generation triggers share prompt', () => {
  /** A downloaded image model, as a finished download leaves it, selected for image generation. */
  const setupImageModel = async () => {
    const { modelManager } = require('../../../src/services/modelManager');
    const modelPath = `${modelManager.getImageModelsDirectory()}/img-model-1`;
    for (const name of SD_MNN_PACKAGE_FILES) device.boundary.fs!.seedFile(`${modelPath}/${name}`, 1024 * 1024);
    const model = { id: 'img-model-1', name: 'Image Model', description: '', size: 500 * 1024 * 1024, modelPath, backend: 'mnn' };
    await modelManager.addDownloadedImageModel(model);
    appState().addDownloadedImageModel(model);
    appState().setActiveImageModelId('img-model-1');
    appState().updateSettings({
      imageSteps: 20, imageGuidanceScale: 7.5, imageWidth: 512, imageHeight: 512, imageThreads: 4,
      enhanceImagePrompts: false,
    } as never);
  };
  const diffusion = () => device.boundary.diffusion.module;

  it('increments imageGenerationCount on successful generation', async () => {
    await setupImageModel();
    await imageGenerationService.generateImage({ prompt: 'sunset' });
    expect(appState().imageGenerationCount).toBe(1);
  });

  it('does not emit share prompt on first image generation (delayed to 2nd)', async () => {
    await setupImageModel();
    await imageGenerationService.generateImage({ prompt: 'sunset' });

    expect(shareListener).not.toHaveBeenCalled();
    await wait(2100);
    expect(shareListener).not.toHaveBeenCalled();
  });

  it('emits share prompt on 2nd image generation (after delay)', async () => {
    await setupImageModel();
    await imageGenerationService.generateImage({ prompt: 'sunset' });

    await imageGenerationService.generateImage({ prompt: 'sunset' });
    expect(shareListener).not.toHaveBeenCalled();
    await wait(2100);
    expect(shareListener).toHaveBeenCalledWith('image');
    expect(appState().imageGenerationCount).toBe(2);
  });

  it('emits AT MOST ONCE per session across image generations (no 20th re-show)', async () => {
    await setupImageModel();
    await imageGenerationService.generateImage({ prompt: 'sunset' });

    await imageGenerationService.generateImage({ prompt: 'sunset' }); // → 2, fires
    await wait(2100);
    expect(shareListener).toHaveBeenCalledTimes(1);

    await imageGenerationService.generateImage({ prompt: 'sunset' }); // → 3, same session
    await imageGenerationService.generateImage({ prompt: 'sunset' }); // → 4, same session
    await wait(2100);
    expect(shareListener).toHaveBeenCalledTimes(1); // still exactly once
  });

  it('does not increment count when image generation fails', async () => {
    await setupImageModel();
    diffusion().generateImage.mockRejectedValueOnce(new Error('GPU error'));

    await imageGenerationService.generateImage({ prompt: 'sunset' });

    expect(appState().imageGenerationCount).toBe(0);
    await wait(2100);
    expect(shareListener).not.toHaveBeenCalled();
  });

  it('does not increment count when image generation returns null result', async () => {
    await setupImageModel();
    diffusion().generateImage.mockResolvedValueOnce(null);

    await imageGenerationService.generateImage({ prompt: 'sunset' });

    expect(appState().imageGenerationCount).toBe(0);
    await wait(2100);
    expect(shareListener).not.toHaveBeenCalled();
  });
});
