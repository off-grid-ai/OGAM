import { ModelFile } from '../types';
import { predictGgufCapabilities } from './ggufCapabilities';
import { needsVisionArtifactRepair } from '@offgrid/models';

interface VisionRepairCandidate {
  isVisionModel?: boolean;
  mmProjPath?: string;
  mmProjFileName?: string;
  name?: string;
  fileName?: string;
}

/**
 * Returns true if the model is a vision model and is missing its mmproj file,
 * meaning vision capability needs to be repaired.
 *
 * Check if mmProjFileName exists (metadata indicating model should have vision).
 * This persists even if the mmproj file fails to download or gets deleted.
 */
export function needsVisionRepair(
  model: VisionRepairCandidate | null | undefined,
  catalogFile?: ModelFile,
): boolean {
  if (!model) return false;
  return needsVisionArtifactRepair({
    visionReady: predictGgufCapabilities(model).vision,
    projectorFileName: model.mmProjFileName,
    projectorPath: model.mmProjPath,
    catalogHasProjector: !!catalogFile?.mmProjFile,
    declaredVision: model.isVisionModel,
    modelName: model.name,
    artifactName: model.fileName,
    catalogChecked: catalogFile !== undefined,
  });
}
