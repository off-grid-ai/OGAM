import { Platform } from 'react-native';
import logger from '../../utils/logger';
import { hardwareService } from '../hardware';
import { awaitMemoryReclaim, checkOverrideSurvival, LoadPolicy } from '../memoryBudget';
import {
  formatOverrideAdmittedLine,
  formatOverrideRefusedLine,
} from './logging';
import { ResidentSpec } from './residents';

/** Read the live post-eviction RAM boundary and apply the owned survival rule. */
export async function overridePassesSurvivalFloor(args: {
  spec: ResidentSpec;
  totalRamMB: number;
  policy: LoadPolicy;
  evict: Array<{ key: string }>;
}): Promise<boolean> {
  const { spec, totalRamMB, policy, evict } = args;
  // The evicted models' native release() has returned, but iOS reclaims the freed pages SHORTLY
  // AFTER — reading os_proc_available now would see the stale pre-reclaim value and refuse a load the
  // device can actually do (the false refusal Load Anyway exists to defeat). Wait for the footprint
  // to actually drop before reading, exactly as the load path does. Only when something was evicted.
  if (evict.length > 0) {
    await awaitMemoryReclaim(() => hardwareService.getProcessMemory());
  }
  await hardwareService.refreshMemoryInfo().catch(() => {});
  const survival = checkOverrideSurvival({
    realAvailableMB: Math.round(hardwareService.getAvailableMemoryGB() * 1024),
    totalRamMB,
    incomingDirtyMB: spec.dirtyMemory ? spec.sizeMB : 0,
    platform: Platform.OS,
    policy,
  });
  logger.log(
    survival.fits
      ? formatOverrideAdmittedLine({ specKey: spec.key, evict, ...survival })
      : formatOverrideRefusedLine({ specKey: spec.key, ...survival }),
  );
  return survival.fits;
}
