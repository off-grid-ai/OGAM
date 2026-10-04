/**
 * useResidentRows — the manager sheet's per-row residency projection, read from the OWNING service
 * (the Models application facade). One place maps the sheet's
 * modality rows onto residency types — no engine branching in the view, and both callers (Home,
 * Chat) inherit the projection with zero wiring.
 *
 * The facade owns the structurally shared snapshot. The UI only projects its resident list into
 * the four model rows shown by this sheet.
 */
import { useSyncExternalStore } from 'react';
import { applicationFacade } from '../../services/applicationFacade';
import {
  modelsFailureMessage,
  type Resident,
  type ResidentType,
} from '@offgrid/application';

/** The manager sheet's modality rows. Defined HERE (the lower-level projection) rather than in
 *  ModelsManagerSheet so the hook doesn't import the component — that was a dependency cycle
 *  (ModelsManagerSheet → useResidentRows → ModelsManagerSheet). The sheet re-exports it. */
export type ModelRowType = 'text' | 'image' | 'voice' | 'speech';

/** Sheet row → residency type. Voice is the TTS output engine; Speech is the Whisper STT input. */
const ROW_RESIDENT_TYPE: Record<ModelRowType, ResidentType> = {
  text: 'text',
  image: 'image',
  voice: 'voice',
  speech: 'transcription',
};

/** Pure: pick the resident (if any) backing each sheet row. */
function residentsByRow(
  residents: readonly Resident[],
): Partial<Record<ModelRowType, Resident>> {
  const out: Partial<Record<ModelRowType, Resident>> = {};
  (Object.keys(ROW_RESIDENT_TYPE) as ModelRowType[]).forEach((row) => {
    const match = residents.find((r) => r.type === ROW_RESIDENT_TYPE[row]);
    if (match) out[row] = match;
  });
  return out;
}

export function useResidentRows(active: boolean): Partial<Record<ModelRowType, Resident>> {
  const models = applicationFacade().models;
  const snapshot = useSyncExternalStore(
    active ? models.subscribe : () => () => {},
    models.snapshot,
    models.snapshot,
  );
  return residentsByRow(snapshot.residents);
}

/** Eject one row's resident via the owning service: running work stops first, then its registered unload runs. */
export async function ejectResident(resident: Resident): Promise<boolean> {
  const outcome = await applicationFacade().models.ejectResident({
    key: resident.key,
  });
  if (!outcome.ok) throw new Error(modelsFailureMessage(outcome.failure));
  return outcome.value;
}
