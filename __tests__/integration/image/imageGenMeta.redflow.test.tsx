/**
 * RED-FLOW (UI integration) — Q1 + Q7: the image size / guidance the user set is not what gets used.
 *
 * Flow: with an image model already resident, the user generates an image. The REAL
 * imageGenerationService runs; the ONLY thing faked is the native diffusion module (via the harness),
 * whose generateImage ECHOES the width/height it was handed (native renders at the requested size). We
 * then render the REAL ChatMessage the service wrote into the REAL chatStore and read the generation
 * details the user sees.
 *
 * Q1 (GUARD, green) — 128 is NOT a supported image size; the pipeline correctly floors to the sweet spot
 *      (256), and the details line shows "256x256". Locks that intended behavior. (Confirmed with the
 *      product owner: stop at 256.)
 * Q7 (RED) — imageGuidanceScale is 0/stale → the details line shows "cfg 2.0" (imageGenerationService.ts:452
 *      `|| 2.0` fallback) while the slider default is 7.5 — the shown default and the used default DIVERGE.
 *
 * The model is pre-loaded on the fake so _ensureImageModelLoaded's already-loaded fast-path is taken.
 * (NOTE: entry is at the imageGenerationService layer + real ChatMessage meta render. A full ChatScreen
 * force-mode + send gesture entry is deferred — that flow is fragile in jest via the quick-settings popover;
 * see UI_BEHAVIORAL_CONVERSION_STATUS.md.)
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
  it('Q1 (guard): an unsupported 128 size correctly floors to 256x256', async () => {
    const view = await generateWithSettings({ imageWidth: 128, imageHeight: 128 });
    // 128 is not supported; the pipeline floors to the 256 sweet spot and the details show it. Correct.
    expect(view.queryByText(/256x256/)).not.toBeNull();
    expect(view.queryByText(/128x128/)).toBeNull();
  });

  it('Q7: with guidance 0/stale the generation uses the 7.5 default, not 2.0', async () => {
    const view = await generateWithSettings({ imageGuidanceScale: 0, imageWidth: 256, imageHeight: 256 });
    // With a stale/0 guidance the generation must fall back to the single-source 7.5 default
    // (DEFAULT_IMAGE_GUIDANCE), NOT the old magic || 2.0. The details line the user sees shows it.
    expect(view.queryByText(/cfg 7\.5/)).not.toBeNull();
    // And the old buggy 2.0 fallback must be gone.
    expect(view.queryByText(/cfg 2/)).toBeNull();
  });
});
