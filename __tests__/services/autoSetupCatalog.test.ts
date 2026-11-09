import { Platform } from 'react-native';
import { loadAutoSetupCompatibleCatalog } from '../../src/services/autoSetupCatalog';
import { selectAutoSetupPlans } from '../../src/services/autoSetupPlan';

// Setup's Quick start is the best model under 1 GB, so a first download finishes (PostHog
// 2026-11-09); Balanced and Extreme are this phone's Balanced and Best picks (37759c684), ranked by
// quality alone (shared afdb05f) on the iPhone budget (shared ddaa6c1): on a 12 GB iPhone 17 Pro Max
// the 9B is the Best pick, and no plan repeats another's chat model.
test('an iPhone 17 Pro Max gets a model under 1 GB first, then its Balanced and Best picks, each model once', async () => {
  expect(Platform.OS).toBe('ios');
  const catalog = await loadAutoSetupCompatibleCatalog({
    totalMemoryGB: () => 12,
    fetchTextFiles: async () => ({}),
    imageRecommendation: async () => ({ compatibleBackends: ['coreml'], recommendedBackend: 'coreml', bannerText: '' }),
    imageModels: async () => [],
  });
  const image = [{ id: 'image', name: 'Image', kind: 'image' as const, sizeBytes: 1, fitScore: 0, payload: {} as never }];
  const stt = [{ id: 'stt', name: 'Speech', kind: 'stt' as const, sizeBytes: 1, fitScore: 0, payload: { modelId: 'stt' } }];
  const plans = selectAutoSetupPlans({ text: catalog.text, image, stt });

  expect(plans.map(plan => plan.items[0].name)).toEqual([
    'Qwen 3.5 0.8B',
    'MiniCPM5 2B',
    'Qwen 3.5 9B',
  ]);
  expect(plans[0].items[0].sizeBytes).toBeLessThan(1e9);
});
