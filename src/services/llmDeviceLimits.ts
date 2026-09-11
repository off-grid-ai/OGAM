import { Platform } from 'react-native';
import { BYTES_PER_GIBIBYTE, textGpuLayerLimit } from '@offgrid/models';

/** Pure hardware sizing rules used by the native GPU adapters. */

export const BYTES_PER_GB = BYTES_PER_GIBIBYTE;

/** Safe GPU layer count for the device + model. Skips GPU on ≤4 GB to prevent abort();
 *  caps iOS Metal offload to what fits free RAM so the buffer alloc can't overflow. */
export function getGpuLayersForDevice(
  totalMemoryBytes: number,
  requestedLayers: number,
  opts?: { modelBytes?: number; availableBytes?: number },
): number {
  return textGpuLayerLimit({
    platform: Platform.OS === 'android' ? 'android' : 'ios',
    totalMemoryBytes,
    requestedLayers,
    ...opts,
  });
}
