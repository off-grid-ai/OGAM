/**
 * Content safety on the phone's own image model (Google Play AI-Generated Content policy).
 *
 * The REAL imageGenerationService runs. Faked are only the native leaves: the diffusion module (via
 * the harness, which writes the PNG into its in-memory file system) and the executorch classifier
 * (jest.setup: ClassificationModule, scored through globalThis.__nsfwClassifier).
 *
 * The invariants: a sexual prompt never reaches the diffusion module; an image the classifier marks
 * is deleted and never reaches the Gallery or the chat; a safe image is published as before.
 */
import { installNativeBoundary, GB } from '../../harness/nativeBoundary';
import { createONNXImageModel } from '../../utils/factories';

type Fake = { nsfw?: number; loadError?: Error; classified: string[]; loadedFrom: string[] };

async function setup(fake: Partial<Fake> = {}) {
  const classifier: Fake = { classified: [], loadedFrom: [], ...fake };
  (globalThis as any).__nsfwClassifier = classifier;
  const boundary = installNativeBoundary({
    ram: { platform: 'android', totalBytes: 12 * GB, availBytes: 8 * GB },
    fs: true,
  });
  // The classifier ships inside the APK; the harness file system starts empty, so seed the copy.
  const fs = boundary.fs!;
  fs.seedFile(`${fs.module.DocumentDirectoryPath}/nsfw_384_xnnpack_fp32.pte`, 23 * 1024 * 1024);

  const { imageGenerationService } = require('../../../src/services/imageGenerationService');
  const { localDreamGeneratorService } = require('../../../src/services/localDreamGenerator');
  const { useAppStore, useChatStore } = require('../../../src/stores');
  const contentSafety = require('../../../src/services/contentSafety');

  const model = createONNXImageModel({ id: 'sd', name: 'SD Test', modelPath: '/models/sd', backend: 'mnn' });
  useAppStore.setState({ downloadedImageModels: [model], activeImageModelId: 'sd', generatedImages: [] });
  useAppStore.getState().updateSettings({ imageThreads: 4, imageUseOpenCL: false, enhanceImagePrompts: false, imageSteps: 8 });
  boundary.diffusion.module.getLoadedModelPath.mockResolvedValue(model.modelPath);
  await localDreamGeneratorService.loadModel(model.modelPath, 4, {});
  const conversationId = useChatStore.getState().createConversation('sd');

  const assistantMessages = () =>
    useChatStore.getState().getConversationMessages(conversationId).filter((m: { role: string }) => m.role === 'assistant');
  return { boundary, classifier, imageGenerationService, useAppStore, conversationId, assistantMessages, contentSafety, fs };
}

afterEach(() => {
  delete (globalThis as any).__nsfwClassifier;
});

describe('image content safety — phone image model', () => {
  it('refuses a sexual prompt before the image model runs', async () => {
    const t = await setup();
    const result = await t.imageGenerationService.generateImage({ prompt: 'a n4ked woman', conversationId: t.conversationId });

    expect(result).toBeNull();
    expect(t.boundary.diffusion.calls.generateImage).toHaveLength(0);
    expect(t.imageGenerationService.getState()).toMatchObject({ phase: 'error', error: t.contentSafety.BLOCKED_PROMPT_MESSAGE });
    expect(t.useAppStore.getState().generatedImages).toHaveLength(0);
    expect(t.assistantMessages()).toHaveLength(0);
  });

  it('refuses when the style adds a blocked word', async () => {
    const t = await setup();
    await t.imageGenerationService.generateImage({ prompt: 'a portrait', styleWords: 'nsfw, detailed', conversationId: t.conversationId });

    expect(t.boundary.diffusion.calls.generateImage).toHaveLength(0);
    expect(t.imageGenerationService.getState().error).toBe(t.contentSafety.BLOCKED_PROMPT_MESSAGE);
  });

  it('deletes an image the classifier marks and publishes nothing', async () => {
    const t = await setup({ nsfw: 0.93 });
    const result = await t.imageGenerationService.generateImage({ prompt: 'a person at the beach', conversationId: t.conversationId });

    expect(result).toBeNull();
    expect(t.boundary.diffusion.calls.generateImage).toHaveLength(1);
    expect(t.classifier.classified).toHaveLength(1);
    const imagePath = t.classifier.classified[0].replace('file://', '');
    expect(await t.fs.module.exists(imagePath)).toBe(false);
    expect(t.imageGenerationService.getState()).toMatchObject({ phase: 'error', error: t.contentSafety.BLOCKED_IMAGE_MESSAGE, result: null });
    expect(t.useAppStore.getState().generatedImages).toHaveLength(0);
    expect(t.assistantMessages()).toHaveLength(0);
  });

  it('blocks the image when the classifier cannot run', async () => {
    const t = await setup({ loadError: new Error('bad program') });
    await t.imageGenerationService.generateImage({ prompt: 'a lighthouse', conversationId: t.conversationId });

    expect(t.imageGenerationService.getState().error).toBe(t.contentSafety.BLOCKED_IMAGE_MESSAGE);
    expect(t.useAppStore.getState().generatedImages).toHaveLength(0);
  });

  it('publishes a safe image as before', async () => {
    const t = await setup({ nsfw: 0.02 });
    const result = await t.imageGenerationService.generateImage({ prompt: 'a lighthouse at dusk', conversationId: t.conversationId });

    expect(result).not.toBeNull();
    expect(t.classifier.classified).toEqual([`file://${result.imagePath}`]);
    expect(await t.fs.module.exists(result.imagePath)).toBe(true);
    expect(t.imageGenerationService.getState()).toMatchObject({ phase: 'done' });
    expect(t.useAppStore.getState().generatedImages.map((i: { id: string }) => i.id)).toEqual([result.id]);
    expect(t.assistantMessages()).toHaveLength(1);
  });
});

describe('image content safety — images the Gallery could pick up later', () => {
  const until = async (check: () => boolean) => {
    for (let i = 0; i < 200 && !check(); i += 1) await new Promise(resolve => setTimeout(resolve, 5));
  };

  async function cancelWithFailedDelete(nsfw: number) {
    const t = await setup({ nsfw });
    const del = t.boundary.diffusion.module.deleteGeneratedImage;
    t.boundary.diffusion.holdNextGeneration();
    const making = t.imageGenerationService.generateImage({ prompt: 'a person at the beach', conversationId: t.conversationId });
    await until(() => t.boundary.diffusion.generationHeld());
    // Stop is pressed, and the phone cannot remove the image the engine still writes.
    del.mockResolvedValueOnce(false);
    await t.imageGenerationService.cancelGeneration();
    t.boundary.diffusion.releaseGeneration();
    await making;
    return t;
  }

  it('a stopped image the phone could not remove is checked, and a marked one never reaches the Gallery', async () => {
    const t = await cancelWithFailedDelete(0.95);
    expect(t.classifier.classified).toHaveLength(1);
    expect(t.useAppStore.getState().generatedImages).toHaveLength(0);
    expect(t.boundary.diffusion.module.deleteGeneratedImage).toHaveBeenCalledTimes(2);
  });

  it('a stopped image the phone could not remove is kept in the Gallery once it passes', async () => {
    const t = await cancelWithFailedDelete(0.02);
    expect(t.classifier.classified).toHaveLength(1);
    expect(t.useAppStore.getState().generatedImages).toHaveLength(1);
  });

  it('the Gallery adds an image found on disk only after it passes the check', async () => {
    const t = await setup({ nsfw: 0.9 });
    const docs = t.fs.module.DocumentDirectoryPath;
    const image = (id: string) => ({ id, prompt: 'p', imagePath: `${docs}/generated_images/${id}.png`, width: 512, height: 512, steps: 8, seed: 1, modelId: 'sd', createdAt: '2026-11-23T00:00:00.000Z' });
    t.fs.seedFile(`${docs}/generated_images/left-behind.png`, 1024);
    t.boundary.diffusion.seedGeneratedImages([image('left-behind')]);
    // The same React the app modules loaded (the harness gives each test a fresh registry).
    const { renderHook, waitFor } = require('@testing-library/react-native/pure');
    const { useGalleryActions } = require('../../../src/screens/GalleryScreen/useGalleryActions');
    const gallery = renderHook(() => useGalleryActions(undefined));
    await waitFor(() => expect(t.classifier.classified).toHaveLength(1));
    await waitFor(() => expect(t.boundary.diffusion.module.deleteGeneratedImage).toHaveBeenCalledWith('left-behind'));
    expect(t.useAppStore.getState().generatedImages).toHaveLength(0);
    expect(await t.fs.module.exists(`${docs}/generated_images/left-behind.png`)).toBe(false);
    gallery.unmount();
  });
});
