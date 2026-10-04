import type { ModelResidencyManager, Resident, ResidentType } from '@offgrid/models';

/** Read residency by modality while the shared manager keeps route identity as its key. */
export function residentByType(
  manager: ModelResidencyManager,
  type: ResidentType,
): Resident | undefined {
  return manager.getResidents().find(resident => resident.type === type);
}

export function isResidentType(
  manager: ModelResidencyManager,
  type: ResidentType,
): boolean {
  return residentByType(manager, type) !== undefined;
}

export async function evictResidentType(
  manager: ModelResidencyManager,
  type: ResidentType,
): Promise<boolean> {
  const resident = residentByType(manager, type);
  return resident ? manager.evictByKey(resident.key) : false;
}
