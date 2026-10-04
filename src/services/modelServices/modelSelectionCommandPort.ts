import type { ModelModality } from '@offgrid/models';

export interface ModelSelectionCommandPort {
  select(modality: ModelModality, canonicalId: string | null): Promise<void>;
  removeServer(serverId: string): Promise<void>;
}

let registered: ModelSelectionCommandPort | null = null;

export function registerModelSelectionCommandPort(port: ModelSelectionCommandPort): () => void {
  registered = port;
  return () => { if (registered === port) registered = null; };
}

export function selectCanonicalModel(modality: ModelModality, canonicalId: string | null): Promise<void> {
  if (!registered) throw new Error('The model selection command port is not registered');
  return registered.select(modality, canonicalId);
}

export function removeCanonicalServerSelections(serverId: string): Promise<void> {
  if (!registered) throw new Error('The model selection command port is not registered');
  return registered.removeServer(serverId);
}
