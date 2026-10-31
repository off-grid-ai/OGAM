/**
 * trendingSelection.test.ts
 *
 * The curated and trending lists in useTextModels offer a model when it loads on the phone by the
 * shared fit rule: its download against the phone budget, not a parameter count.
 *
 * Only the device boundary is faked: the phone's platform and RAM reading, the disk and async-storage.
 * The hook runs on the real navigation stack with the real hardwareService, stores and services.
 */
import { installNativeBoundary, GB, type RamProfile } from '../../../harness/nativeBoundary';
import { renderHookInNavigator, type NavigatorHook } from '../../../harness/navigatorHook';

jest.unmock('@react-navigation/native');

type TextModels = ReturnType<typeof import('../../../../src/screens/ModelsScreen/useTextModels').useTextModels>;

let view: NavigatorHook<TextModels> | undefined;
afterEach(() => { view?.unmount(); view = undefined; });

/** The Models screen's text list on a phone whose OS reports `totalGB` of RAM. */
async function textModelsOn(platform: RamProfile['platform'], totalGB: number) {
  installNativeBoundary({ fs: true, ram: { platform, totalBytes: totalGB * GB, availBytes: (totalGB / 2) * GB } });
  await require('@react-native-async-storage/async-storage').clear();
  // The app reads the device once at boot; the lists read that reading.
  await require('../../../../src/services').hardwareService.getDeviceInfo();
  const { useTextModels } = require('../../../../src/screens/ModelsScreen/useTextModels');
  view = await renderHookInNavigator<TextModels>(() => useTextModels(() => {}), { screen: 'Models' });
  return view.result.current;
}

describe('curated models offered by what loads on the phone', () => {
  // A 12 GB iPhone reports about 11.2 GB. The shared iPhone budget loads a download up to 0.70 of it.
  const TWELVE_GB_IPHONE = 11.2;

  it('offers a 12 GB iPhone the 9B class it loads, above any parameter cap, and hides what it cannot', async () => {
    const offered = (await textModelsOn('ios', TWELVE_GB_IPHONE)).recommendedAsModelInfo.map(m => m.id);

    // Measured on a 12 GB iPhone 17 Pro Max: a 9B Q4_K_M and Gemma 4 E4B load (mapped weights).
    expect(offered).toContain('unsloth/Qwen3.5-9B-GGUF');
    expect(offered).toContain('unsloth/gemma-4-E4B-it-GGUF');
    expect(offered).toContain('LiquidAI/LFM2.5-8B-A1B-GGUF');
    // The iPhone loads up to 0.70 of its RAM (ddaa6c1): Gemma 4 12B, 7.3 GB with its projector,
    // loads; Gemma 4 26B A4B is past it.
    expect(offered).toContain('unsloth/gemma-4-12b-it-GGUF');
    expect(offered).not.toContain('unsloth/gemma-4-26B-A4B-it-GGUF');
  });

  it('picks the trending model per family from what loads on a 12 GB iPhone', async () => {
    const trending = (await textModelsOn('ios', TWELVE_GB_IPHONE)).trendingAsModelInfo.map(m => m.id);

    expect(trending).toContain('unsloth/gemma-4-E2B-it-GGUF');
    expect(trending).toHaveLength(3);
  });

  it('offers a 16 GB phone the larger models it can load', async () => {
    const offered = (await textModelsOn('ios', 15)).recommendedAsModelInfo.map(m => m.id);

    expect(offered).toContain('unsloth/Qwen3.5-9B-GGUF');
    expect(offered).toContain('unsloth/gemma-4-E4B-it-GGUF');
  });

  it('offers nothing to a phone too small to load any model', async () => {
    const lists = await textModelsOn('ios', 1);

    expect(lists.recommendedAsModelInfo).toHaveLength(0);
    expect(lists.trendingAsModelInfo).toHaveLength(0);
  });
});
