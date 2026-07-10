/**
 * RED-FLOW (UI integration) — Q1 + Q7: the image size / guidance the user set is not what gets used.
 *
 * Flow: with an image model already resident, the user generates an image. The REAL
 * imageGenerationService runs; the ONLY thing faked is the native diffusion module (via the harness),
 * whose generateImage ECHOES the width/height it was handed (native renders at the requested size). We
 * then render the REAL ChatMessage the service wrote into the REAL chatStore and read the generation
 * details the user sees.
 *
 * Q1 — user set Image Size 128 → the details line shows "256x256" (imageGenerationService.ts:456 floors
 *      to SWEET_SPOT_SIZE) — the size shown is never used.
 * Q7 — imageGuidanceScale is 0/stale → the details line shows "cfg 2.0" (imageGenerationService.ts:452
 *      `|| 2.0` fallback) while every slider/default is 7.5.
 *
 * The model is pre-loaded on the fake so _ensureImageModelLoaded's already-loaded fast-path is taken
 * (no native model load, no filesystem integrity scan needed).
 */
import { installNativeBoundary, GB, requireRTL } from '../../harness/nativeBoundary';
import { createONNXImageModel } from '../../utils/factories';

async function generateWithSettings(settings: Record<string, unknown>) {
  const boundary = installNativeBoundary({ ram: { platform: 'android', totalBytes: 12 * GB, availBytes: 8 * GB } });
  /* eslint-disable @typescript-eslint/no-var-requires */
  const React = require('react');
  const { render } = requireRTL();
  const { imageGenerationService } = require('../../../src/services/imageGenerationService');
  const { localDreamGeneratorService } = require('../../../src/services/localDreamGenerator');
  const { useAppStore, useChatStore } = require('../../../src/stores');
  const { ChatMessage } = require('../../../src/components/ChatMessage');
  /* eslint-enable @typescript-eslint/no-var-requires */

  const model = createONNXImageModel({ id: 'sd', name: 'SD Test', modelPath: '/models/sd', backend: 'mnn' });
  useAppStore.setState({ downloadedImageModels: [model], activeImageModelId: 'sd' });
  useAppStore.getState().updateSettings({
    imageThreads: 4, imageUseOpenCL: false, enhanceImagePrompts: false, imageSteps: 8, ...settings,
  });

  // Pre-load so the already-loaded fast path in _ensureImageModelLoaded is taken (skips FS integrity).
  boundary.diffusion.module.getLoadedModelPath.mockResolvedValue(model.modelPath);
  await localDreamGeneratorService.loadModel(model.modelPath, 4, {});

  const conversationId = useChatStore.getState().createConversation('sd');
  await imageGenerationService.generateImage({ prompt: 'a cat', conversationId });

  const messages = useChatStore.getState().getConversationMessages(conversationId);
  const assistant = [...messages].reverse().find((m: { role: string }) => m.role === 'assistant');
  return render(React.createElement(ChatMessage, { message: assistant, showGenerationDetails: true }));
}

describe('image gen meta — UI red-flow (the size/guidance you set is what runs)', () => {
  it('Q1: generating at Image Size 128 shows the size actually used as 128x128', async () => {
    const view = await generateWithSettings({ imageWidth: 128, imageHeight: 128 });
    // Proves the details line rendered (not a missing-element false red): today it shows 256x256...
    expect(view.queryByText(/256x256/)).not.toBeNull();
    // ...but the user set 128. Correct: the size used matches the setting → RED today.
    expect(view.queryByText(/128x128/)).not.toBeNull();
  });

  it('Q7: with guidance 0/stale the generation uses the 7.5 default, not 2.0', async () => {
    const view = await generateWithSettings({ imageGuidanceScale: 0, imageWidth: 256, imageHeight: 256 });
    // Today the details line shows "cfg 2.0" (the || 2.0 fallback)...
    expect(view.queryByText(/cfg 2/)).not.toBeNull();
    // ...while every slider/default is 7.5. Correct: generation uses 7.5 → RED today.
    expect(view.queryByText(/cfg 7\.5/)).not.toBeNull();
  });
});
