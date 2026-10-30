import { Platform } from 'react-native';
import { CATALOG, isVideoWeightAvailableOn, videoPackError, type ModelEntry } from '@offgrid/models';

/** Light and Turbo builds: offered on 11 GB+ phones, below the packs' desktop minimum. */
const LIGHT_BUILDS_ON_11GB = new Set([
  'off-grid-ai/Wan2.1-T2V-1.3B-GGUF-Q4',
  // A 12 GB phone reports about 11 GB; Turbo runs on a 12 GB iPhone 17 Pro Max.
  'hum-ma/Wan2.2-TI2V-5B-Turbo-GGUF',
]);

/** Video packs a phone on this OS can download whole: current (not superseded), sized, with a weight this OS runs. */
export function completeVideoPacks(os: string = Platform.OS): ModelEntry[] {
  return CATALOG.filter(model =>
    model.kind === 'video' && model.availability !== 'coming_soon' && !model.supersededBy &&
    !!model.minRamGb && !videoPackError(model.files) &&
    isVideoWeightAvailableOn(model.files.find(file => file.role === 'primary')?.name ?? '', os) &&
    model.files.every(file => !!file.sizeBytes),
  );
}

/**
 * The video packs this phone can run. Empty means the phone cannot make videos itself, and they are
 * made on a paired computer instead.
 */
export function videoPacksForPhone(ramGB: number, os: string = Platform.OS): ModelEntry[] {
  return completeVideoPacks(os).filter(model =>
    model.minRamGb! <= ramGB || (ramGB >= 11 && LIGHT_BUILDS_ON_11GB.has(model.id)),
  );
}
