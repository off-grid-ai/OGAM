/** React Native platform binding for the shared memory-budget policy. */
import { Platform } from 'react-native';
import {
  AGGRESSIVE_RESERVE_MB,
  MEMORY_RESERVE_MB,
  awaitMemoryReclaim,
  effectiveAvailableMB as sharedEffectiveAvailableMB,
  fileExceedsBudget as sharedFileExceedsBudget,
  memoryReserveMB,
  modelBudgetFraction as sharedModelBudgetFraction,
  modelMemoryBudgetMB as sharedModelMemoryBudgetMB,
  modelWarningThresholdMB as sharedModelWarningThresholdMB,
  type ModelPlatform,
  type ResidencyLoadPolicy,
} from '@offgrid/models';

export type LoadPolicy = ResidencyLoadPolicy;
export { AGGRESSIVE_RESERVE_MB, MEMORY_RESERVE_MB, awaitMemoryReclaim, memoryReserveMB };

export function effectiveAvailableMB(
  realAvailableMB: number,
  totalRamMB: number,
  options: { platform?: ModelPlatform; policy?: LoadPolicy } = {},
): number {
  return sharedEffectiveAvailableMB(
    realAvailableMB,
    totalRamMB,
    options.platform ?? Platform.OS,
    options.policy,
  );
}

export function modelBudgetFraction(
  totalRamGB: number,
  platform: ModelPlatform = Platform.OS,
  policy: LoadPolicy = 'balanced',
): number {
  return sharedModelBudgetFraction(totalRamGB, platform, policy);
}

export function modelMemoryBudgetMB(
  totalRamMB: number,
  platform: ModelPlatform = Platform.OS,
  policy: LoadPolicy = 'balanced',
): number {
  return sharedModelMemoryBudgetMB(totalRamMB, platform, policy);
}

export function modelWarningThresholdMB(
  totalRamMB: number,
  platform: ModelPlatform = Platform.OS,
): number {
  return sharedModelWarningThresholdMB(totalRamMB, platform);
}

export function fileExceedsBudget(sizeBytes: number, ramGB: number): boolean {
  return sharedFileExceedsBudget(sizeBytes, ramGB, Platform.OS);
}
