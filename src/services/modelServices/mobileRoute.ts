import {
  encodeModelRouteId,
  type ModelModality,
  type ModelSource,
  type RuntimeModel,
} from '@offgrid/models';

export interface MobileRouteFacts {
  source: ModelSource;
  hostId: string;
  modality: ModelModality;
  modelId: string;
}

/** The Mobile adapter name is a platform fact. Shared owns the route codec. */
export function mobileExecutionAdapterId(
  source: ModelSource,
  hostId: string,
  modality: ModelModality,
): string {
  return `mobile:${source}:${encodeURIComponent(hostId)}:${modality}`;
}

export function mobileRouteId(facts: MobileRouteFacts): string {
  return encodeModelRouteId({
    adapterId: mobileExecutionAdapterId(
      facts.source,
      facts.hostId,
      facts.modality,
    ),
    providerId: facts.source === 'local' ? facts.hostId : undefined,
    serverId: facts.source === 'remote' ? facts.hostId : undefined,
    modelId: facts.modelId,
  });
}

export function mobileRouteFacts(model: RuntimeModel): MobileRouteFacts | null {
  const hostId = model.source === 'remote' ? model.serverId : model.providerId;
  return hostId
    ? {
        source: model.source,
        hostId,
        modality: model.modality,
        modelId: model.id,
      }
    : null;
}
