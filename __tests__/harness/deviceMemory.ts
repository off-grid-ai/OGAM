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
import { modelResidencyManager, resetModelApplication } from './activeModelLifecycle';
import type { LoadPolicy } from '../../src/services/memoryBudget';
import type { ResidentSpec } from '@offgrid/models';

const originalOS = Platform.OS;

export interface DeviceMemory {
  platform: 'ios' | 'android';
  totalGB: number;
  /** Real free RAM right now (os_proc_available), in GB. */
  availGB: number;
  policy?: LoadPolicy;
}

/** Seed the device's RAM + platform + policy and reset the REAL residency manager to empty. */
export async function setDeviceMemory(d: DeviceMemory): Promise<void> {
  Object.defineProperty(Platform, 'OS', { value: d.platform, configurable: true });
  jest.spyOn(hardwareService, 'getTotalMemoryGB').mockReturnValue(d.totalGB);
  jest.spyOn(hardwareService, 'getAvailableMemoryGB').mockReturnValue(d.availGB);
  jest.spyOn(hardwareService, 'refreshMemoryInfo').mockResolvedValue(undefined as never);
  await resetModelApplication();
  modelResidencyManager.setLoadPolicy(d.policy ?? 'balanced');
}

/** Restore Platform.OS + spies after a test. */
export async function resetDeviceMemory(): Promise<void> {
  Object.defineProperty(Platform, 'OS', { value: originalOS, configurable: true });
  jest.restoreAllMocks();
  await resetModelApplication();
}

const MB = 1 / 1024; // GB per MB, for readable specs
/** Register a resident model directly (as if already loaded), with a dumb unload spy. */
export async function makeResident(
  spec: ResidentSpec,
): Promise<jest.Mock> {
  const unload = jest.fn().mockResolvedValue(undefined);
  const lease = await modelResidencyManager.acquire(
    { ...spec, lifecycle: 'persistent' },
    { load: async () => undefined, unload },
    { now: 1 },
  );
  if (!lease.acquired) {
    throw new Error(`Could not seed resident ${spec.key}`);
  }
  await lease.release();
  return unload;
}

export const gbOf = (mb: number): number => mb * MB;
