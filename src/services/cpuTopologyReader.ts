import RNFS from 'react-native-fs';
import { androidInferenceThreads } from '@offgrid/models';

/**
 * The I/O half of "which cores are worth running inference on": read the kernel's per-core topology
 * from sysfs and hand the numbers to the pure rule. Separate from the rule so the rule can be tested
 * on real device topologies with no filesystem, and separate from hardwareService so the service
 * stays about what the device IS rather than how to read it.
 *
 * `cpu_capacity` is the scheduler's 0-1024 rating and exists on any DynamIQ/EAS kernel — effectively
 * every modern Android phone. `cpuinfo_max_freq` is the same clustering signal on older kernels, so
 * it is the fallback. A core whose files cannot be read is skipped rather than guessed at.
 */
async function readCoreValues(cores: number, file: string): Promise<number[]> {
  return Promise.all(
    Array.from({ length: cores }, async (_unused, cpu) => {
      try {
        const raw = await RNFS.readFile(`/sys/devices/system/cpu/cpu${cpu}/${file}`, 'utf8');
        return Number.parseInt(raw.trim(), 10);
      } catch {
        return Number.NaN;
      }
    }),
  );
}

/** How many cores inference should thread (the shared rule), or 0 when the topology could not be read. */
export async function readPerformanceCoreCount(cores: number): Promise<number> {
  const byCapacity = androidInferenceThreads(await readCoreValues(cores, 'cpu_capacity'));
  if (byCapacity > 0) return byCapacity;
  return androidInferenceThreads(await readCoreValues(cores, 'cpufreq/cpuinfo_max_freq'));
}
