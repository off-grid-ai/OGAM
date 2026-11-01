/**
 * Device-memory harness: the phone's RAM sensor, faked at the device boundary.
 *
 * The phone reports its memory through react-native-device-info (total and used) and the native
 * DeviceMemoryModule (what the OS will still give this process). Those are set to exact device numbers;
 * the REAL hardwareService reads them, and the REAL `modelResidencyManager` + `memoryBudget` + `policy`
 * run on top and DECIDE (fits / evict / floor). A red test here fails because our budget logic is wrong,
 * not because a fake was told to.
 */
import { NativeModules, Platform } from 'react-native';
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

const GB = 1024 * 1024 * 1024;
const originalMemoryModule = NativeModules.DeviceMemoryModule;

/** Seed the device's RAM + platform + policy and reset the REAL residency manager to empty. */
export async function setDeviceMemory(d: DeviceMemory): Promise<void> {
  Object.defineProperty(Platform, 'OS', { value: d.platform, configurable: true });
  const total = d.totalGB * GB;
  const available = d.availGB * GB;
  const DeviceInfo = require('react-native-device-info');
  (DeviceInfo.getTotalMemory as jest.Mock).mockResolvedValue(total);
  (DeviceInfo.getUsedMemory as jest.Mock).mockResolvedValue(total - available);
  NativeModules.DeviceMemoryModule = {
    getMemoryInfo: async () => ({ processAvailableBytes: available, systemAvailableBytes: available, footprintBytes: 0 }),
  };
  // The app reads the sensor the way it does on device.
  await hardwareService.refreshMemoryInfo();
  modelResidencyManager._reset();
  modelResidencyManager.setBudgetOverrideMB(null);
  modelResidencyManager.setLoadPolicy(d.policy ?? 'balanced');
}

/** Restore Platform.OS, the memory module and any spies after a test. */
export function resetDeviceMemory(): void {
  Object.defineProperty(Platform, 'OS', { value: originalOS, configurable: true });
  NativeModules.DeviceMemoryModule = originalMemoryModule;
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
