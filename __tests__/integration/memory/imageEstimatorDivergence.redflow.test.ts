/**
 * REGRESSION (integration) — Q14: the advisory "safe to load?" check and the authoritative load gate must
 * size the same image model with one estimate, so a user cannot be told "Safe to load" and then hit a hard
 * "Insufficient memory" refusal for the same facts.
 *
 * checkMemoryForModel's requiredMemoryGB comes from estimateModelMemoryGB → IMAGE_MODEL_OVERHEAD_MULTIPLIER
 * (1.5/1.8), while the authoritative gate uses hardwareService.estimateImageModelRam (1.8/2.5) —
 * ~40% apart. Both should use ONE estimator. Integration boundary: only the RAM/platform leaf is faked;
 * both REAL estimators run.
 */
import { installNativeBoundary, GB } from '../../harness/nativeBoundary';
import { createONNXImageModel } from '../../utils/factories';

let applicationFixture:
  | import('../../harness/mobileApplicationFixture').MobileApplicationFixture
  | undefined;

afterEach(async () => {
  await applicationFixture?.dispose();
  applicationFixture = undefined;
});

describe('Q14 — advisory vs authoritative image-RAM estimate diverge (red-flow)', () => {
  it('sizes the same image model identically in the pre-check and the load gate', async () => {
    installNativeBoundary({
      ram: { platform: 'android', totalBytes: 12 * GB, availBytes: 8 * GB },
    });

    const { hardwareService } = require('../../../src/services/hardware');

    await hardwareService.refreshMemoryInfo();

    const model = createONNXImageModel({
      id: 'sd',
      name: 'SD',
      size: 2 * GB,
      backend: 'mnn',
    });

    // The Mobile application adapter observes the model from the real store and
    // delegates the estimate to Shared. Keep the test on that public contract.
    const { useAppStore } = require('../../../src/stores/appStore');
    useAppStore.setState({ downloadedImageModels: [model] });
    const { startMobileApplicationFixture } =
      require('../../harness/mobileApplicationFixture') as typeof import('../../harness/mobileApplicationFixture');
    applicationFixture = await startMobileApplicationFixture();
    await applicationFixture.refreshModels();

    const advisory =
      await applicationFixture.application.models.memoryAdvice.forSelection(
        'sd',
        'image',
      );
    const advisoryGB = advisory.requiredMemoryMB / 1024;
    const gateGB = hardwareService.estimateImageModelRam(model) / GB;

    // One estimator keeps the pre-check promise aligned with what the load gate enforces.
    expect(Math.abs(advisoryGB - gateGB)).toBeLessThan(0.5);
  });
});
