/**
 * A recommended sd.cpp model is not then refused by the memory guard.
 *
 * SPEC (OGAM user's view): the Image tab recommends only sd.cpp models this phone can load, and loading
 * one at the phone's usual free memory works without "Run anyway". One estimate decides both: the
 * recommendation and the guard read hardwareService.estimateImageModelRam, which for sd.cpp follows the
 * device measurement (RealVisXL Lightning Q4, 2.67 GB file, peaked at 3.33 GB on a OnePlus SM8635).
 *
 * The real recommendation (huggingFaceModelBrowser) and residency manager over the RAM sensor boundary,
 * set to that OnePlus: 11 GB, with the 4.5 GB free it usually had.
 */
import { modelResidencyManager } from '../../../src/services/modelResidency';
import { setDeviceMemory, resetDeviceMemory } from '../../harness/deviceMemory';

afterEach(() => resetDeviceMemory());

const LIGHT = 'RealVisXL v5.0 Lightning (Light)';

it('the recommended RealVisXL Light loads at the OnePlus\'s usual free memory, without Run anyway', async () => {
  await setDeviceMemory({ platform: 'android', totalGB: 11, availGB: 4.5 });
  const { getRecommendedSDImageModels } = require('../../../src/services/huggingFaceModelBrowser');
  const { hardwareService } = require('../../../src/services/hardware');
  const light = getRecommendedSDImageModels(11).find((model: { name: string }) => model.name === LIGHT);
  expect(light).toBeTruthy();

  const sizeMB = Math.round(hardwareService.estimateImageModelRam({ size: light.size, backend: 'sd' }) / (1024 * 1024));
  // Close to the measured 3.33 GB peak, not the old 2.5x (6.7 GB).
  expect(sizeMB).toBeGreaterThan(3330);
  expect(sizeMB).toBeLessThan(3700);
  const { fits } = await modelResidencyManager.makeRoomFor({
    key: 'image', type: 'image', modelId: light.id, sizeMB, dirtyMemory: true,
  });
  expect(fits).toBe(true);
});

it('a model too large for the budget is not recommended at all', async () => {
  await setDeviceMemory({ platform: 'android', totalGB: 8, availGB: 4 });
  const { getRecommendedSDImageModels } = require('../../../src/services/huggingFaceModelBrowser');
  const { hardwareService } = require('../../../src/services/hardware');
  const { computeBudgetMB } = require('../../../src/services/modelResidency/budget');
  const budget = computeBudgetMB(8 * 1024) * 1024 * 1024;
  for (const model of getRecommendedSDImageModels(8))
    expect(hardwareService.estimateImageModelRam({ size: model.size, backend: 'sd' })).toBeLessThanOrEqual(budget);
});
