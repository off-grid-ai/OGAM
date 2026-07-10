/**
 * HAPPY-PATH (UI integration) — smart budgeting: a model that FITS the real budget loads, becomes resident,
 * and the user sees NO "Not Enough Memory" failure card. GREEN counterpart to the M-series reds (which are
 * the over-admit / over-refuse edges).
 *
 * The REAL modelResidencyManager + memoryBudget + imageGenerationService run over the seeded native RAM
 * leaf (nativeBoundary) — no mock of the budget logic. We assert the resident set AND the rendered UI
 * (ModelFailureCard shows nothing). This is the regression floor: a change that breaks the fits path (or
 * spuriously refuses a fittable load) fails here.
 */
import { installNativeBoundary, GB, MB, requireRTL } from '../../harness/nativeBoundary';
import { createONNXImageModel } from '../../utils/factories';

describe('happy — a fittable load succeeds and shows no failure card', () => {
  it('generates an image on ample RAM, becomes resident, no ModelFailureCard', async () => {
    const boundary = installNativeBoundary({ ram: { platform: 'ios', totalBytes: 12 * GB, availBytes: 8 * GB } });
    void boundary;
    /* eslint-disable @typescript-eslint/no-var-requires */
    const React = require('react');
    const { render } = requireRTL();
    const { imageGenerationService } = require('../../../src/services/imageGenerationService');
    const { modelResidencyManager } = require('../../../src/services/modelResidency');
    const { hardwareService } = require('../../../src/services/hardware');
    const { useAppStore, useChatStore } = require('../../../src/stores');
    const { ModelFailureCard } = require('../../../src/components/ModelFailureCard');
    /* eslint-enable @typescript-eslint/no-var-requires */

    // A small CoreML image model (skips the mnn/qnn FS integrity gate) that comfortably fits 8GB free.
    const model = createONNXImageModel({ id: 'sd', name: 'Small SD', modelPath: '/models/sd', backend: 'coreml' as never, size: 1 * GB });
    useAppStore.setState({ downloadedImageModels: [model], activeImageModelId: 'sd' });
    useAppStore.getState().updateSettings({ imageThreads: 4, imageUseOpenCL: false, enhanceImagePrompts: false, imageSteps: 8 });
    await hardwareService.refreshMemoryInfo();

    const conversationId = useChatStore.getState().createConversation('sd');
    const result = await imageGenerationService.generateImage({ prompt: 'a red bicycle', conversationId });

    // The fittable load succeeded through the REAL gate.
    expect(result).not.toBeNull();
    expect(modelResidencyManager.isResident('image')).toBe(true);

    // And the user sees no failure card.
    const view = render(React.createElement(ModelFailureCard, {}));
    expect(view.queryByText(/Not Enough Memory/)).toBeNull();
    void MB;
  });
});
