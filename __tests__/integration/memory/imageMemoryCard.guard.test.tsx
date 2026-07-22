/**
 * UI integration GUARDS — memory OOM-avoidance via the image-gen path + ModelFailureCard.
 *
 * You can't test a SIGKILL; you test that the app AVOIDS it. These drive the REAL imageGenerationService
 * with an image model that cannot fit the seeded RAM — the REAL modelResidencyManager + memoryBudget
 * decide — and assert the user sees the graceful "Not Enough Memory" card (with a "Load Anyway"
 * affordance), never a silent proceed-to-crash. Only native leaves are faked (diffusion + RAM); a CoreML
 * model skips the mnn/qnn integrity gate so no filesystem is needed.
 *
 * These are GREEN regression guards, not red bugs: they lock in the correct avoidance so a future change
 * can't silently drop the guard or admit an unfittable load. (The RED over-admit/over-refuse edge cases
 * M3/M4/M5 are text-model gate-verdict bugs, reproduced in budgetRedflow.test.ts.)
 */
import {
  installNativeBoundary,
  GB,
  MB,
  requireRTL,
} from '../../harness/nativeBoundary';
import { createONNXImageModel } from '../../utils/factories';

async function setup(
  ram: { platform: 'ios' | 'android'; totalBytes: number; availBytes: number },
  modelSizeBytes: number,
) {
  const boundary = installNativeBoundary({ ram });
  void boundary;
  /* eslint-disable @typescript-eslint/no-var-requires */
  const React = require('react');
  const { render } = requireRTL();
  const {
    imageGenerationService,
  } = require('../../../src/services/imageGenerationService');
  const { hardwareService } = require('../../../src/services/hardware');
  const { useAppStore } = require('../../../src/stores');
  const {
    ModelFailureCard,
  } = require('../../../src/components/ModelFailureCard');
  /* eslint-enable @typescript-eslint/no-var-requires */

  // CoreML backend → activeModelService skips the mnn/qnn integrity (FS) gate, straight to the memory gate.
  const model = createONNXImageModel({
    id: 'sd',
    name: 'Big SD',
    modelPath: '/models/big',
    backend: 'coreml' as never,
    size: modelSizeBytes,
  });
  useAppStore.setState({
    downloadedImageModels: [model],
    activeImageModelId: 'sd',
  });
  useAppStore.getState().updateSettings({
    imageThreads: 4,
    imageUseOpenCL: false,
    enhanceImagePrompts: false,
  });

  await hardwareService.refreshMemoryInfo(); // pull seeded RAM into the cache the real gate reads
  return { React, render, imageGenerationService, ModelFailureCard };
}

describe('memory OOM-avoidance — image gen + ModelFailureCard (guards)', () => {
  it('refuses an unfittable load and shows the "Not Enough Memory" card + Load Anyway', async () => {
    const t = await setup(
      { platform: 'ios', totalBytes: 6 * GB, availBytes: 300 * MB },
      8 * GB,
    );
    const result = await t.imageGenerationService.generateImage({
      prompt: 'a cat',
    });
    expect(result).toBeNull(); // refused, not generated

    const view = t.render(t.React.createElement(t.ModelFailureCard, {}));
    // The graceful surface the user sees instead of a crash: the failure card + a Load Anyway escape hatch.
    expect(view.getByTestId('model-failure-load-anyway-image')).toBeTruthy();
    expect(view.getByText('Image model: Not Enough Memory')).toBeTruthy();
    expect(view.queryByText(/Free up space/)).not.toBeNull();
  });

  it('under "Load Anyway", catastrophic RAM pressure becomes a hard card without another override', async () => {
    const t = await setup(
      { platform: 'android', totalBytes: 12 * GB, availBytes: 665 * MB },
      8 * GB,
    );
    await t.imageGenerationService.generateImage({ prompt: 'a cat' }); // 1st attempt: refused (overridable)
    // The Load Anyway button dismisses the refusal card, THEN re-runs with override — replicate that
    // dismiss so we isolate whether the OVERRIDE attempt itself produces a fresh memory refusal.
    require('../../../src/stores/modelFailureStore')
      .useModelFailureStore.getState()
      .clear();
    await t.imageGenerationService.generateImage(
      { prompt: 'a cat' },
      { override: true },
    ); // Load Anyway

    const view = t.render(t.React.createElement(t.ModelFailureCard, {}));
    expect(view.getByText('Image model: Not Enough Memory')).toBeTruthy();
    expect(view.queryByTestId('model-failure-load-anyway-image')).toBeNull();
  });
});
