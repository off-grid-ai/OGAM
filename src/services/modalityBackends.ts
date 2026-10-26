import { useAppStore } from '../stores/appStore';

/**
 * Where each modality runs on this phone, in the words people see: the NPU, the GPU or the CPU.
 * Modality names follow the shared backend policy (@offgrid/models BackendModality).
 */
import type { ModalityName, ProcessorPlace } from '../types';

export type { ModalityName, ProcessorPlace };

export interface ModalityPlacement {
  modality: ModalityName;
  place: ProcessorPlace;
  /** Why, when the place follows a rule rather than a measurement. */
  reason?: string;
}

export function savedPlace(modality: ModalityName): ProcessorPlace | undefined {
  return useAppStore.getState().settings.modalityBackends?.[modality];
}

export function savePlacements(placements: readonly ModalityPlacement[]): void {
  const current = useAppStore.getState().settings.modalityBackends ?? {};
  const next = { ...current };
  for (const placement of placements) next[placement.modality] = placement.place;
  useAppStore.getState().updateSettings({ modalityBackends: next });
}

export const PLACE_LABEL: Record<ProcessorPlace, string> = { npu: 'NPU', gpu: 'GPU', cpu: 'CPU' };
