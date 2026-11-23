/**
 * Content safety when a paired computer or remote server draws the image (Google Play AI-Generated
 * Content policy). The phone checks what comes back exactly as it checks its own images.
 *
 * Real ChatScreen, real image-mode toggle and send, real imageGenerationService and remote image
 * runner. Fakes only at the network (fetch: the image server; RNFS: the image transfer) and the
 * executorch classifier (jest.setup: ClassificationModule, scored via globalThis.__nsfwClassifier).
 */
import { setupChatScreen } from '../../harness/chatHarness';
import {
  REMOTE_IMAGE_URL,
  chooseRemoteImageModel,
  clearRemoteServers,
  serveImageGeneration,
} from '../../harness/remoteImageServer';

jest.unmock('@react-navigation/native');

describe('image content safety — remote image model', () => {
  let server: ReturnType<typeof serveImageGeneration>;

  afterEach(() => {
    server.restore();
    clearRemoteServers();
    delete (globalThis as any).__nsfwClassifier;
  });

  async function start(nsfw: number) {
    const classifier = { nsfw, classified: [] as string[], loadedFrom: [] as string[] };
    (globalThis as any).__nsfwClassifier = classifier;
    const h = await setupChatScreen({ navigation: 'real', engine: 'llama' });
    server = serveImageGeneration();
    const fs = h.boundary.fs!;
    // The classifier ships with the app; seed both places the app reads it from.
    fs.seedFile(`${fs.DocumentDirectoryPath}/nsfw_384_xnnpack_fp32.pte`, 1024);
    fs.seedFile(`${fs.module.MainBundlePath}/nsfw_384_xnnpack_fp32.pte`, 1024);
    fs.serveRemoteFile(REMOTE_IMAGE_URL, { body: 'synthetic-png-bytes', headers: { 'Content-Type': 'image/png' } });
    await chooseRemoteImageModel(h);
    const { BLOCKED_IMAGE_MESSAGE, BLOCKED_PROMPT_MESSAGE } = require('../../../src/services/contentSafety');
    const { useAppStore } = require('../../../src/stores');
    return { h, fs, classifier, useAppStore, BLOCKED_IMAGE_MESSAGE, BLOCKED_PROMPT_MESSAGE };
  }

  it('never sends a sexual prompt to the server', async () => {
    const t = await start(0);
    await t.h.tapSend('draw a nude woman');

    expect(await t.h.view!.findByText(t.BLOCKED_PROMPT_MESSAGE)).toBeTruthy();
    expect(server.requests).toBe(0);
    expect(t.h.view!.queryByTestId('generated-image')).toBeNull();
  });

  it('deletes an image the classifier marks and shows why', async () => {
    const t = await start(0.91);
    await t.h.tapSend('draw a lighthouse at dusk');

    expect(await t.h.view!.findByText(t.BLOCKED_IMAGE_MESSAGE)).toBeTruthy();
    expect(server.requests).toBe(1);
    expect(t.classifier.classified).toHaveLength(1);
    expect(t.h.view!.queryByTestId('generated-image')).toBeNull();
    expect(t.fs.listFiles(`${t.fs.DocumentDirectoryPath}/generated_images`)).toEqual([]);
    expect(t.useAppStore.getState().generatedImages).toHaveLength(0);
  });

  it('shows a safe image as before', async () => {
    const t = await start(0.03);
    await t.h.tapSend('draw a lighthouse at dusk');

    await t.h.rtl.waitFor(() => { expect(t.h.view!.queryByTestId('generated-image')).not.toBeNull(); });
    expect(t.classifier.classified).toHaveLength(1);
    expect(t.useAppStore.getState().generatedImages).toHaveLength(1);
  });
});
