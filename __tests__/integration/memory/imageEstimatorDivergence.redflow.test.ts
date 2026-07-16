/**
 * RED-FLOW (integration) — Q14: the advisory "safe to load?" check and the authoritative load gate size
 * the SAME image model with DIFFERENT multipliers, so a user is told "Safe to load" and then hits a hard
 * "Insufficient memory" refusal.
 *
 * checkMemoryForModel's requiredMemoryGB comes from estimateModelMemoryGB → IMAGE_MODEL_OVERHEAD_MULTIPLIER
 * (1.5/1.8), while the authoritative gate uses hardwareService.estimateImageModelRam (1.8/2.5) —
 * ~40% apart. Both should use ONE estimator. Integration boundary: only the RAM/platform leaf is faked;
 * both REAL estimators run.
 */
import { installNativeBoundary, GB } from '../../harness/nativeBoundary';
import { createONNXImageModel } from '../../utils/factories';

describe('Q14 — advisory vs authoritative image-RAM estimate diverge (red-flow)', () => {
  it('sizes the same image model identically in the pre-check and the load gate', async () => {
    installNativeBoundary({ ram: { platform: 'android', totalBytes: 12 * GB, availBytes: 8 * GB } });
    /* eslint-disable @typescript-eslint/no-var-requires */
    const { checkMemoryForModel } = require('../../../src/services/activeModelService/memory');
    const { hardwareService } = require('../../../src/services/hardware');
    /* eslint-enable @typescript-eslint/no-var-requires */
    await hardwareService.refreshMemoryInfo();

    const model = createONNXImageModel({ id: 'sd', name: 'SD', size: 2 * GB, backend: 'mnn' });

    const advisory = await checkMemoryForModel({
      modelId: 'sd', modelType: 'image', ids: {}, policy: 'balanced',
      lists: { downloadedModels: [], downloadedImageModels: [model] },
    });
    const advisoryGB = advisory.requiredMemoryGB;
    const gateGB = hardwareService.estimateImageModelRam(model) / GB;

    // Correct: one estimator → the pre-check promise matches what the gate enforces. Today the advisory
    // (1.8×) is ~40% under the gate (2.5×), so "Safe to load" is followed by a hard refusal → RED.
    expect(Math.abs(advisoryGB - gateGB)).toBeLessThan(0.5);
  });
});
