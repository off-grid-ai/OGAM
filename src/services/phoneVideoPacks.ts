import { Platform } from 'react-native';
import { CATALOG, isVideoWeightAvailableOn, videoPackError, videoTakesStartImage, type ModelEntry } from '@offgrid/models';

/** Light and Turbo builds: offered on 11 GB+ phones, below the packs' desktop minimum. */
const LIGHT_BUILDS_ON_11GB = new Set([
  'off-grid-ai/Wan2.1-T2V-1.3B-GGUF-Q4',
  'off-grid-ai/Wan2.2-TI2V-5B-GGUF-Q4',
]);

/**
 * Turbo from 11 GB on iPhones only: a 12 GB iPhone reports about 11 GB and runs it on the GPU
 * (jc-builds/Wan2.2-TI2V-5B-Turbo-iOS). Android runs Wan diffusion on the CPU (the Hexagon and
 * Adreno paths fail for Wan), where a 12 GB OnePlus Nord 5 did not finish one Turbo step in 18 min.
 */
const TURBO_ON_11GB_IPHONE = 'hum-ma/Wan2.2-TI2V-5B-Turbo-GGUF';

/** Video packs a phone on this OS can download whole: listed, sized, with a weight this OS runs. */
export function completeVideoPacks(os: string = Platform.OS): ModelEntry[] {
  return CATALOG.filter(model =>
    model.kind === 'video' && model.availability !== 'coming_soon' &&
    !!model.minRamGb && !videoPackError(model.files) &&
    isVideoWeightAvailableOn(model.files.find(file => file.role === 'primary')?.name ?? '', os) &&
    // iOS holds Wan 2.2 only as Turbo: the 20-step builds with the full decoder did not fit there.
    !(os === 'ios' && /wan2[._]2/i.test(model.id) && !/turbo/i.test(model.id)) &&
    model.files.every(file => !!file.sizeBytes),
  );
}

/**
 * The video packs this phone can run. Empty means the phone cannot make videos itself, and they are
 * made on a paired computer instead.
 */
export function videoPacksForPhone(ramGB: number, os: string = Platform.OS): ModelEntry[] {
  return completeVideoPacks(os).filter(model =>
    model.minRamGb! <= ramGB ||
    (ramGB >= 11 && (LIGHT_BUILDS_ON_11GB.has(model.id) || (os === 'ios' && model.id === TURBO_ON_11GB_IPHONE))),
  );
}

/**
 * The video model this phone should use by default, of those installed: Turbo first (fewest steps), then
 * one that also starts from a picture, then the first installed. The default follows the best one.
 */
export function bestInstalledVideoModel<T extends Pick<ModelEntry, 'id' | 'files'>>(installed: readonly T[]): T | undefined {
  const rank = (model: T) => {
    const weight = model.files.find(file => file.role === 'primary')?.name ?? '';
    if (/turbo/i.test(model.id)) return 0;
    return videoTakesStartImage(weight) ? 1 : 2;
  };
  return [...installed].sort((a, b) => rank(a) - rank(b))[0];
}
