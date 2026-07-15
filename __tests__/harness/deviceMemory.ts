/**
 * Device-memory harness — the RAM-sensor STUB (a data source, not a mock).
 *
 * `hardwareService.get{Total,Available}MemoryGB` is the outermost native leaf that reads the OS memory
 * counters — the ONE thing we cannot run in Node. We stub it to return exact device numbers; the REAL
 * `modelResidencyManager` + `memoryBudget` + `policy` run on top and DECIDE (fits / evict / floor). So
 * the outcome is emergent — a red test here fails because our budget logic is wrong, not because a mock
 * was told to. This is the sociable, state-verifying integration test for the memory subsystem.
 *
 * NOT a mock of the thing under test: the stub never decides `fits`; it only reports RAM.
 */
import { Platform } from 'react-native';
import { hardwareService } from '../../src/services/hardware';
import { modelResidencyManager } from '../../src/services/modelResidency';
import type { LoadPolicy } from '../../src/services/memoryBudget';

const originalOS = Platform.OS;

export interface DeviceMemory {
  platform: 'ios' | 'android';
  totalGB: number;
  /** Real free RAM right now (os_proc_available), in GB. */
  availGB: number;
  policy?: LoadPolicy;
}

/** Seed the device's RAM + platform + policy and reset the REAL residency manager to empty. */
export function setDeviceMemory(d: DeviceMemory): void {
  Object.defineProperty(Platform, 'OS', { value: d.platform, configurable: true });
  jest.spyOn(hardwareService, 'getTotalMemoryGB').mockReturnValue(d.totalGB);
  jest.spyOn(hardwareService, 'getAvailableMemoryGB').mockReturnValue(d.availGB);
  jest.spyOn(hardwareService, 'refreshMemoryInfo').mockResolvedValue(undefined as never);
  modelResidencyManager._reset();
  modelResidencyManager.setBudgetOverrideMB(null);
  modelResidencyManager.setLoadPolicy(d.policy ?? 'balanced');
}

/** Restore Platform.OS + spies after a test. */
export function resetDeviceMemory(): void {
  Object.defineProperty(Platform, 'OS', { value: originalOS, configurable: true });
  jest.restoreAllMocks();
  modelResidencyManager._reset();
}

const MB = 1 / 1024; // GB per MB, for readable specs
/** Register a resident model directly (as if already loaded), with a dumb unload spy. */
export function makeResident(
  spec: { key: string; type: any; modelId?: string; sizeMB: number; dirtyMemory?: boolean; canEvict?: () => boolean },
): jest.Mock {
  const unload = jest.fn().mockResolvedValue(undefined);
  modelResidencyManager.register(spec, unload, 1);
  return unload;
}

export const gbOf = (mb: number): number => mb * MB;
