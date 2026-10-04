import {
  staticGgufCapabilities,
  type GgufCapabilities,
} from '@offgrid/models';

export type PredictedGgufCapabilities = GgufCapabilities;

/** Mobile supplies GGUF artifact facts. Shared owns the static family policy. */
export function predictGgufCapabilities(
  model: { id?: string; name?: string; fileName?: string; mmProjPath?: string } | null | undefined,
): PredictedGgufCapabilities {
  return staticGgufCapabilities(model && {
    id: model.id,
    name: model.name,
    fileName: model.fileName,
    projectorPresent: !!model.mmProjPath,
  });
}
