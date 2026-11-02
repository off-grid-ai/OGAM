/**
 * A LiteRT model refused for memory says how far off the phone is. LiteRT weights live in memory the OS
 * cannot page out, so the load is weighed against what free RAM can spare after the OS headroom; the
 * refusal quotes both numbers, and the need is always the larger one.
 *
 * Device ground truth (Pixel 9, 12 GB, 2026-11-02): Gemma 4 E2B LiteRT (2.41 GB file, ~3.6 GB estimated)
 * measured 3.05 GB of app memory on the GPU at a 1024-token context, with about 1.6 GB free beforehand.
 *
 * Real: activeModelService, the residency manager, the stores. Faked (device, harness/generationDevice):
 * the LiteRT native module, the filesystem, RAM.
 */
import { launchGeneration, type GenerationDevice } from '../../harness/generationDevice';
import { GB } from '../../harness/nativeBoundary';

let d: GenerationDevice;

beforeEach(async () => {
  const mod = require('@react-native-async-storage/async-storage');
  await (mod.default ?? mod).clear(); // each test is a fresh install
});

describe('LiteRT memory refusal', () => {
  it('quotes the need and what the phone can spare, the need being larger', async () => {
    d = await launchGeneration({
      engine: 'litert',
      load: false,
      modelFileSizeBytes: 2.41 * GB,
      ram: { platform: 'android', totalBytes: 12 * GB, availBytes: 1.6 * GB },
    });

    const refusal = await d.activeModelService.loadTextModel('m').then(() => null, (e: Error) => e.message);

    const match = /needs about ([\d.]+) GB and the phone can spare ([\d.]+) GB right now/.exec(refusal ?? '');
    expect(match).not.toBeNull();
    expect(Number(match![1])).toBeGreaterThan(Number(match![2]));
    expect(d.liteRTService.isModelLoaded()).toBe(false);
  });
});
